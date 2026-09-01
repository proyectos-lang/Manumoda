-- ============================================================
-- Horas base de costura por familia + recálculo forzado
--
-- PROBLEMA QUE CORRIGE:
--
--   1. `complejidad_familias` estaba VACÍA (0 filas). De ahí sale
--      `base_horas_costura`, la hora base por familia, y el trigger
--      la resuelve con COALESCE(..., 0). Resultado: la familia
--      aportaba CERO en los 143 registros con costurera, y la
--      fórmula quedó reducida a `checkboxes × muestras`.
--      Verificado: los 143 cuadran con esa cuenta, sin excepción.
--      Los 18 sin ninguna casilla marcada salían en 0 h aunque
--      tuvieran el cumplimiento de costura palomeado.
--
--   2. `horas_totales_cumplidas` no la mantenía nadie. El trigger
--      recalcula `horas_totales_plan` (170 de 170 correctas) pero
--      nunca tocaba la de cumplidas: 127 de 170 desfasadas.
--      Se muestra en Hoja de Impresión y se exporta a Excel.
--
--   3. Convivían los tipos 'RECHAZO' (3) y 'RECHAZADO' (13). El
--      catálogo `cat_tipo_diseno` solo conoce 'RECHAZO', con
--      multiplicador 0.80, así que los 13 calculaban con 1.00.
--
--   4. No había forma de forzar un recálculo. Desde el script 012
--      el plan se CONGELA una vez evaluado, así que llenar el
--      catálogo no habría corregido nada por sí solo: los 18
--      registros se habrían quedado en 0 para siempre.
--
-- QUÉ HACE:
--
--   · Siembra `complejidad_familias` desde `cat_prendas`, usando el
--     nivel de complejidad ya curado ahí (A/B/C/D → 2.00/2.15/
--     2.30/2.45). Un solo criterio de complejidad para diseño y
--     costura: si una CHAMARRA es nivel D para diseñar, también lo
--     es para coser.
--   · Le agrega al trigger una escotilla de recálculo por GUC, para
--     que la fórmula siga viviendo en un solo lugar.
--   · Le agrega el mantenimiento de `horas_totales_cumplidas`.
--   · Normaliza 'RECHAZADO' → 'RECHAZO'.
--   · Fuerza el recálculo, SOLO DE COSTURA.
--
-- POR QUÉ SOLO COSTURA:
--   Un recálculo forzado de diseño descongelaría 7 registros tipo
--   'MUESTRA' evaluados cuando ese tipo todavía tenía multiplicador
--   0.80 en el catálogo. Hoy 'MUESTRA' ya no está y calcularían con
--   1.00: +3.28 h que nadie pidió mover. El plan de diseño no tiene
--   ningún folio en cero, así que no hay nada que arreglar ahí.
--   Si algún día se quiere alinear esos 7, va en su propio script.
--
-- IMPACTO MEDIDO (idempresa 1, antes de ejecutar):
--   plan costura   350.00 h → 857.65 h   ·  en cero: 18 → 0
--   plan diseño    581.59 h → 578.83 h   ·  solo los 6 RECHAZADO
--                                           con prenda vinculada
--
-- NO toca `idprenda`. Los 24 registros que lo tienen en NULL
-- conservan su valor manual de diseño; eso vive en el script 041,
-- que es opcional.
--
-- PREREQUISITO: scripts 006 y 012 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Horas base de costura por familia
--
--    `familia` en diseno_programacion es texto libre que coincide con
--    `cat_prendas.nombre`. Se siembra una fila por prenda del catálogo.
--
--    Idempotente: ON CONFLICT no pisa un valor que operación haya
--    ajustado a mano desde la app.
-- ════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS ux_complejidad_familias_empresa_familia
  ON manumoda.complejidad_familias (idempresa, familia);

INSERT INTO manumoda.complejidad_familias (idempresa, familia, base_horas_costura, base_horas_diseno)
SELECT cp.idempresa, cp.nombre, cp.horas_base, cp.horas_base
FROM manumoda.cat_prendas cp
ON CONFLICT (idempresa, familia) DO NOTHING;

-- Red de seguridad: cualquier familia en uso que no exista en cat_prendas
-- entra en nivel C (2.30). Hoy son dos, MAXIVESTIDO y PANTS, y 2.30 es
-- justo el nivel de sus parientes directos —VESTIDO y PANTALON—. Lo que
-- importa es que una familia nueva nunca vuelva a caer en 0 h en silencio;
-- el valor correcto se ajusta desde Diseño → Multiplicadores.
INSERT INTO manumoda.complejidad_familias (idempresa, familia, base_horas_costura, base_horas_diseno)
SELECT DISTINCT dp.idempresa, dp.familia, 2.30, 2.30
FROM manumoda.diseno_programacion dp
WHERE dp.familia IS NOT NULL
ON CONFLICT (idempresa, familia) DO NOTHING;

COMMENT ON TABLE manumoda.complejidad_familias IS
  'Hora base de costura por familia de prenda. Es el piso de la fórmula '
  '(base × factor categoría + checkboxes) × muestras. Se administra desde '
  'Diseño → Multiplicadores.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Trigger: escotilla de recálculo y total de cumplidas
--
--    Reemplaza la función del script 012. Tres cambios sobre aquella:
--
--    a) La GUC `manumoda.recalcular_horas` fuerza el recálculo aunque el
--       registro esté evaluado: 'costura', 'diseno' o 'todo'. Sin esto
--       habría que duplicar la fórmula en cada migración de recálculo, y
--       una copia se desfasa tarde o temprano. Se fija con set_config
--       local, así que muere con la transacción y no puede quedarse
--       prendida por accidente.
--
--    b) `horas_totales_cumplidas` se deriva como el resto de las columnas
--       calculadas, en vez de quedarse con lo último que le escribieron.
--
--    c) Se quita el factor de tipo de costura. Era código muerto: la
--       variable arrancaba en 1 y la única rama que existía la volvía a
--       poner en 1.0. Dejarlo ahí sugería una regla que nunca operó.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_calcular_horas_diseno_programacion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_es_update           boolean := (TG_OP = 'UPDATE');
  v_forzar              text    := COALESCE(
                                     current_setting('manumoda.recalcular_horas', true), '');
  v_recalc_diseno       boolean;
  v_recalc_costura      boolean;
  -- diseño (catálogos)
  v_horas_base          numeric := 0;
  v_tipo_mult           numeric := 1;
  v_cat_mult            numeric := 1;
  v_adicion_horas       numeric := 0;
  -- costura (complejidad_familias)
  v_base_costura        numeric := 0;
  v_factor_cat_costura  numeric := 1;
  v_checkboxes          integer := 0;
  v_factor_muestras     numeric := 1;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════════
  -- ¿Hay que recalcular? (política de congelado, script 012)
  -- ══════════════════════════════════════════════════════════════════════════

  IF NOT v_es_update THEN
    v_recalc_diseno  := true;
    v_recalc_costura := true;
  ELSE
    v_recalc_diseno := v_forzar IN ('todo', 'diseno')
      OR (OLD.cumplimiento_diseno IS NOT TRUE) OR (
         NEW.idprenda              IS DISTINCT FROM OLD.idprenda
      OR NEW.iddisenadora          IS DISTINCT FROM OLD.iddisenadora
      OR NEW.tipo                  IS DISTINCT FROM OLD.tipo
      OR NEW.categoria_demografica IS DISTINCT FROM OLD.categoria_demografica
      OR NEW.muchas_operaciones    IS DISTINCT FROM OLD.muchas_operaciones
      OR NEW.telas_pesadas         IS DISTINCT FROM OLD.telas_pesadas
      OR NEW.muchas_habilitaciones IS DISTINCT FROM OLD.muchas_habilitaciones
      OR NEW.prenda_compleja       IS DISTINCT FROM OLD.prenda_compleja
    );

    v_recalc_costura := v_forzar IN ('todo', 'costura')
      OR (OLD.cumplimiento_costura IS NOT TRUE) OR (
         NEW.idcosturera           IS DISTINCT FROM OLD.idcosturera
      OR NEW.familia               IS DISTINCT FROM OLD.familia
      OR NEW.tipo                  IS DISTINCT FROM OLD.tipo
      OR NEW.categoria_demografica IS DISTINCT FROM OLD.categoria_demografica
      OR NEW.numero_muestras       IS DISTINCT FROM OLD.numero_muestras
      OR NEW.muchas_operaciones    IS DISTINCT FROM OLD.muchas_operaciones
      OR NEW.telas_pesadas         IS DISTINCT FROM OLD.telas_pesadas
      OR NEW.muchas_habilitaciones IS DISTINCT FROM OLD.muchas_habilitaciones
      OR NEW.prenda_compleja       IS DISTINCT FROM OLD.prenda_compleja
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- FECHA DE ENTREGA — copia denormalizada desde la orden (script 008)
  -- ══════════════════════════════════════════════════════════════════════════

  IF NEW.folio IS NOT NULL THEN
    SELECT o.fecha_cancelacion INTO NEW.fecha_cancelacion
    FROM manumoda.ordenes_produccion o
    WHERE o.folio = NEW.folio AND o.idempresa = NEW.idempresa
    LIMIT 1;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- DISEÑO — fórmula de catálogos
  -- ══════════════════════════════════════════════════════════════════════════

  IF NOT v_recalc_diseno THEN
    -- CONGELADO: ignorar cualquier valor que mande el cliente
    NEW.horas_plan_diseno := OLD.horas_plan_diseno;

  ELSIF NEW.iddisenadora IS NULL THEN
    NEW.horas_plan_diseno := 0;

  ELSIF NEW.idprenda IS NOT NULL THEN
    SELECT horas_base INTO v_horas_base
    FROM manumoda.cat_prendas
    WHERE id = NEW.idprenda AND idempresa = NEW.idempresa
    LIMIT 1;

    SELECT multiplicador INTO v_tipo_mult
    FROM manumoda.cat_tipo_diseno
    WHERE nombre = NEW.tipo AND idempresa = NEW.idempresa
    LIMIT 1;
    v_tipo_mult := COALESCE(v_tipo_mult, 1);

    SELECT multiplicador INTO v_cat_mult
    FROM manumoda.cat_categoria_demografica
    WHERE nombre = NEW.categoria_demografica AND idempresa = NEW.idempresa
    LIMIT 1;
    v_cat_mult := COALESCE(v_cat_mult, 1);

    SELECT COALESCE(SUM(
      CASE
        WHEN ca.clave = 'muchas_operaciones'    AND NEW.muchas_operaciones    IS TRUE THEN ca.horas
        WHEN ca.clave = 'telas_pesadas'         AND NEW.telas_pesadas         IS TRUE THEN ca.horas
        WHEN ca.clave = 'muchas_habilitaciones' AND NEW.muchas_habilitaciones IS TRUE THEN ca.horas
        WHEN ca.clave = 'prenda_compleja'       AND NEW.prenda_compleja       IS TRUE THEN ca.horas
        ELSE 0
      END
    ), 0) INTO v_adicion_horas
    FROM manumoda.cat_adiciones_diseno ca
    WHERE ca.idempresa = NEW.idempresa;

    NEW.horas_plan_diseno :=
      ROUND((COALESCE(v_horas_base, 0) * v_tipo_mult * v_cat_mult + v_adicion_horas) * 100) / 100;
  END IF;
  -- Si recalc + iddisenadora NOT NULL + idprenda NULL: no tocar horas_plan_diseno
  -- (registros sin prenda vinculada conservan el valor manual/existente)

  -- horas_diseno_cumplidas — SIEMPRE derivada del plan vigente de la fila
  IF COALESCE(NEW.cumplimiento_diseno, false) THEN
    IF COALESCE(NEW.rechazo_orden, false) THEN
      NEW.horas_diseno_cumplidas := NEW.horas_plan_diseno / 2;
    ELSE
      NEW.horas_diseno_cumplidas := NEW.horas_plan_diseno;
    END IF;
  ELSE
    NEW.horas_diseno_cumplidas := 0;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- COSTURA — fórmula de complejidad_familias
  --
  --   (base de la familia × factor categoría + checkboxes) × muestras
  -- ══════════════════════════════════════════════════════════════════════════

  IF NOT v_recalc_costura THEN
    -- CONGELADO
    NEW.horas_plan_costura := OLD.horas_plan_costura;

  ELSIF NEW.idcosturera IS NULL THEN
    -- Sin costurera no hay costura que pagar
    NEW.horas_plan_costura := 0;

  ELSE
    SELECT base_horas_costura INTO v_base_costura
    FROM manumoda.complejidad_familias
    WHERE familia = NEW.familia AND idempresa = NEW.idempresa
    LIMIT 1;
    v_base_costura := COALESCE(v_base_costura, 0);

    IF NEW.categoria_demografica ILIKE 'BEBE' OR NEW.categoria_demografica ILIKE 'NIÑA'
       OR NEW.categoria_demografica ILIKE 'Bebé' THEN
      v_factor_cat_costura := 0.5;
    END IF;

    v_checkboxes := 0;
    IF COALESCE(NEW.muchas_operaciones,    false) THEN v_checkboxes := v_checkboxes + 1; END IF;
    IF COALESCE(NEW.telas_pesadas,         false) THEN v_checkboxes := v_checkboxes + 1; END IF;
    IF COALESCE(NEW.muchas_habilitaciones, false) THEN v_checkboxes := v_checkboxes + 1; END IF;
    IF COALESCE(NEW.prenda_compleja,       false) THEN v_checkboxes := v_checkboxes + 1; END IF;

    v_factor_muestras := GREATEST(COALESCE(NEW.numero_muestras, 1), 1);

    NEW.horas_plan_costura :=
      ROUND(((v_base_costura * v_factor_cat_costura + v_checkboxes)
             * v_factor_muestras) * 100) / 100;
  END IF;

  -- horas_costura_cumplidas — SIEMPRE derivada
  IF COALESCE(NEW.cumplimiento_costura, false) THEN
    IF COALESCE(NEW.rechazo_orden, false) THEN
      NEW.horas_costura_cumplidas := NEW.horas_plan_costura / 2;
    ELSE
      NEW.horas_costura_cumplidas := NEW.horas_plan_costura;
    END IF;
  ELSE
    NEW.horas_costura_cumplidas := 0;
  END IF;

  -- ── Totales ───────────────────────────────────────────────────────────────
  NEW.horas_totales_plan :=
    COALESCE(NEW.horas_plan_diseno, 0) + COALESCE(NEW.horas_plan_costura, 0);

  NEW.horas_totales_cumplidas :=
    COALESCE(NEW.horas_diseno_cumplidas, 0) + COALESCE(NEW.horas_costura_cumplidas, 0);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_calcular_horas_diseno_programacion() IS
  'Calcula plan y cumplidas de diseño y costura. Congela el plan de un '
  'registro ya evaluado salvo que cambie un insumo de la fórmula, o que la '
  'transacción declare manumoda.recalcular_horas en todo/diseno/costura.';

-- El trigger existente (trg_calcular_horas_diseno_programacion, script 006)
-- ya apunta a esta función — no hay que recrearlo.

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Un solo nombre para el rechazo
--
--    'RECHAZADO' no existe en cat_tipo_diseno, así que sus 13 registros
--    calculaban con multiplicador 1.00 en vez del 0.80 que el catálogo
--    define para 'RECHAZO'.
--
--    Cambiar `tipo` ya dispara el recálculo por sí solo —es un insumo de
--    la fórmula—, así que no hace falta forzar nada aquí. Bajan 2.76 h
--    repartidas en 6 registros; los otros 7 tienen idprenda NULL y su
--    plan de diseño no se recalcula.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE manumoda.diseno_programacion
SET tipo = 'RECHAZO'
WHERE tipo = 'RECHAZADO';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Recálculo forzado de costura
--
--    El UPDATE no cambia ninguna columna a propósito: basta con tocar la
--    fila para que corra el trigger BEFORE UPDATE. Con la GUC en 'costura'
--    se descongela el plan de costura y se deja intacto el de diseño.
--    Las cumplidas y los dos totales se derivan siempre, así que de paso
--    quedan al día en los 170 registros.
--
--    set_config(..., true) es local a la transacción: se revierte sola.
--    El DO block evita un BEGIN/COMMIT explícito, que chocaría con el
--    editor SQL de Supabase (que ya envuelve el script en una transacción).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM set_config('manumoda.recalcular_horas', 'costura', true);

  UPDATE manumoda.diseno_programacion
  SET semana = semana;

  PERFORM set_config('manumoda.recalcular_horas', '', true);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Ningún registro con costurera puede quedar con plan de costura en cero.
--    Debe devolver 0 filas.
SELECT id, folio, familia, horas_plan_costura
FROM manumoda.diseno_programacion
WHERE idempresa = 1
  AND idcosturera IS NOT NULL
  AND COALESCE(horas_plan_costura, 0) = 0;

-- 2. Lo mismo del lado de diseño. Debe devolver 0 filas.
SELECT id, folio, familia, horas_plan_diseno
FROM manumoda.diseno_programacion
WHERE idempresa = 1
  AND iddisenadora IS NOT NULL
  AND COALESCE(horas_plan_diseno, 0) = 0;

-- 3. Los totales deben cuadrar con sus partes. Debe devolver 0 filas.
SELECT id, folio, horas_plan_diseno, horas_plan_costura, horas_totales_plan,
       horas_diseno_cumplidas, horas_costura_cumplidas, horas_totales_cumplidas
FROM manumoda.diseno_programacion
WHERE idempresa = 1
  AND (abs(COALESCE(horas_totales_plan, 0)
           - COALESCE(horas_plan_diseno, 0) - COALESCE(horas_plan_costura, 0)) > 0.005
    OR abs(COALESCE(horas_totales_cumplidas, 0)
           - COALESCE(horas_diseno_cumplidas, 0) - COALESCE(horas_costura_cumplidas, 0)) > 0.005);

-- 4. Un solo nombre de rechazo. Debe devolver 0 filas.
SELECT DISTINCT tipo FROM manumoda.diseno_programacion WHERE tipo = 'RECHAZADO';

-- 5. Ninguna familia en uso puede quedarse sin hora base. Debe devolver 0 filas.
SELECT DISTINCT dp.familia
FROM manumoda.diseno_programacion dp
LEFT JOIN manumoda.complejidad_familias cf
  ON cf.familia = dp.familia AND cf.idempresa = dp.idempresa
WHERE dp.idempresa = 1 AND dp.familia IS NOT NULL AND cf.id IS NULL;

-- 6. El nuevo reparto de horas, para contrastar contra el impacto declarado:
--    plan costura ≈ 857.65 h · plan diseño ≈ 578.83 h.
SELECT
  COUNT(*)                                    AS registros,
  COUNT(*) FILTER (WHERE idcosturera IS NULL) AS sin_costurera,
  ROUND(SUM(horas_plan_diseno), 2)            AS plan_diseno,
  ROUND(SUM(horas_plan_costura), 2)           AS plan_costura,
  ROUND(SUM(horas_totales_cumplidas), 2)      AS cumplidas
FROM manumoda.diseno_programacion
WHERE idempresa = 1;

-- 7. La congelación sigue viva: cambiar la semana de un registro evaluado
--    NO debe mover sus horas.
--      UPDATE manumoda.diseno_programacion SET semana = semana WHERE id = <id>;

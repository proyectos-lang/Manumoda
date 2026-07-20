-- ============================================================
-- Trigger de horas con política "congelar tras evaluación"
--
-- PROBLEMA QUE CORRIGE:
--   La versión anterior (script 006) recalculaba horas_plan_diseno
--   y horas_plan_costura en CADA update de la fila, con los
--   catálogos VIGENTES. Reprogramar la semana, o el trigger de
--   propagación de fecha_cancelacion (script 008), reescribían
--   horas históricas de registros ya evaluados — y los bonos
--   pagados dejaban de cuadrar con lo registrado.
--
-- POLÍTICA NUEVA:
--   · INSERT           → siempre calcula (igual que antes).
--   · UPDATE           → recalcula el plan SOLO si:
--       a) el registro NO está evaluado
--          (OLD.cumplimiento_diseno / cumplimiento_costura no es true), o
--       b) cambió un insumo de la fórmula
--          (prenda, tipo, categoría, checkboxes, colaborador, muestras).
--     Si está evaluado y no cambiaron insumos, el plan queda
--     CONGELADO (se fuerza el valor de OLD, ignorando lo que
--     mande el cliente).
--   · horas_*_cumplidas → se derivan SIEMPRE del plan vigente de
--     la fila (congelado o no) + cumplimiento + rechazo.
--   · La copia de fecha_cancelacion se mantiene igual.
--
-- Reemplaza la función del script 006 (mismo nombre, mismo trigger).
-- ============================================================

CREATE OR REPLACE FUNCTION manumoda.fn_calcular_horas_diseno_programacion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_es_update           boolean := (TG_OP = 'UPDATE');
  v_recalc_diseno       boolean;
  v_recalc_costura      boolean;
  -- diseño (catálogos)
  v_horas_base          numeric := 0;
  v_tipo_mult           numeric := 1;
  v_cat_mult            numeric := 1;
  v_adicion_horas       numeric := 0;
  -- costura (fórmula complejidad_familias)
  v_base_costura        numeric := 0;
  v_factor_cat_costura  numeric := 1;
  v_factor_tipo_costura numeric := 1;
  v_checkboxes          integer := 0;
  v_factor_muestras     numeric := 1;
BEGIN

  -- ════════════════════════════════════════════════════════════════════════════
  -- ¿Hay que recalcular? (política de congelado)
  -- ════════════════════════════════════════════════════════════════════════════

  IF NOT v_es_update THEN
    v_recalc_diseno  := true;
    v_recalc_costura := true;
  ELSE
    v_recalc_diseno := (OLD.cumplimiento_diseno IS NOT TRUE) OR (
         NEW.idprenda              IS DISTINCT FROM OLD.idprenda
      OR NEW.iddisenadora          IS DISTINCT FROM OLD.iddisenadora
      OR NEW.tipo                  IS DISTINCT FROM OLD.tipo
      OR NEW.categoria_demografica IS DISTINCT FROM OLD.categoria_demografica
      OR NEW.muchas_operaciones    IS DISTINCT FROM OLD.muchas_operaciones
      OR NEW.telas_pesadas         IS DISTINCT FROM OLD.telas_pesadas
      OR NEW.muchas_habilitaciones IS DISTINCT FROM OLD.muchas_habilitaciones
      OR NEW.prenda_compleja       IS DISTINCT FROM OLD.prenda_compleja
    );

    v_recalc_costura := (OLD.cumplimiento_costura IS NOT TRUE) OR (
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

  -- ════════════════════════════════════════════════════════════════════════════
  -- FECHA DE ENTREGA — copia denormalizada desde la orden (script 008)
  -- ════════════════════════════════════════════════════════════════════════════

  IF NEW.folio IS NOT NULL THEN
    SELECT o.fecha_cancelacion INTO NEW.fecha_cancelacion
    FROM manumoda.ordenes_produccion o
    WHERE o.folio = NEW.folio AND o.idempresa = NEW.idempresa
    LIMIT 1;
  END IF;

  -- ════════════════════════════════════════════════════════════════════════════
  -- DISEÑO — fórmula de catálogos
  -- ════════════════════════════════════════════════════════════════════════════

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

  -- ════════════════════════════════════════════════════════════════════════════
  -- COSTURA — fórmula de complejidad_familias
  -- ════════════════════════════════════════════════════════════════════════════

  IF NOT v_recalc_costura THEN
    -- CONGELADO
    NEW.horas_plan_costura := OLD.horas_plan_costura;

  ELSIF NEW.idcosturera IS NULL THEN
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

    IF NEW.tipo IN ('RESURTIDO', 'RECHAZADO') THEN
      v_factor_tipo_costura := 1.0;
    END IF;

    v_checkboxes := 0;
    IF COALESCE(NEW.muchas_operaciones,    false) THEN v_checkboxes := v_checkboxes + 1; END IF;
    IF COALESCE(NEW.telas_pesadas,         false) THEN v_checkboxes := v_checkboxes + 1; END IF;
    IF COALESCE(NEW.muchas_habilitaciones, false) THEN v_checkboxes := v_checkboxes + 1; END IF;
    IF COALESCE(NEW.prenda_compleja,       false) THEN v_checkboxes := v_checkboxes + 1; END IF;

    v_factor_muestras := GREATEST(COALESCE(NEW.numero_muestras, 1), 1);

    NEW.horas_plan_costura :=
      ((v_base_costura * v_factor_cat_costura * v_factor_tipo_costura) + v_checkboxes)
      * v_factor_muestras;
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

  -- ── Total ─────────────────────────────────────────────────────────────────
  NEW.horas_totales_plan :=
    COALESCE(NEW.horas_plan_diseno, 0) + COALESCE(NEW.horas_plan_costura, 0);

  RETURN NEW;
END;
$$;

-- El trigger existente (trg_calcular_horas_diseno_programacion, script 006)
-- ya apunta a esta función — no hay que recrearlo.

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Tomar un folio EVALUADO (cumplimiento_diseno = true), anotar sus horas:
--      SELECT id, folio, semana, horas_plan_diseno FROM manumoda.diseno_programacion
--      WHERE cumplimiento_diseno = true LIMIT 1;
-- 2. Cambiar su semana:
--      UPDATE manumoda.diseno_programacion SET semana = semana WHERE id = <id>;
--      (o cambiar fecha_cancelacion de su orden)
--    → horas_plan_diseno NO debe cambiar.
-- 3. Cambiar su idprenda a otra prenda:
--    → horas_plan_diseno SÍ debe recalcularse.

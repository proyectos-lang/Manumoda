-- ============================================================
-- Actualiza el trigger de cálculo de horas en diseno_programacion
--
-- CONTEXTO:
--   El trigger anterior usaba complejidad_familias (fórmula vieja
--   por familia). Ahora Diseño usa los catálogos nuevos:
--     cat_prendas          → horas_base por prenda (idprenda)
--     cat_tipo_diseno      → multiplicador por tipo
--     cat_categoria_demografica → multiplicador por categoría
--     cat_adiciones_diseno → horas adicionales (muchas_ops, telas, etc.)
--
--   Costura mantiene la fórmula de complejidad_familias ya que
--   no tiene catálogo nuevo aún.
--
-- ORDEN DE EJECUCIÓN:
--   1. Este script (006) — instala el trigger nuevo
--   2. Script 004        — hace UPDATE en todos los registros;
--                          el trigger nuevo se dispara y corrige
--                          horas_plan_diseno + horas_diseno_cumplidas
--   3. Script 005        — actualiza la vista vw_bonos_diseno
--
-- NOTA: Reemplaza la función existente (sea cual sea su nombre actual).
--   Si el trigger viejo tiene un nombre diferente, búscalo en Supabase
--   con: SELECT trigger_name FROM information_schema.triggers
--        WHERE event_object_schema = 'manumoda'
--          AND event_object_table = 'diseno_programacion';
--   y ejecuta: DROP TRIGGER <nombre_viejo> ON manumoda.diseno_programacion;
-- ============================================================

-- ── 1. Función del trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION manumoda.fn_calcular_horas_diseno_programacion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
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
  -- DISEÑO — fórmula de catálogos
  -- ════════════════════════════════════════════════════════════════════════════

  IF NEW.iddisenadora IS NULL THEN
    NEW.horas_plan_diseno := 0;

  ELSIF NEW.idprenda IS NOT NULL THEN
    -- horas base de la prenda
    SELECT horas_base INTO v_horas_base
    FROM manumoda.cat_prendas
    WHERE id = NEW.idprenda AND idempresa = NEW.idempresa
    LIMIT 1;

    -- multiplicador de tipo de diseño
    SELECT multiplicador INTO v_tipo_mult
    FROM manumoda.cat_tipo_diseno
    WHERE nombre = NEW.tipo AND idempresa = NEW.idempresa
    LIMIT 1;
    v_tipo_mult := COALESCE(v_tipo_mult, 1);

    -- multiplicador de categoría demográfica
    SELECT multiplicador INTO v_cat_mult
    FROM manumoda.cat_categoria_demografica
    WHERE nombre = NEW.categoria_demografica AND idempresa = NEW.idempresa
    LIMIT 1;
    v_cat_mult := COALESCE(v_cat_mult, 1);

    -- suma de horas de adiciones activas
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
  -- Si iddisenadora IS NOT NULL pero idprenda IS NULL: no tocar horas_plan_diseno

  -- horas_diseno_cumplidas
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
  -- COSTURA — mantiene fórmula de complejidad_familias
  -- ════════════════════════════════════════════════════════════════════════════

  SELECT base_horas_costura INTO v_base_costura
  FROM manumoda.complejidad_familias
  WHERE familia = NEW.familia AND idempresa = NEW.idempresa
  LIMIT 1;
  v_base_costura := COALESCE(v_base_costura, 0);

  -- factor categoría
  IF NEW.categoria_demografica ILIKE 'BEBE' OR NEW.categoria_demografica ILIKE 'NIÑA'
     OR NEW.categoria_demografica ILIKE 'Bebé' THEN
    v_factor_cat_costura := 0.5;
  END IF;

  -- factor tipo
  IF NEW.tipo IN ('RESURTIDO', 'RECHAZADO') THEN
    v_factor_tipo_costura := 1.0;
  END IF;

  -- checkboxes
  v_checkboxes := 0;
  IF COALESCE(NEW.muchas_operaciones,    false) THEN v_checkboxes := v_checkboxes + 1; END IF;
  IF COALESCE(NEW.telas_pesadas,         false) THEN v_checkboxes := v_checkboxes + 1; END IF;
  IF COALESCE(NEW.muchas_habilitaciones, false) THEN v_checkboxes := v_checkboxes + 1; END IF;
  IF COALESCE(NEW.prenda_compleja,       false) THEN v_checkboxes := v_checkboxes + 1; END IF;

  v_factor_muestras := GREATEST(COALESCE(NEW.numero_muestras, 1), 1);

  IF NEW.idcosturera IS NULL THEN
    NEW.horas_plan_costura := 0;
  ELSE
    NEW.horas_plan_costura :=
      ((v_base_costura * v_factor_cat_costura * v_factor_tipo_costura) + v_checkboxes)
      * v_factor_muestras;
  END IF;

  -- horas_costura_cumplidas
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
  NEW.horas_totales_plan := NEW.horas_plan_diseno + NEW.horas_plan_costura;

  RETURN NEW;
END;
$$;

-- ── 2. Trigger ───────────────────────────────────────────────────────────────

-- Elimina el trigger con el nombre nuevo por si ya existe (re-run seguro)
DROP TRIGGER IF EXISTS trg_calcular_horas_diseno_programacion
  ON manumoda.diseno_programacion;

CREATE TRIGGER trg_calcular_horas_diseno_programacion
  BEFORE INSERT OR UPDATE
  ON manumoda.diseno_programacion
  FOR EACH ROW
  EXECUTE FUNCTION manumoda.fn_calcular_horas_diseno_programacion();

-- ── 3. Eliminar trigger viejo (busca el nombre real si es diferente) ─────────
--
-- Para ver todos los triggers de la tabla:
--   SELECT trigger_name FROM information_schema.triggers
--   WHERE event_object_schema = 'manumoda'
--     AND event_object_table  = 'diseno_programacion';
--
-- Si el trigger viejo tiene otro nombre, ejecuta:
--   DROP TRIGGER <nombre_viejo> ON manumoda.diseno_programacion;

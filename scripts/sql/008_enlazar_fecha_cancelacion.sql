-- ============================================================
-- Enlazar fecha_cancelacion (fecha de entrega) a las etapas de
-- Diseño y Corte, incluyendo los datos históricos ya capturados.
--
-- Problema:
--   ni diseno_programacion ni corte_programacion conocen la fecha
--   de entrega del pedido, así que sus módulos no pueden avisar
--   de pedidos próximos a vencer.
--
-- Solución:
--   1. Agregar la columna a ambas tablas
--   2. Backfill retroactivo desde ordenes_produccion por folio
--   3. Triggers de sincronización en ambas direcciones
--
-- PREREQUISITO: script 006 (trigger de horas de diseño) instalado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.diseno_programacion
  ADD COLUMN IF NOT EXISTS fecha_cancelacion date;

ALTER TABLE manumoda.corte_programacion
  ADD COLUMN IF NOT EXISTS fecha_cancelacion date;

COMMENT ON COLUMN manumoda.diseno_programacion.fecha_cancelacion IS
  'Fecha de entrega del pedido. Copia denormalizada de ordenes_produccion, mantenida por trigger.';
COMMENT ON COLUMN manumoda.corte_programacion.fecha_cancelacion IS
  'Fecha de entrega del pedido. Copia denormalizada de ordenes_produccion, mantenida por trigger.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Backfill retroactivo
-- ════════════════════════════════════════════════════════════════════════════

UPDATE manumoda.diseno_programacion dp
SET fecha_cancelacion = o.fecha_cancelacion
FROM manumoda.ordenes_produccion o
WHERE o.folio = dp.folio
  AND o.idempresa = dp.idempresa
  AND dp.fecha_cancelacion IS DISTINCT FROM o.fecha_cancelacion;

UPDATE manumoda.corte_programacion cp
SET fecha_cancelacion = o.fecha_cancelacion
FROM manumoda.ordenes_produccion o
WHERE o.folio = cp.folio
  AND o.idempresa = cp.idempresa
  AND cp.fecha_cancelacion IS DISTINCT FROM o.fecha_cancelacion;

-- ════════════════════════════════════════════════════════════════════════════
-- 3a. Trigger en corte_programacion: rellenar al insertar/actualizar
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_corte_set_fecha_cancelacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folio IS NOT NULL THEN
    SELECT o.fecha_cancelacion INTO NEW.fecha_cancelacion
    FROM manumoda.ordenes_produccion o
    WHERE o.folio = NEW.folio AND o.idempresa = NEW.idempresa
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_corte_set_fecha_cancelacion
  ON manumoda.corte_programacion;

CREATE TRIGGER trg_corte_set_fecha_cancelacion
  BEFORE INSERT OR UPDATE OF folio
  ON manumoda.corte_programacion
  FOR EACH ROW
  EXECUTE FUNCTION manumoda.fn_corte_set_fecha_cancelacion();

-- ════════════════════════════════════════════════════════════════════════════
-- 3b. Propagación desde ordenes_produccion hacia abajo
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_propagar_fecha_cancelacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fecha_cancelacion IS DISTINCT FROM OLD.fecha_cancelacion THEN
    UPDATE manumoda.diseno_programacion
      SET fecha_cancelacion = NEW.fecha_cancelacion
      WHERE folio = NEW.folio
        AND idempresa = NEW.idempresa
        AND fecha_cancelacion IS DISTINCT FROM NEW.fecha_cancelacion;

    UPDATE manumoda.corte_programacion
      SET fecha_cancelacion = NEW.fecha_cancelacion
      WHERE folio = NEW.folio
        AND idempresa = NEW.idempresa
        AND fecha_cancelacion IS DISTINCT FROM NEW.fecha_cancelacion;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagar_fecha_cancelacion
  ON manumoda.ordenes_produccion;

CREATE TRIGGER trg_propagar_fecha_cancelacion
  AFTER UPDATE OF fecha_cancelacion
  ON manumoda.ordenes_produccion
  FOR EACH ROW
  EXECUTE FUNCTION manumoda.fn_propagar_fecha_cancelacion();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Exponer la columna en vw_plan_corte_detalle
-- ════════════════════════════════════════════════════════════════════════════
--
-- El módulo de Corte lee fecha_cancelacion desde esa vista para las alertas
-- de vencimiento. Se resuelve en el script 010 — ejecutarlo después de éste.

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- Debe devolver 0 en ambas columnas
SELECT
  (SELECT COUNT(*) FROM manumoda.diseno_programacion dp
     JOIN manumoda.ordenes_produccion o
       ON o.folio = dp.folio AND o.idempresa = dp.idempresa
    WHERE dp.fecha_cancelacion IS DISTINCT FROM o.fecha_cancelacion) AS diseno_desincronizados,
  (SELECT COUNT(*) FROM manumoda.corte_programacion cp
     JOIN manumoda.ordenes_produccion o
       ON o.folio = cp.folio AND o.idempresa = cp.idempresa
    WHERE cp.fecha_cancelacion IS DISTINCT FROM o.fecha_cancelacion) AS corte_desincronizados;

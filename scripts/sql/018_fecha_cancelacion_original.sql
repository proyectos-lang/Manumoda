-- ============================================================
-- Fecha de entrega original
--
-- Cuando la fecha_cancelacion (fecha de entrega) de una orden
-- cambia, se pierde la referencia de cuál era la fecha comprometida
-- originalmente. Esta migración guarda la primera fecha de entrega
-- de cada orden y la expone en vw_resumen_operacion para poder
-- resaltar el cambio.
--
-- PREREQUISITO: script 016 ejecutado (esta migración reconstruye
-- vw_resumen_operacion partiendo de esa definición).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columna nueva
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS fecha_cancelacion_original date;

COMMENT ON COLUMN manumoda.ordenes_produccion.fecha_cancelacion_original IS
  'Primera fecha de entrega de la orden. Se fija al insertar y NO cambia; '
  'si difiere de fecha_cancelacion, la entrega fue reprogramada.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Backfill — la original de lo existente es su fecha actual
-- ════════════════════════════════════════════════════════════════════════════

UPDATE manumoda.ordenes_produccion
SET fecha_cancelacion_original = fecha_cancelacion
WHERE fecha_cancelacion_original IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Trigger — fijar la original al insertar (nunca se sobreescribe)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_set_fecha_cancelacion_original()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fecha_cancelacion_original IS NULL THEN
    NEW.fecha_cancelacion_original := NEW.fecha_cancelacion;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_fecha_cancelacion_original
  ON manumoda.ordenes_produccion;

CREATE TRIGGER trg_set_fecha_cancelacion_original
  BEFORE INSERT
  ON manumoda.ordenes_produccion
  FOR EACH ROW
  EXECUTE FUNCTION manumoda.fn_set_fecha_cancelacion_original();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. vw_resumen_operacion — exponer fecha_cancelacion_original
--    (misma definición del script 016 + la columna nueva al final)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_resumen_operacion AS
SELECT
    o.id,
    o.idempresa,
    o.folio,
    o.piezas,
    o.fase_actual,
    o.fecha_cancelacion,
    o.maquilero AS maquilero_nombre,
    CASE
        WHEN o.fecha_facturacion IS NOT NULL THEN 'Entregado'::text
        WHEN o.fecha_cancelacion IS NULL THEN 'Sin Fecha'::text
        WHEN o.fecha_cancelacion < CURRENT_DATE THEN 'Vencido'::text
        WHEN (CURRENT_DATE +
            CASE o.fase_actual
                WHEN 'S1'::text THEN 54
                WHEN 'S2'::text THEN 46
                WHEN 'S3'::text THEN 40
                WHEN 'S4'::text THEN 32
                WHEN 'S5'::text THEN 25
                WHEN 'S6'::text THEN 20
                WHEN 'S7'::text THEN 14
                ELSE 0
            END) > o.fecha_cancelacion THEN 'A Destiempo'::text
        WHEN (o.fecha_cancelacion - CURRENT_DATE) <= 7 THEN 'En Riesgo'::text
        ELSE 'A Tiempo'::text
    END AS riesgo_entrega,
    o.fecha_s1 - COALESCE(o.fecha_pedido, date(o.created_at)) AS dias_prog_s1,
    o.fecha_s2 - o.fecha_s1 AS dias_s1_s2,
    o.fecha_s3 - o.fecha_s2 AS dias_s2_s3,
    o.fecha_s4 - o.fecha_s3 AS dias_s3_s4,
    o.fecha_s5 - o.fecha_s4 AS dias_s4_s5,
    o.fecha_s6 - o.fecha_s5 AS dias_s5_s6,
    o.fecha_s7 - o.fecha_s6 AS dias_s6_s7,
    o.fecha_s1,
    o.fecha_s2,
    o.fecha_s3,
    o.fecha_s4,
    o.fecha_s5,
    o.fecha_s6,
    o.fecha_s7,
    o.calidad,
    o.familia,
    dis.nombre AS nombre_disenador,
    cos.nombre AS nombre_costurera,
    o.fecha_contra_muestra,
    o.modelo,
    o.cliente,
    o.fecha_limite_confirmacion,
    o.fecha_ultima_revision,
    o.fecha_facturacion,
    -- NUEVA (al final para no romper columnas existentes)
    o.fecha_cancelacion_original
FROM manumoda.ordenes_produccion o
LEFT JOIN LATERAL (
    SELECT iddisenadora, idcosturera
    FROM manumoda.diseno_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
    ORDER BY id DESC
    LIMIT 1
) dp ON true
LEFT JOIN manumoda.disenadoras dis ON dp.iddisenadora = dis.id
LEFT JOIN manumoda.costureras   cos ON dp.idcosturera  = cos.id
WHERE o.fase_actual <> 'Por Programar'::text
  AND o.fase_actual <> 'S7'::text;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

SELECT folio, fecha_cancelacion, fecha_cancelacion_original
FROM manumoda.vw_resumen_operacion
WHERE fecha_cancelacion IS DISTINCT FROM fecha_cancelacion_original
LIMIT 20;

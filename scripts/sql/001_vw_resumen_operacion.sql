-- ============================================================
-- Vista: vw_resumen_operacion
-- Cambios:
--   - LATERAL JOIN en diseno_programacion (evita filas duplicadas
--     cuando una orden tiene varias programaciones por reprogramar)
--   - Columnas nuevas al final: modelo, cliente, fecha_limite_confirmacion
-- ============================================================

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
    -- Columnas nuevas (siempre al final para no romper columnas existentes)
    o.modelo,
    o.cliente,
    o.fecha_limite_confirmacion
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

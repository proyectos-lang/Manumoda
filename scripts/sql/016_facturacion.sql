-- ============================================================
-- Estado "Facturado" — cierre del ciclo de una orden
--
-- Una orden que llega a S7 todavía puede aparecer como vencida
-- porque la fecha de entrega ya pasó. Al marcarla como facturada
-- se considera ENTREGADA: deja de contar como vencida y deja de
-- generar alertas.
--
-- DISEÑO: se usa una columna de fecha propia en vez de un valor
-- nuevo de fase_actual, porque fase_actual se deriva de las fechas
-- S1..S7 (detectPhase en el frontend) y sobrescribiría cualquier
-- valor manual al guardar un avance.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columna nueva
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS fecha_facturacion date;

COMMENT ON COLUMN manumoda.ordenes_produccion.fecha_facturacion IS
  'Fecha de facturación. Si tiene valor, la orden se considera entregada: '
  'no cuenta como vencida ni genera alertas de vencimiento.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_resumen_operacion — riesgo 'Entregado' con prioridad
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
        -- Facturada = entregada: gana sobre cualquier otro estado
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
    -- NUEVA (al final para no romper columnas existentes)
    o.fecha_facturacion
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
-- 3. vw_seguimiento_integrado — mismo cambio
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_seguimiento_integrado AS
SELECT
    o.id,
    o.idempresa,
    o.folio,
    o.modelo,
    o.familia,
    o.cliente,
    o.maquilero AS maquilero_nombre,
    o.piezas,
    o.fase_actual,

    -- ── Fechas de la orden ──────────────────────────────────────────────────
    o.fecha_pedido,
    o.fecha_limite_confirmacion,
    o.fecha_contra_muestra,
    o.fecha_cancelacion,
    o.fecha_ultima_revision,

    -- ── Etapa 1: Diseño ─────────────────────────────────────────────────────
    dp.fecha                AS fecha_diseno,
    dis.nombre              AS nombre_disenador,
    dp.cumplimiento_diseno,
    o.fecha_aprobacion_diseno,
    o.no_requiere_diseno,

    -- ── Etapa 2: Corte ──────────────────────────────────────────────────────
    cp.fecha                AS fecha_corte,
    cor.nombre              AS nombre_cortador,
    cp.cumplimiento_corte,
    o.no_requiere_corte,

    -- ── Etapa 3: Maquila ────────────────────────────────────────────────────
    o.fecha_s1,
    o.fecha_s2,
    o.fecha_s3,
    o.fecha_s4,
    o.fecha_s5,
    o.fecha_s6,
    o.fecha_s7,
    o.calidad,
    o.tipo_revision,
    o.habilitaciones_insumos,
    o.comentarios_generales,

    -- ── Riesgo de entrega ───────────────────────────────────────────────────
    CASE
        -- Facturada = entregada: gana sobre cualquier otro estado
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

    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes,

    -- NUEVA (al final)
    o.fecha_facturacion

FROM manumoda.ordenes_produccion o

LEFT JOIN LATERAL (
    SELECT fecha, iddisenadora, cumplimiento_diseno
    FROM manumoda.diseno_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
    ORDER BY id DESC
    LIMIT 1
) dp ON true

LEFT JOIN LATERAL (
    SELECT fecha, idcortador, cumplimiento_corte
    FROM manumoda.corte_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
    ORDER BY id DESC
    LIMIT 1
) cp ON true

LEFT JOIN manumoda.disenadoras dis ON dp.iddisenadora = dis.id
LEFT JOIN manumoda.cortadores   cor ON cp.idcortador  = cor.id;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

SELECT riesgo_entrega, COUNT(*)
FROM manumoda.vw_seguimiento_integrado
GROUP BY riesgo_entrega
ORDER BY 1;

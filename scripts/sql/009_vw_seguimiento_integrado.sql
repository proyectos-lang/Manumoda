-- ============================================================
-- Vista: vw_seguimiento_integrado
--
-- Sigue un folio de punta a punta por las tres etapas:
--   1. Diseño   (diseno_programacion)
--   2. Corte    (corte_programacion)
--   3. Maquila  (ordenes_produccion.fecha_s1 … fecha_s7)
--
-- Diferencia con vw_resumen_operacion: esa vista excluye
-- 'Por Programar' y 'S7'. Ésta incluye TODAS las órdenes porque
-- el reporte de Seguimiento de Ordenes las necesita completas.
--
-- Los LEFT JOIN LATERAL … ORDER BY id DESC LIMIT 1 garantizan
-- una sola fila por folio aun cuando la orden fue reprogramada
-- (varios registros en diseno_programacion / corte_programacion).
--
-- PREREQUISITO: script 008 ejecutado.
-- ============================================================

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

    -- ── Riesgo de entrega (misma regla que vw_resumen_operacion) ────────────
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

    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes

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
-- Sin WHERE: el reporte necesita todas las órdenes.

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación: debe devolver 0 filas (una sola fila por folio)
-- ════════════════════════════════════════════════════════════════════════════

SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_seguimiento_integrado
GROUP BY folio
HAVING COUNT(*) > 1;

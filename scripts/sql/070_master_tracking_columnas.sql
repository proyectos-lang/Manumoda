-- ============================================================
-- Master Tracking: fecha apartada, días restantes y calificación
--
-- LO QUE FALTABA:
--   La pantalla ya pedía `fecha_apartada_entrega` y `calificacion`,
--   pero `vw_seguimiento_integrado` nunca los expuso: PostgREST
--   simplemente no los devolvía y las columnas salían vacías. No era un
--   error de la pantalla.
--
--   Solo 5 órdenes tienen fecha apartada capturada hoy, así que el
--   hueco era fácil de pasar por alto.
--
-- QUÉ SE AGREGA:
--   · fecha_apartada_entrega  — el día que el maquilero aparta
--   · calificacion_corte      — la del corte, que vive en
--     corte_programacion. `ordenes_produccion` NO tiene esa columna:
--     solo `calidad`, que es la de maquila y ya venía en la vista.
--
-- LOS DÍAS PARA LA CANCELACIÓN YA EXISTÍAN:
--   La vista trae `dias_restantes` desde el script 009, calculado con
--   CURRENT_DATE. Se usa esa y no se agrega otra columna: dos nombres
--   para la misma cuenta acabarían discrepando.
--
-- PREREQUISITO: script 024 ejecutado (esta vista es su definición).
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

    -- ── Riesgo de entrega ───────────────────────────────────────────────────
    manumoda.fn_riesgo_entrega(
        o.fecha_facturacion, o.fecha_cancelacion, o.fase_actual
    ) AS riesgo_entrega,

    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes,

    o.fecha_facturacion,

    -- ── Agregadas para Master Tracking (script 070) ──
    --
    -- El día que el maquilero aparta para entregar. Existe en la orden
    -- desde el script 053, pero esta vista nunca lo expuso: por eso la
    -- columna salía vacía en la pantalla.
    o.fecha_apartada_entrega,
    -- La calificación del corte. NO está en `ordenes_produccion` —ahí solo
    -- existe `calidad`, que es la de maquila— sino en corte_programacion,
    -- donde se captura al calificar la semana.
    --
    -- LATERAL con LIMIT 1 y no JOIN: un folio puede tener varios
    -- renglones de corte, y un JOIN directo duplicaría la fila del folio
    -- en toda la vista. Se toma la última calificada.
    cal.calificacion                AS calificacion_corte
FROM manumoda.ordenes_produccion o
LEFT JOIN LATERAL (
    SELECT cp.calificacion
    FROM manumoda.corte_programacion cp
    WHERE cp.folio = o.folio AND cp.idempresa = o.idempresa
      AND cp.calificacion IS NOT NULL
    ORDER BY cp.fecha DESC NULLS LAST, cp.id DESC
    LIMIT 1
) cal ON true

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

COMMENT ON VIEW manumoda.vw_seguimiento_integrado IS
  'Un folio de punta a punta por las tres etapas. Incluye la fecha apartada '
  'de entrega, los días que faltan para la cancelación y la calificación.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las columnas nuevas existen, y `dias_restantes` sigue ahí.
--    Esperado: 3 filas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'vw_seguimiento_integrado'
  AND column_name IN ('fecha_apartada_entrega','calificacion_corte','dias_restantes')
ORDER BY column_name;

-- 2. Las 5 órdenes que tienen fecha apartada ahora la muestran.
SELECT folio, fecha_apartada_entrega, fecha_cancelacion, dias_restantes
FROM manumoda.vw_seguimiento_integrado
WHERE idempresa = 1 AND fecha_apartada_entrega IS NOT NULL
ORDER BY fecha_apartada_entrega;

-- 3. Los días restantes cuadran con la resta. 0 filas.
SELECT folio, fecha_cancelacion, dias_restantes
FROM manumoda.vw_seguimiento_integrado
WHERE idempresa = 1
  AND fecha_cancelacion IS NOT NULL
  AND dias_restantes <> (fecha_cancelacion - CURRENT_DATE)::integer;

-- 4. Cuántos folios están vencidos, por vencer y con holgura.
SELECT
  COUNT(*) FILTER (WHERE dias_restantes < 0)               AS vencidos,
  COUNT(*) FILTER (WHERE dias_restantes BETWEEN 0 AND 7)   AS esta_semana,
  COUNT(*) FILTER (WHERE dias_restantes > 7)               AS con_holgura,
  COUNT(*) FILTER (WHERE dias_restantes IS NULL)           AS sin_fecha
FROM manumoda.vw_seguimiento_integrado
WHERE idempresa = 1 AND fecha_facturacion IS NULL;

-- 5. La vista sigue devolviendo todas las órdenes: 637.
SELECT COUNT(*) AS folios FROM manumoda.vw_seguimiento_integrado WHERE idempresa = 1;

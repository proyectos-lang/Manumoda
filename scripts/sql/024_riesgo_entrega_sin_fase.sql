-- ============================================================
-- Semáforo de entrega: ritmo para órdenes fuera de maquila
--
-- Problema: el CASE de riesgo_entrega usaba `ELSE 0` para las
-- órdenes sin fase de maquila (Por Programar / Programada / NULL),
-- es decir, no les exigía ningún ritmo: una orden sin programar con
-- entrega en 30 días salía "A Tiempo". Panel General, que calcula el
-- riesgo en el cliente, ahora sí les aplica el ciclo completo, así
-- que el mismo folio salía "A Destiempo" ahí y "A Tiempo" en
-- Seguimiento.
--
-- Cambios:
--   1. `ELSE 0` → `ELSE 75` (54 días de S1 a la entrega + 21 del
--      plazo de diseño previo a S1).
--   2. "En Riesgo" (≤7 días) se evalúa ANTES que "A Destiempo".
--      Con el orden anterior y un ritmo mínimo de 14 días, "En Riesgo"
--      quedaba inalcanzable: toda entrega a ≤7 días caía primero en
--      "A Destiempo" y el estado moría.
--
-- La regla queda centralizada en fn_riesgo_entrega() para que ambas
-- vistas no puedan volver a divergir. Espeja `computeRisk` de
-- lib/risk.ts — si cambia aquí, cambiar allá y viceversa.
--
-- PREREQUISITO: scripts 016 y 018 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La regla, en un solo lugar
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_riesgo_entrega(
    p_fecha_facturacion date,
    p_fecha_cancelacion date,
    p_fase_actual       text
)
RETURNS text
LANGUAGE sql
-- STABLE, no IMMUTABLE: depende de CURRENT_DATE
STABLE
AS $$
    SELECT CASE
        -- Facturada = entregada: gana sobre cualquier otro estado
        WHEN p_fecha_facturacion IS NOT NULL THEN 'Entregado'::text
        WHEN p_fecha_cancelacion IS NULL THEN 'Sin Fecha'::text
        WHEN p_fecha_cancelacion < CURRENT_DATE THEN 'Vencido'::text
        -- Entrega inminente: antes del ritmo, porque todo ritmo es >= 14
        WHEN (p_fecha_cancelacion - CURRENT_DATE) <= 7 THEN 'En Riesgo'::text
        WHEN (CURRENT_DATE +
            CASE p_fase_actual
                WHEN 'S1'::text THEN 54
                WHEN 'S2'::text THEN 46
                WHEN 'S3'::text THEN 40
                WHEN 'S4'::text THEN 32
                WHEN 'S5'::text THEN 25
                WHEN 'S6'::text THEN 20
                WHEN 'S7'::text THEN 14
                -- Fuera de maquila: necesita el ciclo completo (54 + 21)
                ELSE 75
            END) > p_fecha_cancelacion THEN 'A Destiempo'::text
        ELSE 'A Tiempo'::text
    END;
$$;

COMMENT ON FUNCTION manumoda.fn_riesgo_entrega(date, date, text) IS
  'Semáforo de entrega. Espeja computeRisk() de lib/risk.ts. '
  'Jerarquía: Entregado > Sin Fecha > Vencido > En Riesgo (<=7d) > '
  'A Destiempo (no alcanza el ritmo de su fase) > A Tiempo.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_resumen_operacion — misma definición del script 018,
--    con el CASE reemplazado por la función
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
    manumoda.fn_riesgo_entrega(
        o.fecha_facturacion, o.fecha_cancelacion, o.fase_actual
    ) AS riesgo_entrega,
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
-- 3. vw_seguimiento_integrado — misma definición del script 016,
--    con el CASE reemplazado por la función
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
    manumoda.fn_riesgo_entrega(
        o.fecha_facturacion, o.fecha_cancelacion, o.fase_actual
    ) AS riesgo_entrega,

    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes,

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

-- Distribución del semáforo. "En Riesgo" debe dejar de ser 0 y las órdenes
-- por programar con entrega a menos de 75 días deben aparecer "A Destiempo".
SELECT riesgo_entrega, COUNT(*)
FROM manumoda.vw_seguimiento_integrado
GROUP BY riesgo_entrega
ORDER BY 1;

-- Corte transversal de las órdenes fuera de maquila
SELECT fase_actual, riesgo_entrega, COUNT(*)
FROM manumoda.vw_seguimiento_integrado
WHERE fase_actual IS NULL OR fase_actual NOT IN ('S1','S2','S3','S4','S5','S6','S7')
GROUP BY 1, 2
ORDER BY 1, 2;

-- ============================================================
-- Semáforo de entrega: tres estados
--
-- La convención de la aplicación es A Tiempo / A Destiempo /
-- Vencido. "En Riesgo" era un cuarto estado que solo existía en
-- el semáforo y aparecía en el Master Tracking de Resumen de
-- Operación, sin equivalente en el resto de los módulos.
--
-- Se elimina la rama "En Riesgo" (entrega en <=7 días). Esas
-- órdenes pasan a "A Destiempo", que es lo que ya eran por la
-- regla de ritmo: todo ritmo es >= 14 días, así que una entrega
-- a 7 días o menos nunca alcanza el ritmo de su fase.
--
-- `Entregado` y `Sin Fecha` no son grados de riesgo sino casos en
-- que la orden sale de la evaluación, y se conservan.
--
-- Espeja `computeRisk` de lib/risk.ts — si cambia aquí, cambiar
-- allá y viceversa.
--
-- PREREQUISITO: script 024 ejecutado.
-- ============================================================

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
  'Estados: A Tiempo, A Destiempo (no alcanza el ritmo de su fase) y '
  'Vencido; más Entregado y Sin Fecha, que sacan a la orden de la '
  'evaluación.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- "En Riesgo" debe desaparecer de ambas vistas.
SELECT 'vw_seguimiento_integrado' AS vista, riesgo_entrega, COUNT(*)
FROM manumoda.vw_seguimiento_integrado
GROUP BY 1, 2
UNION ALL
SELECT 'vw_resumen_operacion', riesgo_entrega, COUNT(*)
FROM manumoda.vw_resumen_operacion
GROUP BY 1, 2
ORDER BY 1, 2;

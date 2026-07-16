-- ============================================================
-- DIAGNÓSTICO: Corte no tiene columna horas_cumplimiento_corte
--
-- La tabla corte_programacion NO almacena horas_cumplimiento_corte
-- ni horas_plan_final. Ambas son columnas calculadas en la vista
-- vw_plan_corte_detalle:
--
--   horas_plan_final         = horas_plan_corte + ajustes / variables
--   horas_cumplimiento_corte = horas_plan_final  (cuando cumplimiento = 'Si')
--
-- Resultado: los bonos de corte SIEMPRE usan valores actuales —
-- no hay datos stale que corregir a nivel de tabla.
--
-- La única columna almacenada que podría estar desactualizada es
-- horas_plan_corte, si un trigger la setea con una fórmula vieja.
-- Para verificarlo, compara la vista con la tabla:
-- ============================================================

SELECT
  cp.id,
  cp.folio,
  cp.horas_plan_corte                    AS horas_plan_corte_tabla,
  v.horas_plan_corte                     AS horas_plan_corte_vista,
  v.horas_plan_final,
  cp.cumplimiento_corte,
  v.horas_cumplimiento_corte
FROM manumoda.corte_programacion cp
JOIN manumoda.vw_plan_corte_detalle v ON v.registro_id = cp.id
WHERE cp.cumplimiento_corte = 'Si'
  -- Descomentar para ver solo discrepancias:
  -- AND cp.horas_plan_corte IS DISTINCT FROM v.horas_plan_corte
ORDER BY cp.id DESC
LIMIT 50;

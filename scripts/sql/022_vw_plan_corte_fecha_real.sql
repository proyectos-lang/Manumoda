-- ============================================================
-- vw_plan_corte_detalle: usar la fecha REAL del corte
--
-- PROBLEMA:
--   La vista exponía `cp.created_at::date AS fecha`, es decir la fecha
--   en que se capturó el registro, no en la que se cortó la tela. Como
--   los cortes se registran días o semanas después de arrancar maquila,
--   el indicador de puntualidad marcaba casi todo "a destiempo".
--
-- FIX:
--   Exponer `cp.fecha` (la columna real de la tabla), que ahora el
--   diálogo de corte captura explícitamente. `vw_seguimiento_integrado`
--   ya usaba `cp.fecha`, así que con esto las dos vistas coinciden.
--
--   Para los registros viejos `cp.fecha` sigue siendo su fecha de
--   captura (era el default); se corrigen editando el corte y
--   ajustando la fecha en el diálogo.
--
-- Único cambio respecto a la versión del script 019: la expresión de
-- `fecha`. Todo lo demás queda idéntico.
-- ============================================================

CREATE OR REPLACE VIEW manumoda.vw_plan_corte_detalle AS
SELECT
  cp.id AS registro_id,
  -- FIX: fecha real del corte (antes: cp.created_at::date)
  cp.fecha,
  cp.semana,
  op.num_pedido AS no_origen,
  cp.folio,
  op.piezas AS piezas_orden,
  op.familia,
  op.categoria,
  cp.tipo_tela,
  cp.metros_utilizar,
  ct.complejidad_texto AS complejidad_de_tela,
  cp.combinacion,
  cp.no_piezas,
  cp.idcortador,
  c1.nombre AS cortador_nombre,
  cp.idapoyo,
  c2.nombre AS apoyo_nombre,
  cp.mesa,
  cp.trazos,
  cp.variable_subjetiva,
  cp.cumplimiento_corte,
  cp.horas_plan_corte::numeric AS horas_plan_corte,
  COALESCE(cp.horas_plan_corte, 0::numeric) + COALESCE(cp.variable_subjetiva, 0::numeric) AS horas_plan_final,
  -- Todo registro de corte cuenta sus horas (script 019)
  COALESCE(cp.horas_plan_corte, 0::numeric) + COALESCE(cp.variable_subjetiva, 0::numeric) AS horas_cumplimiento_corte,
  cp.idfamilia_corte,
  cp.categoria_corte,
  cp.categoria_tela,
  cp.tendidos,
  cp.comp_entretela,
  cp.comp_poquetin,
  cp.comp_forro,
  cp.calificacion,
  cp.comentarios,
  cp.piezas_cortadas,
  op.fecha_cancelacion,
  cp.idempresa
FROM
  manumoda.corte_programacion cp
  LEFT JOIN manumoda.ordenes_produccion op
    ON op.folio = cp.folio AND op.idempresa = cp.idempresa
  LEFT JOIN manumoda.cortadores c1 ON c1.id = cp.idcortador
  LEFT JOIN manumoda.cortadores c2 ON c2.id = cp.idapoyo
  LEFT JOIN manumoda.cat_telas   ct ON ct.tipo_de_tela = cp.tipo_tela;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- Cortes cumplidos vs el arranque de maquila. Un corte con fecha real
-- anterior o igual a fecha_s1 cuenta como "a tiempo":
SELECT
  s.folio,
  s.fecha_corte,
  s.fecha_s1,
  (s.fecha_corte - s.fecha_s1) AS dias_vs_s1
FROM manumoda.vw_seguimiento_integrado s
WHERE s.idempresa = 1
  AND s.cumplimiento_corte = 'Si'
  AND s.fecha_facturacion IS NULL
ORDER BY dias_vs_s1;

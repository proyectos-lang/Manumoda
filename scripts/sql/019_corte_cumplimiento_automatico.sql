-- ============================================================
-- Corte: cumplimiento automático de horas
--
-- PROBLEMA:
--   horas_cumplimiento_corte solo tenía valor cuando
--   cumplimiento_corte = 'Si'. Como en corte la mayoría de los
--   registros quedan en 'Pendiente', sus horas cumplidas daban
--   NULL y el bono de corte mostraba 0 h cumplidas.
--
-- REGLA CORRECTA (a diferencia de diseño):
--   En corte solo se registra lo que YA se cortó, así que cada
--   registro debe contar sus horas automáticamente, sin depender
--   del flag 'Si/Pendiente'.
--
-- FIX:
--   horas_cumplimiento_corte = horas_plan_final para TODOS los
--   registros. vw_bonos_corte suma esta columna, así que el bono
--   se corrige solo (no hace falta tocar esa vista).
--
-- Único cambio respecto a la definición vigente: la expresión de
-- horas_cumplimiento_corte. Todo lo demás queda idéntico.
-- ============================================================

CREATE OR REPLACE VIEW manumoda.vw_plan_corte_detalle AS
SELECT
  cp.id AS registro_id,
  cp.created_at::date AS fecha,
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
  -- FIX: todo registro de corte cuenta sus horas (antes solo los 'Si').
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

-- Antes: los 'Pendiente' daban NULL. Ahora todos tienen horas.
SELECT folio, cumplimiento_corte, horas_plan_final, horas_cumplimiento_corte
FROM manumoda.vw_plan_corte_detalle
WHERE idempresa = 1
ORDER BY semana DESC, folio
LIMIT 15;

-- Horas cumplidas por cortador/semana en el bono (ya no deberían ser 0):
SELECT nombre, semana, horas_cumplidas
FROM manumoda.vw_bonos_corte
ORDER BY anio DESC, semana DESC, nombre;

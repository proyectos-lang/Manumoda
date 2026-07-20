-- ============================================================
-- vw_plan_corte_detalle: exponer fecha_cancelacion
--
-- El módulo de Corte necesita la fecha de entrega para las
-- alertas de vencimiento.
--
-- La vista ya hace LEFT JOIN con ordenes_produccion (alias `op`),
-- así que se toma op.fecha_cancelacion directamente — siempre
-- fresca, sin depender de la copia denormalizada del script 008.
--
-- Único cambio respecto a la definición previa: la última columna
-- del SELECT. Todo lo demás queda idéntico.
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
  CASE
    WHEN cp.cumplimiento_corte = 'Si'::text
      THEN COALESCE(cp.horas_plan_corte, 0::numeric) + COALESCE(cp.variable_subjetiva, 0::numeric)
    ELSE NULL::numeric
  END AS horas_cumplimiento_corte,
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
  -- ── NUEVA: fecha de entrega del pedido ──────────────────────────────────
  op.fecha_cancelacion
FROM
  manumoda.corte_programacion cp
  LEFT JOIN manumoda.ordenes_produccion op
    ON op.folio = cp.folio AND op.idempresa = cp.idempresa
  LEFT JOIN manumoda.cortadores c1 ON c1.id = cp.idcortador
  LEFT JOIN manumoda.cortadores c2 ON c2.id = cp.idapoyo
  LEFT JOIN manumoda.cat_telas   ct ON ct.tipo_de_tela = cp.tipo_tela
WHERE
  cp.idempresa = 1;
-- Nota: el filtro `idempresa = 1` viene de la definición original.
-- Se conserva tal cual para no alterar el comportamiento actual.

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

SELECT folio, semana, cumplimiento_corte, fecha_cancelacion
FROM manumoda.vw_plan_corte_detalle
WHERE fecha_cancelacion IS NOT NULL
ORDER BY fecha_cancelacion
LIMIT 10;

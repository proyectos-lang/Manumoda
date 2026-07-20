-- ============================================================
-- vw_plan_corte_detalle: quitar el idempresa hardcodeado
--
-- La versión anterior (script 010) filtraba WHERE cp.idempresa = 1
-- dentro de la vista. Consecuencia: los consumidores no filtran por
-- empresa, y si algún día existe una segunda empresa, sus datos de
-- corte serían invisibles (o mezclados si se quitara el WHERE sin
-- avisar al frontend).
--
-- Cambio:
--   1. Exponer cp.idempresa como columna (al FINAL, para poder usar
--      CREATE OR REPLACE sin DROP — un DROP arrastraría cualquier
--      vista dependiente como vw_bonos_corte).
--   2. Eliminar el WHERE hardcodeado.
--   3. El frontend filtra .eq("idempresa", IDEMPRESA) — mismo patrón
--      que el resto de las vistas.
--
-- ⚠️ Ejecutar junto con el deploy del frontend que agrega el filtro.
--    Con una sola empresa el resultado es idéntico al anterior.
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
  -- Fecha de entrega, fresca desde la orden (no la copia denormalizada)
  op.fecha_cancelacion,
  -- NUEVA (al final para no romper columnas existentes)
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

SELECT idempresa, COUNT(*) AS registros
FROM manumoda.vw_plan_corte_detalle
GROUP BY idempresa;

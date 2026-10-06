-- ============================================================
-- Costo neto editable en la ficha técnica
--
-- QUÉ CAMBIA:
--   El costo neto se calculaba siempre: costo fijo + telas +
--   habilitaciones + maquila + lavandería. Ahora se puede escribir uno
--   a mano que REEMPLAZA al cálculo (operación, 06-oct-2026). El
--   margen y el costo total por pieza se calculan con el que mande.
--
-- POR QUÉ UNA COLUMNA APARTE Y NO PISAR EL CÁLCULO:
--   Con `costo_neto_manual` el calculado se sigue viendo al lado, y
--   borrar el manual vuelve al cálculo sin perder nada. Si el valor
--   tecleado se guardara encima, no habría forma de saber cuánto daba
--   la fórmula ni de volver a ella.
--
-- LA VISTA:
--   `costo_neto` pasa a ser el EFECTIVO —el manual si existe, si no el
--   calculado— para que todo lo que ya lo lee (ficha, PDF, margen)
--   tome el bueno sin cambios. Al final se agregan
--   `costo_neto_calculado` y `costo_neto_manual`. Solo se agregan
--   columnas al final y se cambian expresiones, así que CREATE OR
--   REPLACE basta. La vista se repite entera desde el script 072.
--
-- PREREQUISITO: script 072 ejecutado.
-- ============================================================

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS costo_neto_manual numeric(12, 2);

COMMENT ON COLUMN manumoda.ordenes_produccion.costo_neto_manual IS
  'Costo neto escrito a mano en la ficha. Si tiene valor, reemplaza al '
  'calculado (fijo + materiales + maquila + lavandería). NULL = manda '
  'el cálculo.';

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_costo_neto_manual;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_costo_neto_manual
  CHECK (costo_neto_manual IS NULL OR costo_neto_manual >= 0);

CREATE OR REPLACE VIEW manumoda.vw_ficha_tecnica AS
SELECT
    o.idempresa,
    o.folio,
    o.razon_social,
    o.marca,
    o.compradora,
    o.cliente,
    o.num_pedido,
    o.modelo,
    o.modelo_cliente,
    o.descripcion_completa,
    o.categoria,
    o.familia,
    o.foto_path,
    o.fecha_confirmacion,
    o.fecha_cancelacion,
    o.piezas                          AS piezas_orden,
    o.piezas_ficha,
    COALESCE(te.piezas, 0)            AS piezas_totales,
    COALESCE(tc.piezas, 0)            AS piezas_cortadas_ficha,
    o.piezas_cortadas,
    COALESCE(mt.importe, 0)           AS costo_tela,
    COALESCE(mh.importe, 0)           AS costo_habilitacion,
    o.costo_fijo,

    -- Quién produce la orden
    o.idmaquilero,
    o.maquilero,
    mq.nombre                         AS maquilero_catalogo,

    -- Quién hace cada proceso
    o.idmaquilero_lavanderia,
    o.idmaquilero_estampado,
    o.idmaquilero_bordado,
    o.idmaquilero_corte_externo,
    o.idmaquilero_otro,

    -- Costos del proceso, todos POR PIEZA
    o.costo_maquila,
    o.costo_lavanderia,
    o.costo_estampado,
    o.costo_bordado,
    o.costo_corte_externo,
    o.costo_otro,
    ROUND(
      COALESCE(o.costo_estampado, 0)
      + COALESCE(o.costo_bordado, 0)
      + COALESCE(o.costo_corte_externo, 0)
      + COALESCE(o.costo_otro, 0)
    , 2)                              AS costo_servicios,

    -- Costo Neto: fijo + materiales + maquila + lavandería.
    -- Los servicios externos quedan fuera a propósito.
    COALESCE(
      o.costo_neto_manual,
      ROUND(
        COALESCE(o.costo_fijo, 0)
        + COALESCE(mt.importe, 0)
        + COALESCE(mh.importe, 0)
        + COALESCE(o.costo_maquila, 0)
        + COALESCE(o.costo_lavanderia, 0)
      , 2)
    )                                 AS costo_neto,

    -- Costo total: el neto más los servicios externos.
    ROUND(
      COALESCE(o.costo_neto_manual, ROUND(
        COALESCE(o.costo_fijo, 0)
        + COALESCE(mt.importe, 0)
        + COALESCE(mh.importe, 0)
        + COALESCE(o.costo_maquila, 0)
        + COALESCE(o.costo_lavanderia, 0)
      , 2))
      + COALESCE(o.costo_estampado, 0)
      + COALESCE(o.costo_bordado, 0)
      + COALESCE(o.costo_corte_externo, 0)
      + COALESCE(o.costo_otro, 0)
    , 2)                              AS costo_total_pieza,

    o.precio_venta,
    o.precio_publico,
    -- Margen sobre el precio de venta, con el neto nuevo.
    CASE WHEN COALESCE(o.precio_venta, 0) > 0 THEN
      ROUND(100.0 * (o.precio_venta - COALESCE(
        o.costo_neto_manual,
        COALESCE(o.costo_fijo, 0)
        + COALESCE(mt.importe, 0)
        + COALESCE(mh.importe, 0)
        + COALESCE(o.costo_maquila, 0)
        + COALESCE(o.costo_lavanderia, 0)
      )) / o.precio_venta, 2)
    END                               AS margen_pct,

    -- ── La columna nueva, obligatoriamente al final ──
    o.codigo_ean,

    -- ── Agregadas en el 085, al final ──
    -- El neto que da la formula, aunque haya uno manual: la pantalla
    -- muestra los dos para que se vea cuanto difieren.
    ROUND(
          COALESCE(o.costo_fijo, 0)
          + COALESCE(mt.importe, 0)
          + COALESCE(mh.importe, 0)
          + COALESCE(o.costo_maquila, 0)
          + COALESCE(o.costo_lavanderia, 0)
        , 2) AS costo_neto_calculado,
    o.costo_neto_manual
FROM manumoda.ordenes_produccion o
LEFT JOIN manumoda.maquileros mq
  ON mq.id = o.idmaquilero
-- LATERAL y no JOIN: con varios JOIN directos a las tablas hijas, cada
-- una multiplicaría las filas de las otras y los importes se inflarían.
LEFT JOIN LATERAL (
    SELECT SUM(v.valor) AS piezas
    FROM manumoda.ficha_tallas ft
    CROSS JOIN LATERAL (
      SELECT SUM((value)::numeric) AS valor
      FROM jsonb_each_text(ft.cantidades)
    ) v
    WHERE ft.folio = o.folio AND ft.idempresa = o.idempresa
      AND ft.bloque = 'Especificacion'
) te ON true
LEFT JOIN LATERAL (
    SELECT SUM(v.valor) AS piezas
    FROM manumoda.ficha_tallas ft
    CROSS JOIN LATERAL (
      SELECT SUM((value)::numeric) AS valor
      FROM jsonb_each_text(ft.cantidades)
    ) v
    WHERE ft.folio = o.folio AND ft.idempresa = o.idempresa
      AND ft.bloque = 'Cortadas'
) tc ON true
LEFT JOIN LATERAL (
    SELECT ROUND(SUM(cantidad * costo), 2) AS importe
    FROM manumoda.ficha_materiales
    WHERE folio = o.folio AND idempresa = o.idempresa AND tipo = 'Tela'
) mt ON true
LEFT JOIN LATERAL (
    SELECT ROUND(SUM(cantidad * costo), 2) AS importe
    FROM manumoda.ficha_materiales
    WHERE folio = o.folio AND idempresa = o.idempresa AND tipo = 'Habilitacion'
) mh ON true;

COMMENT ON VIEW manumoda.vw_ficha_tecnica IS
  'La ficha técnica completa. costo_neto es el efectivo: el manual si se '
  'capturó, si no fijo + materiales + maquila + lavandería '
  '(costo_neto_calculado). costo_total_pieza suma además los servicios.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las columnas nuevas existen en la vista. Esperado: 2 filas.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'vw_ficha_tecnica'
  AND column_name IN ('costo_neto_calculado', 'costo_neto_manual');

-- 2. Sin manual, el neto es el calculado. Esperado: 0 filas.
SELECT folio, costo_neto, costo_neto_calculado
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1 AND costo_neto_manual IS NULL
  AND costo_neto <> costo_neto_calculado;

-- 3. Prueba: un manual manda y luego se quita.
-- UPDATE manumoda.ordenes_produccion SET costo_neto_manual = 80
-- WHERE idempresa = 1 AND folio = '2008';
-- SELECT costo_neto, costo_neto_calculado, costo_neto_manual, margen_pct
-- FROM manumoda.vw_ficha_tecnica WHERE folio = '2008';
-- UPDATE manumoda.ordenes_produccion SET costo_neto_manual = NULL
-- WHERE idempresa = 1 AND folio = '2008';

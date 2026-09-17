-- ============================================================
-- La ficha expone el maquilero y sus costos
--
-- QUÉ AGREGA:
--   `vw_ficha_tecnica` ya traía `costo_maquila` y `costo_lavanderia`,
--   pero no quién produce la orden. La ficha necesita ese dato para
--   poder asignarlo cuando la orden todavía no lo trae.
--
-- ES EL MISMO DATO QUE USA PAGO MAQUILAS, NO UNA COPIA:
--   Se leen `ordenes_produccion.idmaquilero` y `.maquilero`, las mismas
--   columnas de las que ese módulo calcula lo que se le debe a cada
--   quien. Asignar el maquilero desde la ficha lo asigna de verdad.
--
--   Un campo propio de la ficha —un "maquilero previsto" aparte— habría
--   creado dos verdades sobre lo mismo, y tarde o temprano dirían cosas
--   distintas mientras alguien cobra.
--
-- POR QUÉ SE EXPONEN LAS DOS COLUMNAS:
--   `idmaquilero` apunta al catálogo; `maquilero` es el texto que vino
--   del Excel. Hoy 219 órdenes traen texto y solo 167 tienen el vínculo:
--   los 52 restantes escribieron un nombre que no está en el catálogo
--   —RAYMUNDO PINEDA es el caso conocido— y perderían ese dato si la
--   ficha solo mirara el id.
--
--   El nombre del catálogo se resuelve aquí para no repetir el JOIN en
--   cada consulta de la app.
--
-- PREREQUISITO: script 066 ejecutado.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_ficha_tecnica;

CREATE VIEW manumoda.vw_ficha_tecnica AS
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

    -- ── Quién produce la orden ──
    o.idmaquilero,
    o.maquilero,
    -- El nombre del catálogo, para no repetir el JOIN en cada consulta.
    mq.nombre                         AS maquilero_catalogo,

    -- Costos del proceso. Se exponen y se editan desde la ficha, pero NO
    -- entran al Costo Neto: la ficha impresa no los incluye.
    o.costo_maquila,
    o.costo_lavanderia,

    -- Costo Neto = costo fijo + materiales. Derivado, no guardado.
    ROUND(
      COALESCE(o.costo_fijo, 0)
      + COALESCE(mt.importe, 0)
      + COALESCE(mh.importe, 0)
    , 2)                              AS costo_neto,
    o.precio_venta,
    o.precio_publico,
    CASE WHEN COALESCE(o.precio_venta, 0) > 0 THEN
      ROUND(100.0 * (o.precio_venta - (
        COALESCE(o.costo_fijo, 0)
        + COALESCE(mt.importe, 0)
        + COALESCE(mh.importe, 0)
      )) / o.precio_venta, 2)
    END                               AS margen_pct
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
  'La ficha técnica completa. Costo Neto (= costo fijo + materiales) y Margen '
  'se derivan aquí. El maquilero y sus costos son los MISMOS que usa Pago '
  'Maquilas, no una copia.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La vista expone los campos nuevos. Esperado: 3 filas.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'vw_ficha_tecnica'
  AND column_name IN ('idmaquilero', 'maquilero', 'maquilero_catalogo')
ORDER BY column_name;

-- 2. Las cifras conocidas: 219 órdenes con texto, 167 con vínculo.
SELECT
  COUNT(*)                                            AS fichas,
  COUNT(*) FILTER (WHERE maquilero IS NOT NULL)       AS con_texto,
  COUNT(*) FILTER (WHERE idmaquilero IS NOT NULL)     AS con_vinculo,
  COUNT(*) FILTER (WHERE costo_maquila IS NOT NULL)   AS con_costo_maquila,
  COUNT(*) FILTER (WHERE costo_lavanderia IS NOT NULL) AS con_costo_lavanderia
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1;

-- 3. Los nombres que quedaron sin vínculo al catálogo. Es el dato que se
--    perdería si la ficha solo mirara el id.
SELECT maquilero, COUNT(*) AS ordenes
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND maquilero IS NOT NULL
  AND idmaquilero IS NULL
GROUP BY maquilero
ORDER BY 2 DESC;

-- 4. El Costo Neto no cambió: sigue sin incluir maquila ni lavandería.
--    0 filas.
SELECT folio, costo_fijo, costo_maquila, costo_neto
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND ROUND(COALESCE(costo_fijo,0) + costo_tela + costo_habilitacion, 2)
      <> costo_neto;

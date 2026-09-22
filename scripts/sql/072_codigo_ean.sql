-- ============================================================
-- Código EAN de la orden, capturado a mano
--
-- QUÉ ES:
--   El código de barras con el que el cliente identifica la prenda en su
--   punto de venta. No lo genera Manumoda: lo entrega el cliente junto
--   con el pedido, igual que el "Modelo Cliente". Por eso se teclea.
--
-- POR QUÉ EN LA ORDEN Y NO EN EL ARTÍCULO:
--   `articulos` guarda telas y habilitaciones —lo que se compra—, no la
--   prenda que se produce. El EAN identifica la prenda terminada, que
--   aquí vive como folio.
--
-- POR QUÉ UNO POR FOLIO Y NO UNO POR COLOR Y TALLA:
--   En el comercio un EAN suele ser por SKU, es decir por color y talla.
--   Se guarda uno por folio porque es lo que se pidió y porque hoy no
--   hay de dónde sacar los otros: quien los tenga tendría que teclear
--   una matriz entera. Si más adelante hacen falta, la matriz de
--   `ficha_tallas` ya existe y puede llevar su propia columna sin tocar
--   esta: un folio con EAN general y EAN por talla no se contradicen.
--
-- POR QUÉ text Y NO UN NÚMERO:
--   Un EAN-13 empieza a veces por cero —7501234567890 y 0750123456789
--   son códigos distintos— y como número el cero inicial se pierde.
--   Además admite 8, 13 o 14 dígitos según el tipo.
--
-- NO SE VALIDA EL DÍGITO VERIFICADOR:
--   El EAN real trae uno, pero si la base lo rechazara un código mal
--   tecleado bloquearía guardar toda la ficha. Se avisa en pantalla y
--   se deja pasar: es preferible un dato dudoso a una ficha sin guardar.
--   Lo único que se exige es que sean dígitos, para atajar el copiado
--   accidental de texto.
--
-- PREREQUISITO: ninguno.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La columna
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS codigo_ean text;

COMMENT ON COLUMN manumoda.ordenes_produccion.codigo_ean IS
  'Código de barras de la prenda, capturado a mano. Lo entrega el '
  'cliente; Manumoda no lo genera. Es text para no perder el cero '
  'inicial.';

-- Solo dígitos, entre 8 y 14. No se comprueba el dígito verificador:
-- un código mal tecleado no debe impedir guardar la ficha entera.
-- NULL y cadena vacía pasan: la mayoría de los folios no lo llevan.
ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS ordenes_produccion_codigo_ean_formato;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT ordenes_produccion_codigo_ean_formato
  CHECK (codigo_ean IS NULL OR codigo_ean = '' OR codigo_ean ~ '^[0-9]{8,14}$');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Exponerla en la ficha técnica
--
--    La vista se repite ENTERA, igual que en el script 069, con la
--    columna nueva AL FINAL. Postgres no deja insertar una columna en
--    medio de la lista con CREATE OR REPLACE —solo agregarla al final—
--    así que ahí va, aunque en pantalla se muestre junto a Modelo
--    Cliente: el orden de la vista y el de la pantalla son
--    independientes.
--
--    Se repite entera en vez de reescribirla con pg_get_viewdef porque
--    parchear el texto de una vista con expresiones regulares rompe en
--    silencio cuando la vista cambia de forma. Aquí se ve qué queda.
-- ════════════════════════════════════════════════════════════════════════════

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
    ROUND(
      COALESCE(o.costo_fijo, 0)
      + COALESCE(mt.importe, 0)
      + COALESCE(mh.importe, 0)
      + COALESCE(o.costo_maquila, 0)
      + COALESCE(o.costo_lavanderia, 0)
    , 2)                              AS costo_neto,

    -- Costo total: el neto más los servicios externos.
    ROUND(
      COALESCE(o.costo_fijo, 0)
      + COALESCE(mt.importe, 0)
      + COALESCE(mh.importe, 0)
      + COALESCE(o.costo_maquila, 0)
      + COALESCE(o.costo_lavanderia, 0)
      + COALESCE(o.costo_estampado, 0)
      + COALESCE(o.costo_bordado, 0)
      + COALESCE(o.costo_corte_externo, 0)
      + COALESCE(o.costo_otro, 0)
    , 2)                              AS costo_total_pieza,

    o.precio_venta,
    o.precio_publico,
    -- Margen sobre el precio de venta, con el neto nuevo.
    CASE WHEN COALESCE(o.precio_venta, 0) > 0 THEN
      ROUND(100.0 * (o.precio_venta - (
        COALESCE(o.costo_fijo, 0)
        + COALESCE(mt.importe, 0)
        + COALESCE(mh.importe, 0)
        + COALESCE(o.costo_maquila, 0)
        + COALESCE(o.costo_lavanderia, 0)
      )) / o.precio_venta, 2)
    END                               AS margen_pct,

    -- ── La columna nueva, obligatoriamente al final ──
    o.codigo_ean
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
  'La ficha técnica completa. Costo Neto = costo fijo + materiales + maquila + '
  'lavandería; costo_total_pieza suma además los servicios externos. Ninguno '
  'se guarda: se derivan aquí para que no discrepen de sus partes.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La columna existe y es text. Esperado: una fila, 'text'.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'ordenes_produccion'
  AND column_name = 'codigo_ean';

-- 2. La vista la expone. Esperado: una fila.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'vw_ficha_tecnica'
  AND column_name = 'codigo_ean';

-- 3. La restricción acepta lo válido y rechaza lo que no.
--    El primero debe pasar; el segundo debe fallar con 23514.
-- UPDATE manumoda.ordenes_produccion SET codigo_ean = '7501234567890'
-- WHERE idempresa = 1 AND folio = '2058';
-- UPDATE manumoda.ordenes_produccion SET codigo_ean = 'ABC'
-- WHERE idempresa = 1 AND folio = '2058';
-- UPDATE manumoda.ordenes_produccion SET codigo_ean = NULL
-- WHERE idempresa = 1 AND folio = '2058';

-- 4. Cuántos folios lo traen. Esperado al principio: 0.
SELECT COUNT(*) FILTER (WHERE codigo_ean IS NOT NULL AND codigo_ean <> '')
         AS con_ean,
       COUNT(*) AS total
FROM manumoda.ordenes_produccion
WHERE idempresa = 1;

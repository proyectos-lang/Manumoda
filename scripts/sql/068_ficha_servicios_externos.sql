-- ============================================================
-- La ficha expone los servicios externos
--
-- QUÉ AGREGA:
--   `vw_ficha_tecnica` no traía estampado, bordado, corte externo ni
--   "otros", aunque las columnas existen desde el script 032 y Pago
--   Maquilas ya las usa para calcular lo que se le paga a cada quien.
--
--   No se crean columnas: se exponen las que ya están. Capturarlos desde
--   la ficha los escribe en `ordenes_produccion`, donde Pago Maquilas los
--   lee. Es el mismo dato, no una copia — igual que el maquilero.
--
-- HOY ESTÁN LOS CUATRO VACÍOS en las 637 órdenes: el Excel nunca los
--   trajo. La ficha es el primer lugar donde se van a capturar.
--
-- POR QUÉ NO ENTRAN AL COSTO NETO:
--   Por la misma razón que maquila y lavandería: la ficha impresa no los
--   incluye. Son costos del proceso, no del material. Se suman al costo
--   TOTAL por pieza, que es otra cuenta y se muestra aparte.
--
-- QUIÉN HACE CADA PROCESO:
--   Cada costo lleva además su propio responsable, del catálogo de
--   maquileros. Por ahora es informativo —se captura y se guarda— pero
--   está pensado para lo que viene: pagar a cada quien por el proceso
--   que hizo, en vez de un solo pago por folio.
--
--   Se guarda el id y no el nombre: cuando esos pagos se calculen, un
--   texto libre partiría a un mismo proveedor en dos por una diferencia
--   de escritura, y el dinero saldría mal. Es la lección del huérfano
--   RAYMUNDO PINEDA.
--
-- PREREQUISITO: script 067 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Quién hace cada proceso
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  /**
   * El responsable de cada proceso, del catálogo de maquileros.
   *
   * Hoy solo se captura. Más adelante, la estructura de costos de un
   * folio se abrirá por proceso y cada uno cobrará lo suyo.
   */
  ADD COLUMN IF NOT EXISTS idmaquilero_lavanderia    integer
    REFERENCES manumoda.maquileros(id),
  ADD COLUMN IF NOT EXISTS idmaquilero_estampado     integer
    REFERENCES manumoda.maquileros(id),
  ADD COLUMN IF NOT EXISTS idmaquilero_bordado       integer
    REFERENCES manumoda.maquileros(id),
  ADD COLUMN IF NOT EXISTS idmaquilero_corte_externo integer
    REFERENCES manumoda.maquileros(id),
  ADD COLUMN IF NOT EXISTS idmaquilero_otro          integer
    REFERENCES manumoda.maquileros(id);

COMMENT ON COLUMN manumoda.ordenes_produccion.idmaquilero_lavanderia IS
  'Quién hace la lavandería. Informativo por ahora; será la base para '
  'pagarle a cada proceso por separado.';

-- La FK es deliberada: sin ella, borrar un maquilero dejaría folios
-- apuntando a un id que ya no existe, y esos pagos no tendrían dueño.

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

    -- Quién produce la orden
    o.idmaquilero,
    o.maquilero,
    mq.nombre                         AS maquilero_catalogo,

    -- Quién hace cada proceso. Informativo hoy; base del pago por
    -- proceso más adelante.
    o.idmaquilero_lavanderia,
    o.idmaquilero_estampado,
    o.idmaquilero_bordado,
    o.idmaquilero_corte_externo,
    o.idmaquilero_otro,

    -- ── Costos del proceso ──
    -- Todos POR PIEZA. Se capturan en la ficha y los lee Pago Maquilas:
    -- son las mismas columnas, no una copia.
    o.costo_maquila,
    o.costo_lavanderia,
    o.costo_estampado,
    o.costo_bordado,
    o.costo_corte_externo,
    o.costo_otro,
    -- La suma de los servicios externos, para no repetirla en la app.
    ROUND(
      COALESCE(o.costo_estampado, 0)
      + COALESCE(o.costo_bordado, 0)
      + COALESCE(o.costo_corte_externo, 0)
      + COALESCE(o.costo_otro, 0)
    , 2)                              AS costo_servicios,

    -- Costo Neto = costo fijo + materiales. NO incluye los del proceso:
    -- la ficha impresa no los trae.
    ROUND(
      COALESCE(o.costo_fijo, 0)
      + COALESCE(mt.importe, 0)
      + COALESCE(mh.importe, 0)
    , 2)                              AS costo_neto,

    -- Lo que cuesta producir una pieza de verdad: el neto más todo el
    -- proceso. Es la cuenta para decidir, distinta de la de la ficha.
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
  'La ficha técnica completa. Costo Neto (= costo fijo + materiales) es el de '
  'la ficha impresa; costo_total_pieza suma además todo el proceso. Los costos '
  'del proceso son los MISMOS que usa Pago Maquilas, no una copia.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La vista expone los seis costos del proceso más las dos sumas.
--    Esperado: 8 filas.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'vw_ficha_tecnica'
  AND column_name IN ('costo_maquila','costo_lavanderia','costo_estampado',
                      'costo_bordado','costo_corte_externo','costo_otro',
                      'costo_servicios','costo_total_pieza')
ORDER BY column_name;

-- 2. Cuántas fichas traen cada costo. Los cuatro servicios están hoy en
--    cero: el Excel nunca los trajo y la ficha es donde se capturarán.
SELECT
  COUNT(*)                                              AS fichas,
  COUNT(*) FILTER (WHERE costo_maquila IS NOT NULL)     AS maquila,
  COUNT(*) FILTER (WHERE costo_lavanderia IS NOT NULL)  AS lavanderia,
  COUNT(*) FILTER (WHERE costo_estampado IS NOT NULL)   AS estampado,
  COUNT(*) FILTER (WHERE costo_bordado IS NOT NULL)     AS bordado,
  COUNT(*) FILTER (WHERE costo_corte_externo IS NOT NULL) AS corte_externo,
  COUNT(*) FILTER (WHERE costo_otro IS NOT NULL)        AS otros
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1;

-- 3. El Costo Neto NO cambió: sigue siendo fijo + materiales. 0 filas.
SELECT folio, costo_fijo, costo_tela, costo_habilitacion, costo_neto
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND ROUND(COALESCE(costo_fijo,0) + costo_tela + costo_habilitacion, 2)
      <> costo_neto;

-- 4. El costo total sí los incluye: total = neto + proceso. 0 filas.
SELECT folio, costo_neto, costo_maquila, costo_lavanderia,
       costo_servicios, costo_total_pieza
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND ROUND(costo_neto + COALESCE(costo_maquila,0)
            + COALESCE(costo_lavanderia,0) + costo_servicios, 2)
      <> costo_total_pieza;

-- 5. Las cinco columnas de responsable existen y apuntan al catálogo.
--    Esperado: 5 filas.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ordenes_produccion'
  AND column_name LIKE 'idmaquilero_%'
ORDER BY column_name;

-- 6. Ningún folio apunta a un maquilero inexistente. 0 filas.
--    (La FK ya lo impide; esto lo confirma.)
SELECT o.folio, o.idmaquilero_estampado
FROM manumoda.ordenes_produccion o
LEFT JOIN manumoda.maquileros m ON m.id = o.idmaquilero_estampado
WHERE o.idempresa = 1
  AND o.idmaquilero_estampado IS NOT NULL
  AND m.id IS NULL;

-- 7. Pago Maquilas sigue viendo lo suyo: las columnas no se tocaron.
SELECT COUNT(*) AS folios_en_pago_maquilas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1;

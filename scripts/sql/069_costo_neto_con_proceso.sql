-- ============================================================
-- Costo Neto: ahora incluye maquila y lavandería
--
-- LA REGLA, según operación (17-sep-2026):
--
--   Costo Neto = costo fijo
--              + tela + habilitación
--              + maquila + lavandería
--
--   Los servicios externos (estampado, bordado, corte externo, otros)
--   NO entran: se contratan por fuera y no todos los folios los llevan.
--   Siguen sumando al costo TOTAL por pieza, que es otra cuenta.
--
-- POR QUÉ ESTO REVIERTE AL SCRIPT 066:
--   El 066 los quitó porque las dos fichas impresas cuadraban sin
--   ellos. Pero ninguna de esas dos traía maquila ni lavandería
--   capturadas: con 0 el resultado es el mismo de las dos formas, así
--   que no probaban nada. Operación confirmó la regla.
--
-- QUÉ CAMBIA EN LA PRÁCTICA:
--   145 fichas tienen costo de maquila y 116 de lavandería. Su Costo
--   Neto sube y su Margen baja. En el folio 2008, por ejemplo, el neto
--   pasa de 9.50 a 53.50 y el margen de 90.50% a 46.50% sobre una venta
--   de 100.
--
--   No se pierde información: el margen se deriva, no se guarda, así
--   que basta con recrear la vista.
--
-- PREREQUISITO: script 068 ejecutado.
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
  'La ficha técnica completa. Costo Neto = costo fijo + materiales + maquila + '
  'lavandería; costo_total_pieza suma además los servicios externos. Ninguno '
  'se guarda: se derivan aquí para que no discrepen de sus partes.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El Costo Neto incluye maquila y lavandería. 0 filas.
SELECT folio, costo_fijo, costo_tela, costo_habilitacion,
       costo_maquila, costo_lavanderia, costo_neto
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND ROUND(COALESCE(costo_fijo,0) + costo_tela + costo_habilitacion
            + COALESCE(costo_maquila,0) + COALESCE(costo_lavanderia,0), 2)
      <> costo_neto;

-- 2. Y NO incluye los servicios externos: el total sí. 0 filas.
SELECT folio, costo_neto, costo_servicios, costo_total_pieza
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND ROUND(costo_neto + costo_servicios, 2) <> costo_total_pieza;

-- 3. Qué tanto se movió. Las fichas sin maquila ni lavandería no cambian;
--    las 145 que sí los tienen suben su neto.
SELECT
  COUNT(*)                                                    AS fichas,
  COUNT(*) FILTER (WHERE COALESCE(costo_maquila,0)
                       + COALESCE(costo_lavanderia,0) > 0)    AS afectadas,
  ROUND(AVG(costo_neto) FILTER (WHERE COALESCE(costo_maquila,0)
                       + COALESCE(costo_lavanderia,0) > 0), 2) AS neto_promedio
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1;

-- 4. El folio 2008, el caso que se revisó a mano.
--    Esperado: neto 53.50 = 9.50 + 38.00 + 6.00, margen 46.50 sobre 100.
SELECT folio, costo_fijo, costo_maquila, costo_lavanderia,
       costo_neto, precio_venta, margen_pct
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1 AND folio = '2008';

-- 5. El margen nunca pasa de 100 ni la división rompe. 0 filas.
SELECT folio, precio_venta, costo_neto, margen_pct
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1 AND margen_pct > 100;

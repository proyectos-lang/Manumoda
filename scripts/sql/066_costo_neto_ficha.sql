-- ============================================================
-- Costo Neto: solo costo fijo + materiales
--
-- EL ERROR QUE CORRIGE:
--   La vista sumaba también `costo_maquila` y `costo_lavanderia`. Hoy no
--   se nota porque esos dos campos están vacíos en las fichas, pero en
--   cuanto alguien los capture el Costo Neto dejaría de coincidir con la
--   ficha impresa, y el Margen se iría con él.
--
--   Las dos fichas reales lo confirman:
--
--     modelo 696:   9.50 + 0.00 (tela) + 6.46 (habilitación) = 15.96 ✔
--     modelo 2058:  9.50 + 64.40       + 7.25                = 81.15 ✔
--
--   En ambas el Costo Neto impreso cuadra al centavo SIN maquila ni
--   lavandería.
--
-- LAS REGLAS DE LA FRANJA DE COSTEO:
--   Costo Fijo      se captura; 9.50 por omisión
--   Costo Neto      DERIVADO = costo fijo + tela + habilitación
--   Precio Venta    se captura
--   Margen          DERIVADO = (venta − neto) / venta × 100
--   Precio Público  se captura, informativo
--
--   Los dos derivados no se guardan en ninguna columna: se calculan
--   aquí. Una copia almacenada es una copia que puede quedar en
--   desacuerdo con sus partes en cuanto alguien cambie una línea de
--   material.
--
-- PREREQUISITO: script 064 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. El costo fijo por omisión
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ALTER COLUMN costo_fijo SET DEFAULT 9.50;

COMMENT ON COLUMN manumoda.ordenes_produccion.costo_fijo IS
  'Costo fijo por pieza. 9.50 por omisión, editable en la ficha. Entra al '
  'Costo Neto, que NO se guarda: se deriva en vw_ficha_tecnica.';

-- Las órdenes que ya existen y nunca capturaron costo fijo toman el
-- valor por omisión. No se tocan las que ya tienen uno: puede haberse
-- capturado a propósito.
UPDATE manumoda.ordenes_produccion
SET costo_fijo = 9.50
WHERE idempresa = 1 AND costo_fijo IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. La vista, con el Costo Neto correcto
-- ════════════════════════════════════════════════════════════════════════════

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
    -- Se siguen exponiendo, pero YA NO entran al Costo Neto: la ficha
    -- impresa no los incluye. Son costos del proceso, no del material, y
    -- viven en Pago Maquilas.
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
    -- Margen % sobre el precio de venta. Se protege la división: un
    -- precio en 0 o nulo daría error.
    CASE WHEN COALESCE(o.precio_venta, 0) > 0 THEN
      ROUND(100.0 * (o.precio_venta - (
        COALESCE(o.costo_fijo, 0)
        + COALESCE(mt.importe, 0)
        + COALESCE(mh.importe, 0)
      )) / o.precio_venta, 2)
    END                               AS margen_pct
FROM manumoda.ordenes_produccion o
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
  'se derivan aquí; no se guardan para que no puedan discrepar de sus partes.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El costo fijo por omisión quedó puesto.
SELECT column_default
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ordenes_produccion'
  AND column_name = 'costo_fijo';

-- 2. Ninguna orden quedó sin costo fijo. Esperado: 0.
SELECT COUNT(*) AS sin_costo_fijo
FROM manumoda.ordenes_produccion
WHERE idempresa = 1 AND costo_fijo IS NULL;

-- 3. La aritmética de las dos fichas reales.
--    Esperado: 15.96 y 81.15, que es lo que dicen impresas.
SELECT
  ROUND(9.50 + 0.00 + 6.46, 2)  AS neto_696,
  15.96                          AS impreso_696,
  ROUND(9.50 + 64.40 + 7.25, 2) AS neto_2058,
  81.15                          AS impreso_2058;

-- 4. El margen del modelo 2058: (121.00 − 81.15) / 121.00 × 100 = 32.93,
--    que es el que trae impreso.
SELECT ROUND(100.0 * (121.00 - 81.15) / 121.00, 2) AS margen_2058,
       32.93 AS impreso;

-- 5. El Costo Neto ya NO incluye maquila ni lavandería. Se comprueba con
--    un folio que tenga esos costos: el neto debe ser fijo + materiales.
--    0 filas si la fórmula es la correcta.
SELECT folio, costo_fijo, costo_maquila, costo_lavanderia,
       costo_tela, costo_habilitacion, costo_neto
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1
  AND ROUND(COALESCE(costo_fijo,0) + costo_tela + costo_habilitacion, 2)
      <> costo_neto;

-- 6. El margen nunca pasa de 100. 0 filas.
SELECT folio, precio_venta, costo_neto, margen_pct
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1 AND margen_pct > 100;

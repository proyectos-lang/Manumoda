-- ============================================================
-- Costos y precios del folio
--
-- PROBLEMA: el Excel de folios trae 41 columnas pero el parser
-- solo leía 13 y descartaba el resto en silencio. Entre lo
-- descartado estaban los cuatro datos de dinero que necesita el
-- módulo de Pago Maquilas.
--
-- DISEÑO: los cuatro valores son POR PIEZA, tal como vienen del
-- archivo. Los totales NO se guardan: se derivan al multiplicar
-- por las piezas recibidas, para que un cambio de costo se
-- refleje sin tener que reescribir históricos.
--
--   Costo Maquila     -> costo_maquila      (se paga al maquilero)
--   Costo Lavanderia  -> costo_lavanderia   (se paga a un tercero)
--   PRECIO_VENTA      -> precio_venta       (base de penalizaciones)
--   PRECIO_PUBLICO    -> precio_publico     (informativo)
--
-- numeric(12,4): cuatro decimales porque son precios unitarios,
-- donde una fracción de centavo por pieza sí mueve el total de
-- un lote de miles de piezas.
--
-- ⚠️ Este script debe correrse ANTES de subir un Excel con el
-- código nuevo: el uploader ya consulta estas columnas.
--
-- PREREQUISITO: ninguno.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columnas de dinero
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS costo_maquila    numeric(12,4),
  ADD COLUMN IF NOT EXISTS costo_lavanderia numeric(12,4),
  ADD COLUMN IF NOT EXISTS precio_venta     numeric(12,4),
  ADD COLUMN IF NOT EXISTS precio_publico   numeric(12,4);

COMMENT ON COLUMN manumoda.ordenes_produccion.costo_maquila IS
  'Costo de maquila POR PIEZA (columna "Costo Maquila" del Excel). '
  'Lo que se le paga al maquilero. El total se deriva multiplicando '
  'por las piezas recibidas.';

COMMENT ON COLUMN manumoda.ordenes_produccion.costo_lavanderia IS
  'Costo de lavandería POR PIEZA (columna "Costo Lavanderia" del Excel). '
  'Se paga a un tercero, no al maquilero.';

COMMENT ON COLUMN manumoda.ordenes_produccion.precio_venta IS
  'Precio de venta POR PIEZA. Base del cálculo de penalizaciones: '
  'una pieza mala le cuesta al maquilero este importe.';

COMMENT ON COLUMN manumoda.ordenes_produccion.precio_publico IS
  'Precio al público POR PIEZA. Informativo; no entra en ningún cálculo.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Unicidad de (idempresa, folio)
--
--    No existía. Sin dinero de por medio un folio duplicado solo
--    ensuciaba listados; ahora sumaría dos veces en cualquier total
--    de pagos. Es la misma lección del script 011, que tuvo que
--    limpiar duplicados en diseno_programacion porque inflaban los
--    bonos sin que nadie lo notara.
--
--    Si el índice falla, hay duplicados: la consulta de detección
--    está en la sección de Verificación.
-- ════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_produccion_folio
  ON manumoda.ordenes_produccion (idempresa, folio);

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- Duplicados de folio. Debe devolver 0 filas; si devuelve alguna, el
-- índice de arriba habrá fallado y hay que resolverlos primero.
SELECT folio, COUNT(*) AS filas, array_agg(id ORDER BY id) AS ids
FROM manumoda.ordenes_produccion
GROUP BY idempresa, folio
HAVING COUNT(*) > 1;

-- Las columnas quedaron creadas y vacías (se llenan al subir el Excel).
SELECT
  COUNT(*)                                        AS ordenes,
  COUNT(costo_maquila)                            AS con_costo_maquila,
  COUNT(costo_lavanderia)                         AS con_costo_lavanderia,
  COUNT(precio_venta)                             AS con_precio_venta,
  COUNT(precio_publico)                           AS con_precio_publico
FROM manumoda.ordenes_produccion
WHERE idempresa = 1;

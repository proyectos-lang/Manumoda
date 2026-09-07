-- ============================================================
-- Limpieza de los datos de prueba de Pago Maquilas
--
-- QUÉ HACE:
--   Borra TODO lo que se capturó a mano mientras se construía el
--   módulo, para que operación empiece a registrar los pagos reales
--   de los folios existentes sobre una base limpia.
--
--   Se borra:
--     · maquila_pagos                 10 pagos · $617,539.35
--     · servicio_pagos                 1 pago  ·   $6,000.00
--     · maquila_recepciones           14 entregas · 11,549 pzs
--     · maquila_penalizaciones_fijas   4 marcadas
--     · maquila_penalizaciones         6 (tabla vieja, por piezas)
--     · servicio_unidades              2 (piezas procesadas y lavado)
--     · ordenes_produccion:            2 penalizacion_negociada
--                                      0 piezas_recibidas_ajuste
--                                      0 fecha_entrega_real
--
--   NO se toca:
--     · Los costos que vienen del Excel —costo_maquila (59 folios),
--       costo_lavanderia (53), precio_venta (335)— y el resto de la
--       orden: fechas, fases, piezas. Nada de eso se capturó aquí.
--     · El catálogo de penalizaciones (6 conceptos): es
--       configuración, no un movimiento.
--
-- ANTES DE BORRAR se deja un respaldo en el esquema `respaldo`. Es
-- dinero y entregas: si algo de lo borrado resulta ser real, se
-- recupera de ahí en vez de volver a capturarlo de memoria. Las
-- tablas se pueden eliminar cuando operación confirme que la base
-- quedó bien.
--
-- El módulo NO necesita cambios: todo el costeo se deriva, así que
-- al vaciar los movimientos los folios vuelven a "Sin recepción" o
-- "Pendiente" según su costo, que es el punto de partida correcto.
--
-- PREREQUISITO: scripts 027 a 049 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Respaldo
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS respaldo;

DROP TABLE IF EXISTS respaldo.maquila_pagos_20260907;
DROP TABLE IF EXISTS respaldo.servicio_pagos_20260907;
DROP TABLE IF EXISTS respaldo.maquila_recepciones_20260907;
DROP TABLE IF EXISTS respaldo.maquila_penalizaciones_fijas_20260907;
DROP TABLE IF EXISTS respaldo.maquila_penalizaciones_20260907;
DROP TABLE IF EXISTS respaldo.servicio_unidades_20260907;
DROP TABLE IF EXISTS respaldo.ordenes_ajustes_20260907;

CREATE TABLE respaldo.maquila_pagos_20260907 AS
  SELECT * FROM manumoda.maquila_pagos WHERE idempresa = 1;
CREATE TABLE respaldo.servicio_pagos_20260907 AS
  SELECT * FROM manumoda.servicio_pagos WHERE idempresa = 1;
CREATE TABLE respaldo.maquila_recepciones_20260907 AS
  SELECT * FROM manumoda.maquila_recepciones WHERE idempresa = 1;
CREATE TABLE respaldo.maquila_penalizaciones_fijas_20260907 AS
  SELECT * FROM manumoda.maquila_penalizaciones_fijas WHERE idempresa = 1;
CREATE TABLE respaldo.maquila_penalizaciones_20260907 AS
  SELECT * FROM manumoda.maquila_penalizaciones WHERE idempresa = 1;
CREATE TABLE respaldo.servicio_unidades_20260907 AS
  SELECT * FROM manumoda.servicio_unidades WHERE idempresa = 1;

-- Solo los folios con algún ajuste manual, con lo necesario para revertir
CREATE TABLE respaldo.ordenes_ajustes_20260907 AS
  SELECT folio, idempresa, piezas_recibidas_ajuste, fecha_entrega_real,
         penalizacion_negociada
  FROM manumoda.ordenes_produccion
  WHERE idempresa = 1
    AND (piezas_recibidas_ajuste IS NOT NULL
      OR fecha_entrega_real IS NOT NULL
      OR penalizacion_negociada IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Borrado
--
--    Los pagos van PRIMERO: el trigger del script 028 impide borrar una
--    recepción que todavía sostiene un pago. Al revés, el borrado falla.
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM manumoda.maquila_pagos                WHERE idempresa = 1;
DELETE FROM manumoda.servicio_pagos               WHERE idempresa = 1;
DELETE FROM manumoda.maquila_penalizaciones_fijas WHERE idempresa = 1;
DELETE FROM manumoda.maquila_penalizaciones       WHERE idempresa = 1;
DELETE FROM manumoda.maquila_recepciones          WHERE idempresa = 1;
DELETE FROM manumoda.servicio_unidades            WHERE idempresa = 1;

-- Los ajustes manuales de la orden vuelven a su valor derivado.
-- NO se tocan los costos ni el precio de venta: vienen del Excel.
UPDATE manumoda.ordenes_produccion
SET piezas_recibidas_ajuste = NULL,
    fecha_entrega_real      = NULL,
    penalizacion_negociada  = NULL
WHERE idempresa = 1
  AND (piezas_recibidas_ajuste IS NOT NULL
    OR fecha_entrega_real IS NOT NULL
    OR penalizacion_negociada IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Todo en cero. Las seis columnas deben dar 0.
SELECT
  (SELECT COUNT(*) FROM manumoda.maquila_pagos                WHERE idempresa = 1) AS pagos,
  (SELECT COUNT(*) FROM manumoda.servicio_pagos               WHERE idempresa = 1) AS pagos_servicio,
  (SELECT COUNT(*) FROM manumoda.maquila_recepciones          WHERE idempresa = 1) AS entregas,
  (SELECT COUNT(*) FROM manumoda.maquila_penalizaciones_fijas WHERE idempresa = 1) AS penal_fijas,
  (SELECT COUNT(*) FROM manumoda.maquila_penalizaciones       WHERE idempresa = 1) AS penal_viejas,
  (SELECT COUNT(*) FROM manumoda.servicio_unidades            WHERE idempresa = 1) AS unidades;

-- 2. Ningún ajuste manual debe quedar. 0 filas.
SELECT folio, piezas_recibidas_ajuste, fecha_entrega_real, penalizacion_negociada
FROM manumoda.ordenes_produccion
WHERE idempresa = 1
  AND (piezas_recibidas_ajuste IS NOT NULL
    OR fecha_entrega_real IS NOT NULL
    OR penalizacion_negociada IS NOT NULL);

-- 3. Los costos del Excel siguen intactos. Esperado: 59 / 53 / 335.
SELECT
  COUNT(*) FILTER (WHERE costo_maquila    IS NOT NULL) AS con_costo_maquila,
  COUNT(*) FILTER (WHERE costo_lavanderia IS NOT NULL) AS con_costo_lavanderia,
  COUNT(*) FILTER (WHERE precio_venta     IS NOT NULL) AS con_precio_venta
FROM manumoda.ordenes_produccion
WHERE idempresa = 1;

-- 4. El catálogo de penalizaciones sigue completo: 6 conceptos, 4 casillas.
SELECT COUNT(*) AS conceptos, COUNT(*) FILTER (WHERE activo) AS casillas
FROM manumoda.cat_penalizaciones_maquila
WHERE idempresa = 1;

-- 5. El módulo queda en su punto de partida: nada pagado, nada recibido,
--    y el valor a pagar de vuelta en el costo puro menos no entregadas.
SELECT
  COUNT(*)                                        AS folios,
  COUNT(*) FILTER (WHERE estado_pago = 'Sin costo')     AS sin_costo,
  COUNT(*) FILTER (WHERE estado_pago = 'Sin recepción') AS sin_recepcion,
  ROUND(SUM(valor_pagado), 2)                     AS pagado,
  ROUND(SUM(valor_penalizaciones_fijas), 2)       AS penal_fijas,
  ROUND(SUM(valor_parcialidades), 2)              AS parcialidades
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 6. El respaldo, por si algo de lo borrado resultaba real.
SELECT 'maquila_pagos' AS tabla, COUNT(*) AS filas FROM respaldo.maquila_pagos_20260907
UNION ALL SELECT 'servicio_pagos',      COUNT(*) FROM respaldo.servicio_pagos_20260907
UNION ALL SELECT 'maquila_recepciones', COUNT(*) FROM respaldo.maquila_recepciones_20260907
UNION ALL SELECT 'penalizaciones_fijas',COUNT(*) FROM respaldo.maquila_penalizaciones_fijas_20260907
UNION ALL SELECT 'penalizaciones',      COUNT(*) FROM respaldo.maquila_penalizaciones_20260907
UNION ALL SELECT 'servicio_unidades',   COUNT(*) FROM respaldo.servicio_unidades_20260907
UNION ALL SELECT 'ordenes_ajustes',     COUNT(*) FROM respaldo.ordenes_ajustes_20260907;

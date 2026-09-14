-- ============================================================
-- Historial de movimientos de inventario
--
-- QUÉ AGREGA:
--   `vw_inventario_movimientos`: entradas y salidas de habilitaciones
--   y telas en una sola línea de tiempo.
--
--   Las dos viven en tablas distintas —`inventario_ingreso_detalle`
--   y `inventario_salidas`— porque son hechos distintos: una compra
--   tiene proveedor y precio pagado; un consumo tiene folio y rollo.
--   Forzarlas a una sola tabla habría llenado de columnas vacías la
--   mitad de los renglones.
--
--   La vista las une con UNION ALL y normaliza lo común: fecha,
--   artículo, cantidad e importe. `signo` (+1 / -1) permite sumar el
--   saldo sin tener que saber de qué tabla vino cada fila.
--
--   Los ids de las dos tablas vienen de secuencias distintas y se
--   repiten, así que se expone `clave` con prefijo —E- para entrada,
--   S- para salida— para identificar cada movimiento de forma única.
--   Mismo criterio que `vw_historial_pagos` (script 031).
--
-- SOBRE LA VALORACIÓN:
--   Una entrada vale lo que se pagó por ella. Una salida se valora
--   al COSTO PROMEDIO del artículo, no al de la última compra: si
--   entraron 100 m a $80 y 100 m a $90, los metros que salen no son
--   unos ni otros. El promedio es el criterio contable estándar y el
--   único que hace que las salidas sumen exactamente lo que entró.
--
-- PREREQUISITO: script 054 ejecutado.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_inventario_movimientos;

CREATE VIEW manumoda.vw_inventario_movimientos AS
WITH costo_articulo AS (
    -- Costo promedio ponderado por artículo. Es lo que vale una unidad
    -- que sale, sin importar de qué compra vino.
    SELECT
        d.idempresa,
        d.idarticulo,
        CASE WHEN SUM(d.cantidad) > 0
             THEN ROUND(SUM(d.cantidad * d.costo_unitario) / SUM(d.cantidad), 4)
        END AS costo_promedio
    FROM manumoda.inventario_ingreso_detalle d
    GROUP BY d.idempresa, d.idarticulo
)
SELECT
    ('E-' || d.id::text)      AS clave,
    'Entrada'::text           AS movimiento,
    d.idempresa,
    i.fecha,
    d.idarticulo,
    a.tipo,
    a.clave                   AS articulo_clave,
    a.nombre                  AS articulo_nombre,
    a.unidad_medida,
    d.cantidad,
    1                         AS signo,
    d.costo_unitario,
    ROUND(d.cantidad * d.costo_unitario, 2) AS importe,
    p.nombre                  AS proveedor,
    i.folio_compra            AS referencia,
    NULL::text                AS folio,
    NULL::text                AS rollo,
    i.comentarios             AS motivo,
    i.capturado_por,
    d.created_at
FROM manumoda.inventario_ingreso_detalle d
JOIN manumoda.inventario_ingresos i
  ON i.id = d.idingreso
JOIN manumoda.articulos a
  ON a.id = d.idarticulo
LEFT JOIN manumoda.proveedores p
  ON p.id = i.idproveedor

UNION ALL

SELECT
    ('S-' || s.id::text)      AS clave,
    'Salida'::text            AS movimiento,
    s.idempresa,
    s.fecha,
    s.idarticulo,
    a.tipo,
    a.clave                   AS articulo_clave,
    a.nombre                  AS articulo_nombre,
    a.unidad_medida,
    s.cantidad,
    -1                        AS signo,
    c.costo_promedio          AS costo_unitario,
    ROUND(s.cantidad * COALESCE(c.costo_promedio, 0), 2) AS importe,
    NULL::text                AS proveedor,
    NULL::text                AS referencia,
    s.folio,
    tr.codigo                 AS rollo,
    s.motivo,
    s.capturado_por,
    s.created_at
FROM manumoda.inventario_salidas s
JOIN manumoda.articulos a
  ON a.id = s.idarticulo
LEFT JOIN manumoda.tela_rollos tr
  ON tr.id = s.idrollo
LEFT JOIN costo_articulo c
  ON c.idarticulo = s.idarticulo AND c.idempresa = s.idempresa;

COMMENT ON VIEW manumoda.vw_inventario_movimientos IS
  'Entradas y salidas de habilitaciones y telas en una sola línea de tiempo. '
  'Las entradas valen lo que se pagó; las salidas, el costo promedio del '
  'artículo. `signo` permite sumar el saldo sin distinguir el origen.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La vista debe existir y responder.
SELECT COUNT(*) AS movimientos
FROM manumoda.vw_inventario_movimientos
WHERE idempresa = 1;

-- 2. Nada se pierde ni se duplica: la vista trae exactamente lo que suman
--    las dos tablas. 0 filas.
SELECT
  (SELECT COUNT(*) FROM manumoda.vw_inventario_movimientos WHERE idempresa = 1) AS en_vista,
  (SELECT COUNT(*) FROM manumoda.inventario_ingreso_detalle WHERE idempresa = 1) AS entradas,
  (SELECT COUNT(*) FROM manumoda.inventario_salidas WHERE idempresa = 1) AS salidas
WHERE (SELECT COUNT(*) FROM manumoda.vw_inventario_movimientos WHERE idempresa = 1)
   <> (SELECT COUNT(*) FROM manumoda.inventario_ingreso_detalle WHERE idempresa = 1)
    + (SELECT COUNT(*) FROM manumoda.inventario_salidas WHERE idempresa = 1);

-- 3. Claves únicas: los ids de las dos tablas se repiten, por eso el
--    prefijo. 0 filas.
SELECT clave, COUNT(*)
FROM manumoda.vw_inventario_movimientos
WHERE idempresa = 1
GROUP BY clave
HAVING COUNT(*) > 1;

-- 4. El saldo que sale de los movimientos debe cuadrar con el de la vista
--    de artículos. 0 filas.
SELECT a.clave, a.existencia, m.saldo
FROM manumoda.vw_inventario_articulos a
JOIN LATERAL (
  SELECT COALESCE(SUM(cantidad * signo), 0) AS saldo
  FROM manumoda.vw_inventario_movimientos
  WHERE idarticulo = a.id AND idempresa = a.idempresa
) m ON true
WHERE a.idempresa = 1
  AND abs(a.existencia - m.saldo) > 0.0005;

-- 5. Reparto por tipo de movimiento.
SELECT movimiento, tipo, COUNT(*) AS cuantos,
       ROUND(SUM(cantidad), 3) AS cantidad, ROUND(SUM(importe), 2) AS importe
FROM manumoda.vw_inventario_movimientos
WHERE idempresa = 1
GROUP BY movimiento, tipo
ORDER BY movimiento, tipo;

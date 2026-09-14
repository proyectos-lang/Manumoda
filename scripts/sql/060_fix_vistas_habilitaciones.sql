-- ============================================================
-- Corrección: las vistas de habilitaciones filtraban mal
--
-- QUÉ PASÓ:
--   El script 059 filtra por `tipo = 'Habilitacion'`, sin acento, pero
--   el dominio `tipo_articulo` (script 054) solo acepta 'Habilitación'
--   CON acento. Resultado: las dos vistas existen pero devuelven
--   siempre 0 filas, aunque las 927 habilitaciones estén cargadas.
--
--   No dio error al crearlas —comparar texto con un valor que nunca
--   ocurre es válido— así que el fallo solo se ve al consultarlas.
--
-- QUÉ MÁS CORRIGE:
--   Dos categorías que son la misma cosa escrita de dos formas, y que
--   sin unificar aparecerían como tipos distintos en el selector de la
--   ficha técnica:
--
--     BOTÓN           -> BOTON            (1 artículo)
--     ETIQUETA TELA   -> ETIQUETA DE TELA (30 artículos)
--
-- PREREQUISITO: script 059 ejecutado y las habilitaciones cargadas.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Unificar las categorías escritas de dos formas
-- ════════════════════════════════════════════════════════════════════════════

UPDATE manumoda.articulos
SET categoria = 'BOTON'
WHERE idempresa = 1 AND tipo = 'Habilitación' AND categoria = 'BOTÓN';

UPDATE manumoda.articulos
SET categoria = 'ETIQUETA DE TELA'
WHERE idempresa = 1 AND tipo = 'Habilitación' AND categoria = 'ETIQUETA TELA';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Recrear las vistas con el valor correcto
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_habilitaciones;

CREATE VIEW manumoda.vw_habilitaciones AS
SELECT
    a.id,
    a.idempresa,
    a.clave,
    a.nombre,
    a.categoria,
    a.material,
    a.color,
    a.medida,
    a.descripcion,
    a.clave_proveedor,
    a.consecutivo,
    a.unidad_medida,
    a.costo_unitario,
    a.stock_minimo,
    a.atributos,
    a.activo,
    p.nombre AS proveedor,
    a.idproveedor
FROM manumoda.articulos a
LEFT JOIN manumoda.proveedores p ON p.id = a.idproveedor
-- CON ACENTO: es el único valor que acepta el dominio tipo_articulo.
WHERE a.tipo = 'Habilitación';

COMMENT ON VIEW manumoda.vw_habilitaciones IS
  'El catálogo de habilitaciones con su proveedor resuelto. `atributos` trae '
  'lo propio de cada tipo.';

DROP VIEW IF EXISTS manumoda.vw_habilitaciones_categorias;

CREATE VIEW manumoda.vw_habilitaciones_categorias AS
SELECT
    idempresa,
    categoria,
    COUNT(*)                                      AS articulos,
    COUNT(DISTINCT idproveedor)                   AS proveedores,
    COUNT(DISTINCT color)                         AS colores,
    ROUND(MIN(costo_unitario), 4)                 AS precio_min,
    ROUND(MAX(costo_unitario), 4)                 AS precio_max,
    ROUND(AVG(costo_unitario), 4)                 AS precio_promedio
FROM manumoda.articulos
WHERE tipo = 'Habilitación' AND categoria IS NOT NULL
GROUP BY idempresa, categoria;

COMMENT ON VIEW manumoda.vw_habilitaciones_categorias IS
  'Cuántas habilitaciones hay de cada tipo y en qué rango de precio. Para el '
  'selector al capturar la ficha técnica.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Ahora sí debe traer 927. Antes traía 0.
SELECT COUNT(*) AS habilitaciones FROM manumoda.vw_habilitaciones WHERE idempresa = 1;

-- 2. Las telas siguen intactas: 756.
SELECT COUNT(*) AS telas FROM manumoda.vw_telas WHERE idempresa = 1;

-- 3. Ya no debe haber variantes de la misma categoría. 0 filas.
SELECT upper(translate(categoria, 'ÁÉÍÓÚ', 'AEIOU')) AS normalizada,
       array_agg(DISTINCT categoria) AS variantes
FROM manumoda.articulos
WHERE idempresa = 1 AND tipo = 'Habilitación' AND categoria IS NOT NULL
GROUP BY 1
HAVING COUNT(DISTINCT categoria) > 1;

-- 4. El reparto por tipo: 38 categorías tras unificar las dos.
SELECT categoria, articulos, proveedores, precio_min, precio_max
FROM manumoda.vw_habilitaciones_categorias
WHERE idempresa = 1
ORDER BY articulos DESC;

-- 5. Ninguna sin precio. 0 filas.
SELECT clave, nombre, categoria
FROM manumoda.vw_habilitaciones
WHERE idempresa = 1 AND costo_unitario IS NULL;

-- 6. Las 25 sin proveedor son de hojas que no traen esa columna
--    (Etiqueta de cartón sobre todo). No es un error de carga: el dato
--    no está en el archivo. Se completan a mano cuando se sepa.
SELECT categoria, COUNT(*) AS sin_proveedor
FROM manumoda.vw_habilitaciones
WHERE idempresa = 1 AND idproveedor IS NULL
GROUP BY categoria
ORDER BY 2 DESC;

-- ============================================================
-- Habilitaciones — categoría y atributos propios de cada tipo
--
-- EL PROBLEMA:
--   El archivo "2026-HIBILITACIONES-REGISTRO DE HABILITACION" trae
--   33 hojas, una por tipo de producto: Botón, Cierre, Gancho,
--   Tallero, Ojillos, Remaches… Y cada tipo captura cosas distintas:
--
--     Botón            -> #Hoyos, medida en mm, tipo de material
--     Tallero          -> Talla
--     Etiqueta cartón  -> Cliente, Departamento
--     Gancho           -> Alta/Baja/Completo, pulgadas
--     Cinta            -> metros por rollo
--
--   No hay un juego de columnas que sirva para los 31 tipos.
--
-- LA SOLUCIÓN, EN UNA SOLA TABLA:
--   Las habilitaciones ya viven en `articulos` (script 054), junto a
--   las telas. Se conserva así —una sola tabla— como se pidió.
--
--   Lo que TODAS tienen (clave, nombre, color, medida, proveedor,
--   precio unitario, descripción) va en columnas, porque se filtra y
--   se suma por ello.
--
--   Lo que cambia por tipo va en `atributos jsonb`. Es el mismo
--   criterio del script 056: columnas para lo que no varía, jsonb
--   para lo que sí. Con columnas fijas harían falta ~60 campos, casi
--   todos vacíos en casi todas las filas, y cada tipo nuevo de
--   habilitación sería una migración.
--
--   `categoria` dice de qué tipo es cada una, y es lo que permite
--   agrupar y filtrar sin mirar dentro del jsonb.
--
-- POR QUÉ NO UNA TABLA POR TIPO:
--   Serían 31 tablas con el mismo esqueleto, 31 juegos de saldos y
--   movimientos, y cada consulta de existencias tendría que unirlas
--   por UNION. La ficha técnica tendría que saber en qué tabla vive
--   cada material.
--
-- SOBRE EL PRECIO:
--   El archivo trae precio de mayoreo, cantidad por paquete y precio
--   unitario. El que se guarda en `costo_unitario` es el UNITARIO,
--   porque es el que multiplica la ficha técnica. El de mayoreo y la
--   cantidad se conservan en `atributos` para poder reconstruir de
--   dónde salió.
--
-- PREREQUISITO: script 054 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Categoría y atributos
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.articulos
  /** El tipo de habilitación: BOTON, CIERRE, GANCHO… Una por hoja del archivo. */
  ADD COLUMN IF NOT EXISTS categoria    text,
  ADD COLUMN IF NOT EXISTS color        text,
  ADD COLUMN IF NOT EXISTS medida       text,
  /** Material: METAL, PLASTICO, CUERNO, POLIPROPILENO… */
  ADD COLUMN IF NOT EXISTS material     text,
  /** La clave con que el proveedor identifica el producto en su catálogo. */
  ADD COLUMN IF NOT EXISTS clave_proveedor text,
  /**
   * Lo que solo aplica a este tipo: #Hoyos en botones, Talla en
   * talleros, Departamento en etiquetas, metros por rollo en cintas.
   *
   * jsonb y no columnas porque son ~60 atributos distintos repartidos
   * en 31 tipos: como columnas, la tabla quedaría casi toda vacía y
   * cada tipo nuevo sería una migración.
   */
  ADD COLUMN IF NOT EXISTS atributos    jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN manumoda.articulos.categoria IS
  'Tipo de habilitación (BOTON, CIERRE, GANCHO…). En telas queda NULL: '
  'ellas se clasifican por tela_familia.';

COMMENT ON COLUMN manumoda.articulos.atributos IS
  'Atributos propios del tipo, en jsonb. Son ~60 distintos repartidos en 31 '
  'tipos de habilitación; como columnas la tabla quedaría casi toda vacía.';

COMMENT ON COLUMN manumoda.articulos.clave_proveedor IS
  'La clave con que el proveedor identifica el producto. Sirve para pedirle '
  'y para conciliar su factura.';

-- Índice para filtrar por tipo, que es como se busca una habilitación.
CREATE INDEX IF NOT EXISTS ix_articulos_categoria
  ON manumoda.articulos (idempresa, categoria)
  WHERE categoria IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_articulos_color
  ON manumoda.articulos (idempresa, color)
  WHERE color IS NOT NULL;

-- GIN para poder buscar dentro de los atributos: «botones de 4 hoyos».
CREATE INDEX IF NOT EXISTS ix_articulos_atributos
  ON manumoda.articulos USING gin (atributos);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_habilitaciones — el catálogo, listo para buscar
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
WHERE a.tipo = 'Habilitación';

COMMENT ON VIEW manumoda.vw_habilitaciones IS
  'El catálogo de habilitaciones con su proveedor resuelto. `atributos` trae '
  'lo propio de cada tipo.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_habilitaciones_categorias — qué hay de cada tipo
-- ════════════════════════════════════════════════════════════════════════════

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

-- 1. Las columnas nuevas existen. Esperado: 6 filas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'articulos'
  AND column_name IN ('categoria','color','medida','material','clave_proveedor','atributos')
ORDER BY column_name;

-- 2. Las vistas responden (vacías antes de la carga).
SELECT COUNT(*) AS habilitaciones FROM manumoda.vw_habilitaciones WHERE idempresa = 1;

-- 3. Las telas cargadas NO deben haberse tocado: siguen 756 y sin categoría.
SELECT
  COUNT(*)                                   AS telas,
  COUNT(*) FILTER (WHERE categoria IS NULL)  AS sin_categoria
FROM manumoda.articulos
WHERE idempresa = 1 AND tipo = 'Tela';

-- 4. Después de cargar: el reparto por tipo de habilitación.
SELECT categoria, articulos, proveedores, precio_min, precio_max
FROM manumoda.vw_habilitaciones_categorias
WHERE idempresa = 1
ORDER BY articulos DESC;

-- 5. Ninguna habilitación sin precio. 0 filas.
SELECT clave, nombre, categoria
FROM manumoda.vw_habilitaciones
WHERE idempresa = 1 AND costo_unitario IS NULL;

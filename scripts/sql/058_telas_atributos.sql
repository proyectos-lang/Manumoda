-- ============================================================
-- Atributos de tela + preparación para la carga inicial
--
-- QUÉ AGREGA:
--   El archivo "Registro telas oficial con precio (10-JUN-24)" trae
--   913 telas con seis atributos que `articulos` no tenía: tipo de
--   tela (mezclilla, rib, gabardina…), acabado (rígida/stretch),
--   nombre comercial, color, composición y la clave interna
--   estructurada.
--
--   Se agregan como columnas y NO dentro de un jsonb porque son
--   atributos fijos de toda tela, se filtra por ellos al buscar una
--   («mezclilla rígida índigo») y se quiere que la base valide el
--   acabado. `datos jsonb` es para lo que varía; esto no varía.
--
-- POR QUÉ EN `articulos` Y NO EN UNA TABLA `telas` APARTE:
--   Inventarios ya trata telas y habilitaciones como artículos, con
--   una sola tabla de saldos, movimientos e ingresos (script 054).
--   Una tabla aparte obligaría a duplicar todo eso y a unir por
--   UNION en cada consulta de existencias. Las columnas nuevas son
--   NULL para las habilitaciones, que es lo correcto: una etiqueta
--   no tiene composición.
--
-- SOBRE EL ACABADO:
--   El archivo escribe el mismo acabado de seis formas: RIGIDA,
--   RIGIDO, RIG, STRECH, STRCH, ESTRECH. Se normaliza a dos valores
--   —Rigida y Stretch— con un dominio que lo impone. Sin esto,
--   filtrar por "rígida" perdería las 296 que dicen "RIGIDO".
--
-- LA CARGA DE LAS 913 FILAS NO VA EN ESTE SCRIPT:
--   Va por la app, que puede reportar fila por fila lo que no cuadró.
--   Aquí solo queda el esquema listo y la verificación.
--
-- PREREQUISITO: script 054 ejecutado (tabla `articulos`).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. El acabado, con sus dos únicos valores válidos
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'acabado_tela' AND n.nspname = 'manumoda'
  ) THEN
    CREATE DOMAIN manumoda.acabado_tela AS text
      CHECK (VALUE IN ('Rigida', 'Stretch', 'Circular'));
  END IF;
END $$;

COMMENT ON DOMAIN manumoda.acabado_tela IS
  'El archivo de origen escribe esto de seis formas (RIGIDA, RIGIDO, RIG, '
  'STRECH, STRCH, ESTRECH). El dominio obliga a normalizar al cargar.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Los atributos de tela
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.articulos
  /** Familia de la tela: MEZCLILLA, RIB, GABARDINA… (102 en el archivo). */
  ADD COLUMN IF NOT EXISTS tela_familia     text,
  ADD COLUMN IF NOT EXISTS tela_acabado     manumoda.acabado_tela,
  /** Nombre comercial: PRADA, GRECIA, LEBRON… */
  ADD COLUMN IF NOT EXISTS tela_nombre      text,
  ADD COLUMN IF NOT EXISTS tela_color       text,
  /** Composición informativa, tal como viene del proveedor. */
  ADD COLUMN IF NOT EXISTS tela_composicion text,
  /** Consecutivo del archivo oficial, para poder rastrear el origen. */
  ADD COLUMN IF NOT EXISTS consecutivo      integer,
  /** Descripción larga del archivo: la que lee quien compra. */
  ADD COLUMN IF NOT EXISTS descripcion      text;

COMMENT ON COLUMN manumoda.articulos.tela_familia IS
  'Familia de la tela (MEZCLILLA, RIB…). NULL en habilitaciones.';

COMMENT ON COLUMN manumoda.articulos.tela_composicion IS
  'Composición tal como la reporta el proveedor. Informativa: en el archivo '
  'de origen hay composiciones que no suman 100%, y corregirlas sería '
  'inventar un dato que solo el proveedor conoce.';

COMMENT ON COLUMN manumoda.articulos.consecutivo IS
  'Consecutivo del archivo oficial de telas. Permite rastrear cada artículo '
  'hasta su renglón de origen.';

-- Índices para la búsqueda que hace quien cotiza: por familia y color.
CREATE INDEX IF NOT EXISTS ix_articulos_tela_familia
  ON manumoda.articulos (idempresa, tela_familia)
  WHERE tela_familia IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_articulos_tela_color
  ON manumoda.articulos (idempresa, tela_color)
  WHERE tela_color IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_telas — el catálogo de telas, listo para buscar
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_telas;

CREATE VIEW manumoda.vw_telas AS
SELECT
    a.id,
    a.idempresa,
    a.clave,
    a.nombre,
    a.tela_familia,
    a.tela_acabado,
    a.tela_nombre,
    a.tela_color,
    a.tela_composicion,
    a.descripcion,
    a.consecutivo,
    a.unidad_medida,
    a.costo_unitario,
    a.stock_minimo,
    a.activo,
    p.nombre AS proveedor,
    a.idproveedor
FROM manumoda.articulos a
LEFT JOIN manumoda.proveedores p ON p.id = a.idproveedor
WHERE a.tipo = 'Tela';

COMMENT ON VIEW manumoda.vw_telas IS
  'El catálogo de telas con su proveedor resuelto. Para la búsqueda al '
  'capturar la ficha técnica y al cotizar.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las columnas nuevas existen. Esperado: 7 filas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'articulos'
  AND column_name IN ('tela_familia','tela_acabado','tela_nombre','tela_color',
                      'tela_composicion','consecutivo','descripcion')
ORDER BY column_name;

-- 2. El dominio rechaza un acabado sin normalizar. Debe dar ERROR:
--    'value for domain manumoda.acabado_tela violates check constraint'.
--    Si NO da error, el dominio no se creó y la normalización no está
--    protegida. Descomentar para probar:
-- SELECT 'RIGIDO'::manumoda.acabado_tela;

-- 3. La vista responde (vacía antes de la carga).
SELECT COUNT(*) AS telas FROM manumoda.vw_telas WHERE idempresa = 1;

-- 4. Después de cargar, estas cifras deben cuadrar con el archivo:
--    total 756 telas (913 renglones − 157 claves repetidas).
SELECT
  COUNT(*)                                        AS telas,
  COUNT(DISTINCT tela_familia)                    AS familias,
  COUNT(DISTINCT tela_color)                      AS colores,
  COUNT(DISTINCT idproveedor)                     AS proveedores,
  COUNT(*) FILTER (WHERE tela_acabado = 'Rigida') AS rigidas,
  COUNT(*) FILTER (WHERE tela_acabado = 'Stretch')AS stretch,
  ROUND(MIN(costo_unitario), 2)                   AS precio_min,
  ROUND(MAX(costo_unitario), 2)                   AS precio_max
FROM manumoda.vw_telas
WHERE idempresa = 1;

-- 5. Ninguna tela debe quedar sin precio ni sin proveedor. 0 filas.
SELECT clave, nombre, costo_unitario, idproveedor
FROM manumoda.vw_telas
WHERE idempresa = 1 AND (costo_unitario IS NULL OR idproveedor IS NULL);

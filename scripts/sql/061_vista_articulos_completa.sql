-- ============================================================
-- La vista de artículos no exponía los campos del catálogo
--
-- EL PROBLEMA:
--   `vw_inventario_articulos` se creó en el script 054, antes de que
--   los scripts 058 y 059 agregaran los 13 campos del catálogo
--   oficial (familia, acabado, composición, categoría, material,
--   medida, atributos…).
--
--   La tabla de Inventarios lee de esta vista, así que al abrir un
--   artículo para editarlo esos campos llegaban vacíos. Guardar
--   habría borrado la familia de una tela o los atributos de un
--   botón sin ningún aviso.
--
--   No es hipotético: son 756 telas y 927 habilitaciones que acaban
--   de cargarse con esos datos.
--
-- PREREQUISITO: scripts 058 y 059 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_inventario_articulos;

CREATE VIEW manumoda.vw_inventario_articulos AS
SELECT
    a.id,
    a.idempresa,
    a.tipo,
    a.clave,
    a.nombre,
    a.unidad_medida,
    a.costo_unitario,
    a.stock_minimo,
    a.activo,
    a.idproveedor,
    p.nombre AS proveedor,

    -- Los campos del catálogo oficial. Sin ellos, editar un artículo
    -- desde la tabla borraba lo que la carga había traído.
    a.descripcion,
    a.consecutivo,
    a.clave_proveedor,
    a.tela_familia,
    a.tela_acabado,
    a.tela_nombre,
    a.tela_color,
    a.tela_composicion,
    a.categoria,
    a.color,
    a.medida,
    a.material,
    a.atributos,

    -- Movimientos. Copiado tal cual del script 054: LATERAL y no JOIN,
    -- porque dos JOIN a las tablas hijas se multiplicarian entre si e
    -- inflarian las cantidades.
    COALESCE(e.cantidad, 0)         AS total_ingresado,
    COALESCE(s.cantidad, 0)         AS total_salidas,
    COALESCE(e.cantidad, 0) - COALESCE(s.cantidad, 0) AS existencia,
    -- Valorizado al costo real de compra, no al de referencia
    COALESCE(e.importe, 0)          AS importe_ingresado,
    CASE WHEN COALESCE(e.cantidad, 0) > 0
         THEN ROUND(COALESCE(e.importe, 0) / e.cantidad, 4)
    END                             AS costo_promedio,
    (a.stock_minimo IS NOT NULL
      AND COALESCE(e.cantidad, 0) - COALESCE(s.cantidad, 0) < a.stock_minimo)
                                    AS bajo_minimo,
    r.rollos,
    r.rollos_disponibles
FROM manumoda.articulos a
LEFT JOIN manumoda.proveedores p
  ON p.id = a.idproveedor
LEFT JOIN LATERAL (
    SELECT SUM(cantidad) AS cantidad, SUM(cantidad * costo_unitario) AS importe
    FROM manumoda.inventario_ingreso_detalle
    WHERE idarticulo = a.id AND idempresa = a.idempresa
) e ON true
LEFT JOIN LATERAL (
    SELECT SUM(cantidad) AS cantidad
    FROM manumoda.inventario_salidas
    WHERE idarticulo = a.id AND idempresa = a.idempresa
) s ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS rollos,
           COUNT(*) FILTER (
             WHERE tr.metros_inicial - COALESCE((
               SELECT SUM(cantidad) FROM manumoda.inventario_salidas
               WHERE idrollo = tr.id
             ), 0) > 0.0005
           ) AS rollos_disponibles
    FROM manumoda.tela_rollos tr
    WHERE tr.idarticulo = a.id AND tr.idempresa = a.idempresa
) r ON true;

COMMENT ON VIEW manumoda.vw_inventario_articulos IS
  'Artículos con su existencia, costo promedio y rollos. Incluye los campos '
  'del catálogo oficial para que la edición no los pierda.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La vista ahora expone los 13 campos del catálogo. Esperado: 13 filas.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'vw_inventario_articulos'
  AND column_name IN ('descripcion','consecutivo','clave_proveedor','tela_familia',
                      'tela_acabado','tela_nombre','tela_color','tela_composicion',
                      'categoria','color','medida','material','atributos')
ORDER BY column_name;

-- 2. Siguen los 1,683 artículos: 756 telas + 927 habilitaciones.
SELECT tipo, COUNT(*) AS articulos
FROM manumoda.vw_inventario_articulos
WHERE idempresa = 1
GROUP BY tipo
ORDER BY tipo;

-- 3. Los datos del catálogo llegan llenos, no vacíos.
--    Esperado: 756 telas con familia; 927 habilitaciones con categoría.
SELECT
  COUNT(*) FILTER (WHERE tipo = 'Tela' AND tela_familia IS NOT NULL)          AS telas_con_familia,
  COUNT(*) FILTER (WHERE tipo = 'Habilitación' AND categoria IS NOT NULL)     AS hab_con_categoria,
  COUNT(*) FILTER (WHERE tipo = 'Habilitación' AND atributos <> '{}'::jsonb)  AS hab_con_atributos
FROM manumoda.vw_inventario_articulos
WHERE idempresa = 1;

-- 4. La existencia no cambió de significado: sin movimientos, todo en 0.
SELECT COUNT(*) AS con_existencia
FROM manumoda.vw_inventario_articulos
WHERE idempresa = 1 AND existencia <> 0;

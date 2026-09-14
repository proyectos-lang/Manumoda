-- ============================================================
-- Ficha técnica — lo que se registra en la etapa 1 (Pre orden)
--
-- QUÉ MODELA:
--   La ficha del sistema anterior (hamui.sistemasenlace.com), que se
--   captura al abrir la orden y se imprime como PDF.
--
--   Tiene tres partes de naturaleza distinta, y por eso tres destinos
--   distintos:
--
--   a) CAMPOS SIMPLES (razón social, marca, num pedido, descripción,
--      los costos y precios) -> columnas en `ordenes_produccion`.
--      La mitad ya existía: modelo, cliente, num_pedido, piezas,
--      precio_venta, precio_publico, costo_maquila, fecha_cancelacion.
--      Aquí solo se agrega lo que faltaba.
--
--   b) LAS DOS TABLAS DE TALLAS (Especificación de Talla y Piezas
--      Cortadas), una fila por color con su cantidad por talla
--      -> `ficha_tallas`.
--
--   c) LAS DOS TABLAS DE MATERIALES (Composición por Color y Tela, y
--      Habilitación), con clave, descripción, cantidad y costo
--      -> `ficha_materiales`.
--
-- POR QUÉ (b) Y (c) NO VAN EN `orden_etapas.datos`:
--   `datos jsonb` es el lugar correcto para campos sueltos de una
--   etapa. Estas dos son TABLAS: tienen muchas filas por folio y sus
--   importes se suman ($6.46 de habilitación en la ficha de ejemplo).
--   Metidas en jsonb no se podrían sumar sin desenrollar el JSON en
--   cada consulta, y nada impediría guardar una fila sin cantidad.
--   Como tablas reales, los totales son un SUM y la base valida.
--
-- LO QUE SE DERIVA Y NO SE GUARDA:
--   Costo Neto, Margen y los totales de línea son cuentas, no datos.
--   Guardarlos permitiría que quedaran en desacuerdo con sus partes.
--   Se calculan en `vw_ficha_tecnica`.
--   La excepción es `costo_fijo`, que sí se captura.
--
-- PREREQUISITO: script 056 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Los campos simples que faltaban en la orden
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS razon_social         text,
  ADD COLUMN IF NOT EXISTS marca                text,
  ADD COLUMN IF NOT EXISTS compradora           text,
  ADD COLUMN IF NOT EXISTS modelo_cliente       text,
  ADD COLUMN IF NOT EXISTS descripcion_completa text,
  ADD COLUMN IF NOT EXISTS costo_fijo           numeric(12,4),
  ADD COLUMN IF NOT EXISTS fecha_confirmacion   date,
  /** Ruta de la foto de la prenda en Storage. La imagen no va en la base. */
  ADD COLUMN IF NOT EXISTS foto_path            text;

COMMENT ON COLUMN manumoda.ordenes_produccion.costo_fijo IS
  'Costo fijo por pieza, capturado. El Costo Neto NO se guarda: se deriva '
  'sumando costo_fijo + maquila + lavandería + habilitación + tela.';

COMMENT ON COLUMN manumoda.ordenes_produccion.foto_path IS
  'Ruta del archivo en Storage (bucket `fichas`), no la URL: si el bucket '
  'cambia de nombre o de política, la ruta sigue siendo válida.';

COMMENT ON COLUMN manumoda.ordenes_produccion.compradora IS
  'Nombre de quien compra, como aparece en la ficha. Distinto de `cliente`, '
  'que es la empresa.';

-- Un costo negativo es un error de captura, no un costo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_costo_fijo_no_negativo') THEN
    ALTER TABLE manumoda.ordenes_produccion
      ADD CONSTRAINT chk_costo_fijo_no_negativo CHECK (costo_fijo IS NULL OR costo_fijo >= 0);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. ficha_tallas — las dos tablas de tallas
--
--    En la ficha son dos cuadros con la misma forma: un renglón por
--    color y una columna por talla. `bloque` los distingue en vez de
--    duplicar la tabla, porque su estructura es idéntica y así un
--    cambio de tallas aplica a los dos.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'bloque_tallas' AND n.nspname = 'manumoda'
  ) THEN
    CREATE DOMAIN manumoda.bloque_tallas AS text
      CHECK (VALUE IN ('Especificacion', 'Cortadas'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS manumoda.ficha_tallas (
  id         serial PRIMARY KEY,
  idempresa  integer NOT NULL,
  folio      text    NOT NULL,
  /** 'Especificacion' = lo pedido; 'Cortadas' = lo que salió del corte. */
  bloque     manumoda.bloque_tallas NOT NULL,
  color      text    NOT NULL,
  /** El orden en que se captura, para que el PDF respete el de la ficha. */
  orden      integer NOT NULL DEFAULT 1,
  /**
   * Las cantidades por talla: {"CH":100,"M":200,"G":200,"XG":100}.
   *
   * jsonb y no una columna por talla porque las tallas cambian por
   * cliente y por familia: hoy son CH/M/G/XG, mañana 28/30/32/34 o
   * un rango de niño. Con columnas fijas, cada juego nuevo de tallas
   * sería una migración y la tabla acumularía columnas vacías.
   */
  cantidades jsonb   NOT NULL DEFAULT '{}'::jsonb,
  /** Proporción del tendido, como aparece a la derecha en la ficha. */
  proporcion numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ficha_tallas_cantidades CHECK (jsonb_typeof(cantidades) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ficha_tallas_folio_bloque_color
  ON manumoda.ficha_tallas (idempresa, folio, bloque, color);

CREATE INDEX IF NOT EXISTS ix_ficha_tallas_folio
  ON manumoda.ficha_tallas (idempresa, folio);

COMMENT ON TABLE manumoda.ficha_tallas IS
  'Los dos cuadros de tallas de la ficha: lo pedido y lo cortado, un renglón '
  'por color. `bloque` los distingue.';

COMMENT ON COLUMN manumoda.ficha_tallas.cantidades IS
  'Cantidad por talla, ej. {"CH":100,"M":200}. jsonb porque el juego de '
  'tallas cambia por cliente y familia; con columnas fijas cada juego nuevo '
  'sería una migración.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. ficha_materiales — composición de tela y habilitación
--
--    Los dos cuadros de abajo de la ficha tienen las mismas cuatro
--    columnas (clave, descripción, cantidad, costo) y el mismo total
--    por línea. `tipo` los separa.
--
--    `idarticulo` liga al catálogo de Inventarios cuando el material
--    existe ahí, pero es opcional: la ficha se captura antes de que
--    el artículo esté dado de alta, y obligar el vínculo impediría
--    capturar. Cuando está, el costo puede venir del catálogo.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'tipo_material_ficha' AND n.nspname = 'manumoda'
  ) THEN
    CREATE DOMAIN manumoda.tipo_material_ficha AS text
      CHECK (VALUE IN ('Tela', 'Habilitacion'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS manumoda.ficha_materiales (
  id          serial PRIMARY KEY,
  idempresa   integer NOT NULL,
  folio       text    NOT NULL,
  tipo        manumoda.tipo_material_ficha NOT NULL,
  orden       integer NOT NULL DEFAULT 1,
  clave       text,
  descripcion text    NOT NULL,
  /** Color al que aplica, en el cuadro de composición por color y tela. */
  color       text,
  cantidad    numeric(12,4) NOT NULL DEFAULT 0,
  costo       numeric(12,4) NOT NULL DEFAULT 0,
  /** Vínculo opcional al catálogo de Inventarios (script 054). */
  idarticulo  integer REFERENCES manumoda.articulos(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ficha_mat_cantidad CHECK (cantidad >= 0),
  CONSTRAINT chk_ficha_mat_costo    CHECK (costo >= 0)
);

CREATE INDEX IF NOT EXISTS ix_ficha_materiales_folio
  ON manumoda.ficha_materiales (idempresa, folio);

CREATE INDEX IF NOT EXISTS ix_ficha_materiales_articulo
  ON manumoda.ficha_materiales (idarticulo);

COMMENT ON TABLE manumoda.ficha_materiales IS
  'Composición por color y tela, y habilitación. El total por línea NO se '
  'guarda: es cantidad × costo, y guardarlo permitiría que discrepara.';

COMMENT ON COLUMN manumoda.ficha_materiales.idarticulo IS
  'Vínculo opcional al catálogo de Inventarios. Opcional a propósito: la '
  'ficha se captura antes de que el artículo exista, y exigirlo impediría '
  'capturar.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. vw_ficha_tecnica — la ficha completa, con las cuentas hechas
--
--    Costo Neto y Margen se derivan aquí. No se guardan en ninguna
--    tabla: son el resultado de sumar sus partes, y una copia
--    almacenada es una copia que puede quedar desactualizada.
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
    -- Piezas: lo pedido y lo cortado salen de los cuadros de tallas, que es
    -- donde se capturan. `o.piezas` se conserva aparte porque viene del
    -- Excel y puede no coincidir; verlos juntos delata la diferencia.
    o.piezas                          AS piezas_orden,
    COALESCE(te.piezas, 0)            AS piezas_totales,
    COALESCE(tc.piezas, 0)            AS piezas_cortadas_ficha,
    o.piezas_cortadas,
    -- Materiales
    COALESCE(mt.importe, 0)           AS costo_tela,
    COALESCE(mh.importe, 0)           AS costo_habilitacion,
    -- Costos unitarios capturados
    o.costo_fijo,
    o.costo_maquila,
    o.costo_lavanderia,
    -- Costo Neto = todo lo que cuesta una pieza. Derivado, no guardado.
    ROUND(
      COALESCE(o.costo_fijo, 0) + COALESCE(o.costo_maquila, 0)
      + COALESCE(o.costo_lavanderia, 0)
      + COALESCE(mt.importe, 0) + COALESCE(mh.importe, 0)
    , 2)                              AS costo_neto,
    o.precio_venta,
    o.precio_publico,
    -- Margen %: cuánto del precio de venta no se fue en costo.
    -- Se protege la división: un precio de venta en 0 o nulo daría error.
    CASE WHEN COALESCE(o.precio_venta, 0) > 0 THEN
      ROUND(100.0 * (o.precio_venta - (
        COALESCE(o.costo_fijo, 0) + COALESCE(o.costo_maquila, 0)
        + COALESCE(o.costo_lavanderia, 0)
        + COALESCE(mt.importe, 0) + COALESCE(mh.importe, 0)
      )) / o.precio_venta, 2)
    END                               AS margen_pct
FROM manumoda.ordenes_produccion o
-- LATERAL y no JOIN: con tres JOIN directos a las tablas hijas, cada una
-- multiplicaría las filas de las otras y los importes saldrían inflados.
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
  'La ficha técnica completa. Costo Neto y Margen se derivan aquí; no se '
  'guardan en ninguna tabla para que no puedan discrepar de sus partes.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las columnas nuevas existen. Esperado: 8 filas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ordenes_produccion'
  AND column_name IN ('razon_social','marca','compradora','modelo_cliente',
                      'descripcion_completa','costo_fijo','fecha_confirmacion','foto_path')
ORDER BY column_name;

-- 2. La vista responde para las 615 órdenes.
SELECT COUNT(*) AS fichas FROM manumoda.vw_ficha_tecnica WHERE idempresa = 1;

-- 3. El margen nunca puede pasar de 100% ni la división romper.
--    0 filas.
SELECT folio, precio_venta, costo_neto, margen_pct
FROM manumoda.vw_ficha_tecnica
WHERE idempresa = 1 AND margen_pct > 100;

-- 4. Prueba con los números de una ficha real (modelo 2058).
--
--    CONFIRMADO contra el sistema anterior: las tres cuentas dan exacto.
--      tela        1.61 m × $40.00                      = $ 64.40
--      Costo Neto  9.50 (fijo) + 64.40 (tela) + 7.25    = $ 81.15
--      Margen      (121.00 − 81.15) / 121.00 × 100      =   32.93
--
--    La fórmula del margen es sobre PRECIO DE VENTA. Una ficha anterior
--    (modelo 696) imprimía 90.77 donde la fórmula da 77.20: ese registro
--    tenía el dato mal, no era otra fórmula.
SELECT
  ROUND(9.50 + 64.40 + 7.25, 2)                  AS costo_neto_calculado,
  81.15                                          AS costo_neto_ficha,
  ROUND(100.0 * (121.00 - 81.15) / 121.00, 2)    AS margen_calculado,
  32.93                                          AS margen_en_ficha;

-- 5. Nadie debe tener tallas capturadas todavía. Esperado: 0.
SELECT COUNT(*) AS tallas, (SELECT COUNT(*) FROM manumoda.ficha_materiales) AS materiales
FROM manumoda.ficha_tallas;

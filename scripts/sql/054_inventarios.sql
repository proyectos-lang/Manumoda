-- ============================================================
-- Módulo de Inventarios: habilitaciones y telas
--
-- QUÉ MODELA:
--   · Artículos de dos tipos: habilitaciones (insumos) y telas.
--   · Ingresos por orden de compra: varios artículos en un mismo
--     documento, cada uno con el precio al que se adquirió.
--   · Para telas: una recepción se reparte en ROLLOS, cada uno con
--     su identificador único y su saldo de metros.
--   · Salidas que descuentan, ligadas al folio de producción.
--
-- DECISIONES DE MODELO:
--
--   El saldo NO se guarda: se deriva de los movimientos. Un total
--   almacenado se desincroniza en cuanto alguien corrige un ingreso
--   o borra una salida, y nadie se entera hasta el inventario
--   físico. Con vistas, el número siempre cuadra con su historia.
--
--   El costo unitario del artículo es una REFERENCIA; el que manda
--   para valorizar es el de cada ingreso (`costo_unitario` en el
--   detalle), porque el precio cambia entre compras. Mismo criterio
--   que `costo_maquila_aplicado` en maquila_pagos.
--
--   Los rollos llevan saldo parcial: entra uno de 25 m y se le van
--   descontando 8, 12… hasta agotarse. Es como se comporta una tela
--   real, y permite saber cuánto queda en cada rollo.
--
--   `codigo_qr` NO guarda una imagen: guarda el texto que la etiqueta
--   codifica. La imagen se dibuja en el navegador al imprimir, así
--   que no hay binarios que respaldar ni que migrar.
--
-- PREREQUISITO: ninguno.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Proveedores
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.proveedores (
  id          serial PRIMARY KEY,
  idempresa   integer NOT NULL,
  nombre      text    NOT NULL,
  contacto    text,
  telefono    text,
  notas       text,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedores_empresa_nombre
  ON manumoda.proveedores (idempresa, upper(trim(nombre)));

COMMENT ON TABLE manumoda.proveedores IS
  'A quién se le compran insumos y telas. Catálogo propio para que el mismo '
  'proveedor no se escriba de tres formas distintas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Artículos
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_articulo') THEN
    CREATE DOMAIN manumoda.tipo_articulo AS text
      CHECK (VALUE IN ('Habilitación', 'Tela'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS manumoda.articulos (
  id              serial PRIMARY KEY,
  idempresa       integer NOT NULL,
  tipo            manumoda.tipo_articulo NOT NULL,
  clave           text    NOT NULL,
  nombre          text    NOT NULL,
  unidad_medida   text    NOT NULL,
  -- Referencia para cotizar. El que valoriza es el de cada ingreso.
  costo_unitario  numeric(12,4),
  idproveedor     integer REFERENCES manumoda.proveedores(id),
  /** Bajo este saldo la vista marca el artículo en alerta. */
  stock_minimo    numeric(12,3),
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_articulo_costo CHECK (costo_unitario IS NULL OR costo_unitario >= 0),
  CONSTRAINT chk_articulo_minimo CHECK (stock_minimo IS NULL OR stock_minimo >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_articulos_empresa_clave
  ON manumoda.articulos (idempresa, upper(trim(clave)));

CREATE INDEX IF NOT EXISTS ix_articulos_empresa_tipo
  ON manumoda.articulos (idempresa, tipo);

COMMENT ON COLUMN manumoda.articulos.costo_unitario IS
  'Costo de referencia. El que valoriza el inventario es el de cada ingreso, '
  'porque el precio cambia entre compras.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Ingresos (órdenes de compra)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.inventario_ingresos (
  id            serial PRIMARY KEY,
  idempresa     integer NOT NULL,
  folio_compra  text,
  fecha         date    NOT NULL DEFAULT CURRENT_DATE,
  idproveedor   integer REFERENCES manumoda.proveedores(id),
  comentarios   text,
  capturado_por text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ingresos_empresa_fecha
  ON manumoda.inventario_ingresos (idempresa, fecha DESC);

CREATE TABLE IF NOT EXISTS manumoda.inventario_ingreso_detalle (
  id             serial PRIMARY KEY,
  idempresa      integer NOT NULL,
  idingreso      integer NOT NULL REFERENCES manumoda.inventario_ingresos(id) ON DELETE CASCADE,
  idarticulo     integer NOT NULL REFERENCES manumoda.articulos(id),
  cantidad       numeric(12,3) NOT NULL,
  -- El precio de ESTA compra. Congela lo que se pagó aquel día.
  costo_unitario numeric(12,4) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ingreso_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_ingreso_costo CHECK (costo_unitario >= 0)
);

CREATE INDEX IF NOT EXISTS ix_ingreso_detalle_articulo
  ON manumoda.inventario_ingreso_detalle (idempresa, idarticulo);

COMMENT ON COLUMN manumoda.inventario_ingreso_detalle.costo_unitario IS
  'Precio al que se adquirió en esta compra. No se recalcula: es el hecho.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Rollos de tela
--
--    Un renglón de ingreso de tela se reparte en rollos. Cada uno lleva su
--    identificador y su saldo, que sale de restarle sus salidas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.tela_rollos (
  id            serial PRIMARY KEY,
  idempresa     integer NOT NULL,
  idarticulo    integer NOT NULL REFERENCES manumoda.articulos(id),
  iddetalle     integer REFERENCES manumoda.inventario_ingreso_detalle(id) ON DELETE SET NULL,
  -- Lo que va impreso en la etiqueta y codifica el QR
  codigo        text    NOT NULL,
  metros_inicial numeric(12,3) NOT NULL,
  ubicacion     text,
  comentarios   text,
  capturado_por text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_rollo_metros CHECK (metros_inicial > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rollos_empresa_codigo
  ON manumoda.tela_rollos (idempresa, codigo);

CREATE INDEX IF NOT EXISTS ix_rollos_empresa_articulo
  ON manumoda.tela_rollos (idempresa, idarticulo);

COMMENT ON TABLE manumoda.tela_rollos IS
  'Cada rollo físico, con su código único. El QR de la etiqueta codifica ese '
  'código; la imagen se dibuja al imprimir, no se guarda.';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Salidas
--
--    Descuentan del inventario. Para telas apuntan al rollo; para
--    habilitaciones, al artículo. Se ligan al folio de producción para poder
--    costear el consumo de cada pedido.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.inventario_salidas (
  id            serial PRIMARY KEY,
  idempresa     integer NOT NULL,
  idarticulo    integer NOT NULL REFERENCES manumoda.articulos(id),
  -- Solo para telas. NULL en habilitaciones.
  idrollo       integer REFERENCES manumoda.tela_rollos(id),
  folio         text,
  fecha         date    NOT NULL DEFAULT CURRENT_DATE,
  cantidad      numeric(12,3) NOT NULL,
  motivo        text,
  capturado_por text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_salida_cantidad CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS ix_salidas_empresa_articulo
  ON manumoda.inventario_salidas (idempresa, idarticulo);

CREATE INDEX IF NOT EXISTS ix_salidas_rollo
  ON manumoda.inventario_salidas (idrollo);

CREATE INDEX IF NOT EXISTS ix_salidas_folio
  ON manumoda.inventario_salidas (idempresa, folio);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Una salida no puede dejar un rollo en negativo
--
--    Se valida en la base y no solo en la interfaz: sin RLS, un guardarraíl
--    de UI es una sugerencia. Un rollo con saldo negativo es un inventario
--    que ya no significa nada.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_validar_salida_rollo()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_inicial numeric;
  v_usado   numeric;
BEGIN
  IF NEW.idrollo IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT metros_inicial INTO v_inicial
  FROM manumoda.tela_rollos
  WHERE id = NEW.idrollo;

  SELECT COALESCE(SUM(cantidad), 0) INTO v_usado
  FROM manumoda.inventario_salidas
  WHERE idrollo = NEW.idrollo
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF v_usado + NEW.cantidad > v_inicial + 0.0005 THEN
    RAISE EXCEPTION
      'El rollo solo tiene % m disponibles y se intentan descontar %.',
      ROUND(v_inicial - v_usado, 3), NEW.cantidad
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_salida_rollo ON manumoda.inventario_salidas;
CREATE TRIGGER trg_validar_salida_rollo
  BEFORE INSERT OR UPDATE ON manumoda.inventario_salidas
  FOR EACH ROW EXECUTE FUNCTION manumoda.fn_validar_salida_rollo();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Vistas — el saldo se deriva, nunca se guarda
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_inventario_rollos;
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
    p.nombre                        AS proveedor,
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
  'Existencia por artículo, derivada de ingresos menos salidas. El saldo no '
  'se guarda en ninguna columna: siempre cuadra con su historia.';

CREATE VIEW manumoda.vw_inventario_rollos AS
SELECT
    tr.id,
    tr.idempresa,
    tr.idarticulo,
    a.clave                         AS articulo_clave,
    a.nombre                        AS articulo_nombre,
    a.unidad_medida,
    p.nombre                        AS proveedor,
    tr.codigo,
    tr.metros_inicial,
    COALESCE(s.usado, 0)            AS metros_usados,
    tr.metros_inicial - COALESCE(s.usado, 0) AS metros_disponibles,
    (tr.metros_inicial - COALESCE(s.usado, 0) <= 0.0005) AS agotado,
    tr.ubicacion,
    tr.comentarios,
    tr.created_at,
    d.costo_unitario                AS costo_compra,
    i.fecha                         AS fecha_ingreso,
    i.folio_compra,
    s.salidas,
    s.folios
FROM manumoda.tela_rollos tr
JOIN manumoda.articulos a
  ON a.id = tr.idarticulo
LEFT JOIN manumoda.inventario_ingreso_detalle d
  ON d.id = tr.iddetalle
LEFT JOIN manumoda.inventario_ingresos i
  ON i.id = d.idingreso
LEFT JOIN manumoda.proveedores p
  ON p.id = a.idproveedor
LEFT JOIN LATERAL (
    SELECT SUM(cantidad) AS usado,
           COUNT(*)      AS salidas,
           string_agg(DISTINCT folio, ', ' ORDER BY folio) AS folios
    FROM manumoda.inventario_salidas
    WHERE idrollo = tr.id
) s ON true;

COMMENT ON VIEW manumoda.vw_inventario_rollos IS
  'Cada rollo con sus metros disponibles y en qué folios se consumió.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las tablas y vistas deben existir. Esperado: 6 tablas, 2 vistas.
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'manumoda'
  AND table_name IN ('proveedores', 'articulos', 'inventario_ingresos',
                     'inventario_ingreso_detalle', 'tela_rollos',
                     'inventario_salidas', 'vw_inventario_articulos',
                     'vw_inventario_rollos')
ORDER BY table_type, table_name;

-- 2. La existencia debe cuadrar con ingresos menos salidas. 0 filas.
SELECT clave, total_ingresado, total_salidas, existencia
FROM manumoda.vw_inventario_articulos
WHERE idempresa = 1
  AND abs(existencia - (total_ingresado - total_salidas)) > 0.0005;

-- 3. Ningún rollo puede quedar en negativo. 0 filas.
SELECT codigo, metros_inicial, metros_usados, metros_disponibles
FROM manumoda.vw_inventario_rollos
WHERE idempresa = 1 AND metros_disponibles < -0.0005;

-- 4. Códigos de rollo únicos. 0 filas.
SELECT codigo, COUNT(*)
FROM manumoda.tela_rollos
WHERE idempresa = 1
GROUP BY codigo
HAVING COUNT(*) > 1;

-- 5. Estado inicial: todo en cero, porque aún no hay movimientos.
SELECT
  (SELECT COUNT(*) FROM manumoda.articulos   WHERE idempresa = 1) AS articulos,
  (SELECT COUNT(*) FROM manumoda.proveedores WHERE idempresa = 1) AS proveedores,
  (SELECT COUNT(*) FROM manumoda.tela_rollos WHERE idempresa = 1) AS rollos;

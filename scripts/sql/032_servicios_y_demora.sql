-- ============================================================
-- Servicios externos, demora de entrega y nueva fórmula de pago
--
-- Observaciones de operación sobre el módulo de Pago Maquilas.
--
-- 1. FÓRMULA. El valor a pagar pasa a ser:
--
--      precio final      = piezas recibidas × costo unitario
--      − pzs no entregadas × precio de venta
--      − demora            = precio final × 1.5% por semana de atraso
--
--    Las semanas se cuentan desde la fecha de entrega
--    (fecha_cancelacion) hasta la última recepción; si todavía no
--    llega nada, siguen corriendo hasta hoy. Sin tope, por
--    decisión del cliente: 23 semanas de atraso —el máximo que
--    hay hoy— descuentan 34.5%.
--
-- 2. SERVICIOS. Lavandería deja de ser un caso especial. Los
--    cinco servicios externos —Lavandería, Estampado, Bordado,
--    Corte Externo y Otro— comparten dos tablas genéricas en vez
--    de replicar cinco veces columnas y tablas propias.
--
--    Se migran los datos de lavandería y se eliminan sus tablas y
--    columnas: mantener las dos formas sería tener dos fuentes de
--    verdad para el mismo dinero. Están vacías (0 pagos, 0
--    unidades), así que la migración no arrastra nada.
--
-- 3. PIEZAS CORTADAS. Se expone la suma de corte_programacion
--    como referencia de lo que se le entregó al maquilero.
--
-- PREREQUISITO: scripts 027 a 031 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Retirar las vistas ANTES de tocar sus dependencias
--
--    vw_pago_maquilas y vw_historial_pagos leen lavanderia_pagos y las
--    columnas piezas_lavanderia*. Postgres no deja borrar nada de eso
--    mientras las vistas existan, y usar CASCADE borraría las vistas sin
--    avisar. Se retiran aquí y se recrean al final del script.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;
DROP VIEW IF EXISTS manumoda.vw_historial_pagos;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Costos de los servicios externos que faltaban del Excel
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS costo_estampado     numeric(12,4),
  ADD COLUMN IF NOT EXISTS costo_bordado       numeric(12,4),
  ADD COLUMN IF NOT EXISTS costo_corte_externo numeric(12,4),
  ADD COLUMN IF NOT EXISTS costo_otro          numeric(12,4);

COMMENT ON COLUMN manumoda.ordenes_produccion.costo_estampado IS
  'Costo de estampado POR PIEZA (columna Costo Estampado del Excel).';
COMMENT ON COLUMN manumoda.ordenes_produccion.costo_bordado IS
  'Costo de bordado POR PIEZA (columna Costo Bordado del Excel).';
COMMENT ON COLUMN manumoda.ordenes_produccion.costo_corte_externo IS
  'Costo de corte externo POR PIEZA (columna Costo Corte Externo del Excel).';
COMMENT ON COLUMN manumoda.ordenes_produccion.costo_otro IS
  'Otro costo de servicio POR PIEZA (columna Costo Otro del Excel).';

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_costos_servicios;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_costos_servicios
  CHECK (
        COALESCE(costo_estampado,     0) >= 0
    AND COALESCE(costo_bordado,       0) >= 0
    AND COALESCE(costo_corte_externo, 0) >= 0
    AND COALESCE(costo_otro,          0) >= 0
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Tablas genéricas de servicios
-- ════════════════════════════════════════════════════════════════════════════

-- Los cinco nombres válidos viven en un dominio para que un typo no cree
-- un sexto servicio fantasma con su propio saldo.
--
-- Se crea solo si falta. NO usar `DROP DOMAIN ... CASCADE`: al re-ejecutar
-- el script con las tablas ya creadas, el CASCADE arrastraría sus columnas
-- `servicio` y con ellas los datos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'servicio_externo' AND n.nspname = 'manumoda'
  ) THEN
    CREATE DOMAIN manumoda.servicio_externo AS text
      CHECK (VALUE IN ('Lavandería', 'Estampado', 'Bordado', 'Corte Externo', 'Otro'));
  END IF;
END
$$;

COMMENT ON DOMAIN manumoda.servicio_externo IS
  'Servicios externos que se pagan por pieza, cada uno con su costo en '
  'ordenes_produccion y su propio saldo.';

CREATE TABLE IF NOT EXISTS manumoda.servicio_unidades (
    id               bigserial PRIMARY KEY,
    idempresa        integer   NOT NULL DEFAULT 1,
    folio            text      NOT NULL,
    servicio         manumoda.servicio_externo NOT NULL,
    piezas_enviadas  integer,
    piezas_recibidas integer,
    capturado_por    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_servicio_unidades UNIQUE (idempresa, folio, servicio),
    CONSTRAINT chk_servicio_unidades_piezas CHECK (
          COALESCE(piezas_enviadas,  0) >= 0
      AND COALESCE(piezas_recibidas, 0) >= 0
    ),
    CONSTRAINT fk_servicio_unidades_orden
      FOREIGN KEY (idempresa, folio)
      REFERENCES manumoda.ordenes_produccion (idempresa, folio)
      ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE manumoda.servicio_unidades IS
  'Piezas enviadas y devueltas por cada servicio externo, una fila por '
  'folio y servicio. Se le paga al proveedor por las recibidas.';

CREATE TABLE IF NOT EXISTS manumoda.servicio_pagos (
    id            bigserial     PRIMARY KEY,
    idempresa     integer       NOT NULL DEFAULT 1,
    folio         text          NOT NULL,
    servicio      manumoda.servicio_externo NOT NULL,
    fecha         date          NOT NULL DEFAULT CURRENT_DATE,
    monto         numeric(12,2) NOT NULL,
    referencia    text,
    es_adelanto   boolean       NOT NULL DEFAULT false,
    comentarios   text,
    capturado_por text,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_servicio_pago_monto CHECK (monto > 0),
    CONSTRAINT fk_servicio_pago_orden
      FOREIGN KEY (idempresa, folio)
      REFERENCES manumoda.ordenes_produccion (idempresa, folio)
      ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE manumoda.servicio_pagos IS
  'Abonos a los proveedores de servicios externos. Admite pagos parciales '
  'y adelantos, igual que los pagos al maquilero.';

CREATE INDEX IF NOT EXISTS idx_servicio_unidades_folio
  ON manumoda.servicio_unidades (idempresa, folio);
CREATE INDEX IF NOT EXISTS idx_servicio_pagos_folio
  ON manumoda.servicio_pagos (idempresa, folio, servicio);

CREATE UNIQUE INDEX IF NOT EXISTS uq_servicio_pagos_referencia
  ON manumoda.servicio_pagos (idempresa, referencia)
  WHERE referencia IS NOT NULL AND btrim(referencia) <> '';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Migrar lavandería al modelo genérico y retirar lo viejo
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'manumoda'
      AND table_name = 'ordenes_produccion'
      AND column_name = 'piezas_lavanderia'
  ) THEN
    INSERT INTO manumoda.servicio_unidades
      (idempresa, folio, servicio, piezas_enviadas, piezas_recibidas)
    SELECT idempresa, folio, 'Lavandería', piezas_lavanderia, piezas_lavanderia_recibidas
    FROM manumoda.ordenes_produccion
    WHERE piezas_lavanderia IS NOT NULL OR piezas_lavanderia_recibidas IS NOT NULL
    ON CONFLICT (idempresa, folio, servicio) DO NOTHING;
  END IF;
END
$$;

-- Envuelto en un DO: al re-ejecutar el script la tabla vieja ya no existe
-- y un INSERT ... FROM directo fallaría con "relation does not exist".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'manumoda' AND tablename = 'lavanderia_pagos'
  ) THEN
    INSERT INTO manumoda.servicio_pagos
      (idempresa, folio, servicio, fecha, monto, referencia, es_adelanto,
       comentarios, capturado_por, created_at)
    SELECT idempresa, folio, 'Lavandería', fecha, monto, referencia, es_adelanto,
           comentarios, capturado_por, created_at
    FROM manumoda.lavanderia_pagos;

    DROP TABLE manumoda.lavanderia_pagos;
  END IF;
END
$$;

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_piezas_lavanderia,
  DROP CONSTRAINT IF EXISTS chk_op_piezas_lav_recibidas;

ALTER TABLE manumoda.ordenes_produccion
  DROP COLUMN IF EXISTS piezas_lavanderia,
  DROP COLUMN IF EXISTS piezas_lavanderia_recibidas,
  DROP COLUMN IF EXISTS fecha_pago_lavanderia;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. La regla de demora, en un solo lugar
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_semanas_demora(
    p_fecha_entrega   date,
    p_ultima_recepcion date
)
RETURNS integer
LANGUAGE sql
-- STABLE, no IMMUTABLE: sin recepción la cuenta corre hasta CURRENT_DATE
STABLE
AS $$
    SELECT CASE
        WHEN p_fecha_entrega IS NULL THEN 0
        ELSE GREATEST(
               0,
               (COALESCE(p_ultima_recepcion, CURRENT_DATE) - p_fecha_entrega) / 7
             )
    END;
$$;

COMMENT ON FUNCTION manumoda.fn_semanas_demora(date, date) IS
  'Semanas completas de atraso entre la fecha de entrega comprometida y la '
  'última recepción. Si aún no se ha recibido nada, cuenta hasta hoy. '
  'Cada semana descuenta 1.5% del precio final, sin tope.';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. vw_pago_maquilas — nueva fórmula (se retiró en la sección 0)
-- ════════════════════════════════════════════════════════════════════════════

CREATE VIEW manumoda.vw_pago_maquilas AS
WITH base AS (
    SELECT
        o.id,
        o.idempresa,
        o.folio,
        o.modelo,
        o.familia,
        o.cliente,
        o.maquilero            AS maquilero_nombre,
        o.idmaquilero,
        m.nombre               AS maquilero_catalogo,
        o.fase_actual,
        o.fecha_cancelacion,
        o.fecha_facturacion,
        o.piezas               AS piezas_orden,
        COALESCE(c.piezas, 0)  AS piezas_cortadas,
        o.costo_maquila,
        o.precio_venta,
        o.precio_publico,
        -- Costos de servicios: informativos aquí, el saldo vive en
        -- vw_servicios_pago. Se exponen para no tener que cruzar dos
        -- consultas solo para mostrar una columna de referencia.
        o.costo_lavanderia,
        o.costo_estampado,
        o.costo_bordado,
        o.costo_corte_externo,
        o.costo_otro,
        COALESCE(r.piezas, 0)    AS piezas_recibidas,
        r.ultima                 AS ultima_recepcion,
        COALESCE(p.piezas, 0)    AS piezas_no_entregadas,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        -- Precio final: lo que devolvió, a su costo unitario
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS precio_final,
        ROUND(COALESCE(p.piezas, 0) * COALESCE(o.precio_venta, 0), 2)  AS valor_no_entregadas,
        manumoda.fn_semanas_demora(o.fecha_cancelacion, r.ultima)      AS semanas_demora
    FROM manumoda.ordenes_produccion o
    LEFT JOIN manumoda.maquileros m
      ON m.id = o.idmaquilero
    LEFT JOIN LATERAL (
        SELECT SUM(piezas_cortadas) AS piezas
        FROM manumoda.corte_programacion
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) c ON true
    LEFT JOIN LATERAL (
        SELECT SUM(piezas) AS piezas, MAX(fecha) AS ultima
        FROM manumoda.maquila_recepciones
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) r ON true
    LEFT JOIN LATERAL (
        SELECT SUM(piezas) AS piezas
        FROM manumoda.maquila_penalizaciones
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) p ON true
    LEFT JOIN LATERAL (
        SELECT SUM(monto) AS monto,
               SUM(monto) FILTER (WHERE es_adelanto) AS adelantos,
               MAX(fecha) AS ultima
        FROM manumoda.maquila_pagos
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) g ON true
),
calculado AS (
    SELECT
        b.*,
        -- 1.5% del precio final por cada semana completa de atraso
        ROUND(b.precio_final * b.semanas_demora * 0.015, 2) AS valor_demora
    FROM base b
)
SELECT
    c.*,
    COALESCE(c.maquilero_catalogo, c.maquilero_nombre) AS beneficiario,
    (c.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (c.piezas_no_entregadas > c.piezas_recibidas)      AS no_entregadas_exceden_recibidas,
    (c.semanas_demora * 1.5)                           AS demora_pct,
    (c.precio_final - c.valor_no_entregadas - c.valor_demora) AS valor_a_pagar,
    (c.precio_final - c.valor_no_entregadas - c.valor_demora - c.valor_pagado) AS saldo,
    CASE
        WHEN c.valor_pagado > 0 AND c.piezas_recibidas = 0               THEN 'Anticipo'
        WHEN c.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN c.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (c.precio_final - c.valor_no_entregadas - c.valor_demora - c.valor_pagado)
             < -0.005                                                    THEN 'Sobrepagado'
        WHEN abs(c.precio_final - c.valor_no_entregadas - c.valor_demora - c.valor_pagado)
             < 0.005                                                     THEN 'Saldado'
        WHEN c.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago
FROM calculado c;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Cuenta por pagar al maquilero, una fila por folio. '
  'valor_a_pagar = precio_final − no entregadas × precio_venta − demora, '
  'donde precio_final = piezas recibidas × costo_maquila y la demora es '
  '1.5% del precio final por semana de atraso sobre la fecha de entrega.';

-- ════════════════════════════════════════════════════════════════════════════
-- 6. vw_servicios_pago — una fila por folio y servicio
--
--    El CROSS JOIN LATERAL sobre un VALUES convierte las cinco
--    columnas de costo en cinco filas, para no repetir el mismo
--    bloque de cálculo cinco veces.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_servicios_pago AS
SELECT
    o.idempresa,
    o.folio,
    o.modelo,
    o.familia,
    o.cliente,
    o.maquilero              AS maquilero_nombre,
    o.piezas                 AS piezas_orden,
    s.servicio,
    s.costo_unitario,
    COALESCE(u.piezas_enviadas,  0) AS piezas_enviadas,
    COALESCE(u.piezas_recibidas, 0) AS piezas_recibidas,
    COALESCE(u.piezas_enviadas, 0) - COALESCE(u.piezas_recibidas, 0) AS merma,
    ROUND(COALESCE(u.piezas_recibidas, 0) * COALESCE(s.costo_unitario, 0), 2) AS valor,
    COALESCE(g.monto, 0)     AS pagado,
    COALESCE(g.adelantos, 0) AS adelantos,
    g.ultima                 AS ultimo_pago,
    ROUND(COALESCE(u.piezas_recibidas, 0) * COALESCE(s.costo_unitario, 0), 2)
      - COALESCE(g.monto, 0) AS saldo,
    CASE
        WHEN COALESCE(g.monto, 0) > 0
             AND COALESCE(u.piezas_recibidas, 0) = 0                     THEN 'Anticipo'
        WHEN s.costo_unitario IS NULL                                    THEN 'Sin valor'
        WHEN COALESCE(u.piezas_recibidas, 0) = 0                         THEN 'Sin recepción'
        WHEN (ROUND(COALESCE(u.piezas_recibidas,0) * COALESCE(s.costo_unitario,0), 2)
              - COALESCE(g.monto, 0)) < -0.005                           THEN 'Sobrepagado'
        WHEN abs(ROUND(COALESCE(u.piezas_recibidas,0) * COALESCE(s.costo_unitario,0), 2)
              - COALESCE(g.monto, 0)) < 0.005                            THEN 'Saldado'
        WHEN COALESCE(g.monto, 0) > 0                                    THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado
FROM manumoda.ordenes_produccion o
CROSS JOIN LATERAL (VALUES
    ('Lavandería',    o.costo_lavanderia),
    ('Estampado',     o.costo_estampado),
    ('Bordado',       o.costo_bordado),
    ('Corte Externo', o.costo_corte_externo),
    ('Otro',          o.costo_otro)
) AS s(servicio, costo_unitario)
LEFT JOIN manumoda.servicio_unidades u
  ON u.idempresa = o.idempresa AND u.folio = o.folio AND u.servicio = s.servicio
LEFT JOIN LATERAL (
    SELECT SUM(monto) AS monto,
           SUM(monto) FILTER (WHERE es_adelanto) AS adelantos,
           MAX(fecha) AS ultima
    FROM manumoda.servicio_pagos
    WHERE folio = o.folio AND idempresa = o.idempresa AND servicio = s.servicio
) g ON true
-- Solo servicios con costo capturado o con movimiento: si no, cada folio
-- devolvería cinco filas vacías y la pantalla sería ruido.
WHERE s.costo_unitario IS NOT NULL
   OR u.id IS NOT NULL
   OR g.monto IS NOT NULL;

COMMENT ON VIEW manumoda.vw_servicios_pago IS
  'Cuentas por pagar de los servicios externos, una fila por folio y '
  'servicio. Se paga por las piezas recibidas × su costo unitario.';

-- ════════════════════════════════════════════════════════════════════════════
-- 7. vw_historial_pagos — incluye los servicios
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_historial_pagos AS
SELECT
    ('M-' || g.id::text)             AS clave,
    'Maquila'::text                  AS tipo,
    g.idempresa, g.folio, g.fecha, g.monto, g.es_adelanto,
    g.referencia, g.comentarios, g.capturado_por, g.created_at,
    o.modelo, o.cliente,
    COALESCE(mq.nombre, o.maquilero) AS beneficiario
FROM manumoda.maquila_pagos g
JOIN manumoda.ordenes_produccion o
  ON o.folio = g.folio AND o.idempresa = g.idempresa
LEFT JOIN manumoda.maquileros mq
  ON mq.id = o.idmaquilero

UNION ALL

SELECT
    ('S-' || sp.id::text)            AS clave,
    sp.servicio::text                AS tipo,
    sp.idempresa, sp.folio, sp.fecha, sp.monto, sp.es_adelanto,
    sp.referencia, sp.comentarios, sp.capturado_por, sp.created_at,
    o.modelo, o.cliente,
    sp.servicio::text                AS beneficiario
FROM manumoda.servicio_pagos sp
JOIN manumoda.ordenes_produccion o
  ON o.folio = sp.folio AND o.idempresa = sp.idempresa;

COMMENT ON VIEW manumoda.vw_historial_pagos IS
  'Todos los pagos —maquila y servicios externos— en una sola línea de '
  'tiempo, con su beneficiario y si fueron adelantos.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio en el libro mayor: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Impacto de la demora sobre los folios con maquilero.
--    Muestra cuánto descuenta el atraso acumulado hoy.
SELECT
  COUNT(*) FILTER (WHERE semanas_demora > 0)  AS folios_con_demora,
  MAX(semanas_demora)                          AS max_semanas,
  ROUND(MAX(demora_pct), 1)                    AS max_descuento_pct
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 3. Cobertura de los costos de servicios recién importados.
--    Estarán en 0 hasta la próxima carga del Excel.
SELECT servicio, COUNT(*) AS folios, COUNT(costo_unitario) AS con_costo
FROM manumoda.vw_servicios_pago
WHERE idempresa = 1
GROUP BY servicio
ORDER BY 2 DESC;

-- 4. Lavandería migrada: la tabla vieja ya no existe.
SELECT COUNT(*) AS unidades_lavanderia
FROM manumoda.servicio_unidades
WHERE servicio = 'Lavandería';

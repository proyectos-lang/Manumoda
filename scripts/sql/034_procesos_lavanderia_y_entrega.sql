-- ============================================================
-- Proceso de lavandería, hoja de costos y fecha de entrega del
-- maquilero desde el Excel
--
-- 1. PROCESO DE LAVANDERÍA. Cada folio que pasa por lavandería
--    lleva un tipo de lavado: Blinch, Acid wash, Stone, Stone
--    medio o Stone alto. Se guarda en `servicio_unidades`, junto
--    a las piezas, porque es un atributo de ese envío concreto.
--
-- 2. ENTREGA DEL MAQUILERO. La demora dejaba de contar en la
--    última recepción capturada a mano. Ahora la referencia es
--    `fecha_s5`, que el Excel trae en FECHA_STATUS5 y representa
--    la entrega del maquilero.
--
--    El uploader solo la escribe cuando está vacía: 101 de 179
--    órdenes ya tienen esa fecha capturada desde Seguimiento de
--    Maquila, donde además determina la fase del pedido, y
--    pisarlas movería fases que alguien registró a mano.
--
-- 3. HOJA DE COSTOS. La vista de servicios expone las piezas
--    cortadas y el proceso, para poder armar el costo total por
--    proceso de cada orden.
--
-- PREREQUISITO: scripts 027 a 033 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Tipo de proceso de lavandería
-- ════════════════════════════════════════════════════════════════════════════

-- Dominio, no texto libre: son cinco procesos con precio distinto y un typo
-- crearía un sexto que nadie cotizó.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'proceso_lavanderia' AND n.nspname = 'manumoda'
  ) THEN
    CREATE DOMAIN manumoda.proceso_lavanderia AS text
      CHECK (VALUE IN ('Blinch', 'Acid wash', 'Stone', 'Stone medio', 'Stone alto'));
  END IF;
END
$$;

COMMENT ON DOMAIN manumoda.proceso_lavanderia IS
  'Tipos de lavado que ofrece la lavandería. Solo aplica al servicio '
  'Lavandería; los demás servicios dejan el campo en NULL.';

ALTER TABLE manumoda.servicio_unidades
  ADD COLUMN IF NOT EXISTS proceso manumoda.proceso_lavanderia;

COMMENT ON COLUMN manumoda.servicio_unidades.proceso IS
  'Tipo de lavado de este envío. Solo se usa cuando servicio = Lavandería.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_pago_maquilas — la demora se mide contra la entrega del maquilero
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

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
        -- FECHA_STATUS5 del Excel: la entrega del maquilero
        o.fecha_s5             AS fecha_entrega_maquilero,
        o.piezas               AS piezas_orden,
        COALESCE(o.piezas_cortadas, c.piezas, 0) AS piezas_cortadas,
        o.costo_maquila,
        o.precio_venta,
        o.precio_publico,
        o.costo_lavanderia,
        o.costo_estampado,
        o.costo_bordado,
        o.costo_corte_externo,
        o.costo_otro,
        COALESCE(r.piezas, 0)    AS piezas_recibidas,
        r.ultima                 AS ultima_recepcion,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        GREATEST(0, COALESCE(o.piezas, 0) - COALESCE(r.piezas, 0)) AS piezas_no_entregadas,
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS costo_final,
        -- La demora se congela en la fecha de entrega del maquilero, no en
        -- la última recepción capturada a mano
        manumoda.fn_semanas_demora(o.fecha_cancelacion, o.fecha_s5) AS semanas_demora
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
        ROUND(b.piezas_no_entregadas * COALESCE(b.precio_venta, 0), 2) AS valor_no_entregadas,
        ROUND(b.costo_final * b.semanas_demora * 0.015, 2)             AS valor_demora
    FROM base b
)
SELECT
    c.*,
    COALESCE(c.maquilero_catalogo, c.maquilero_nombre) AS beneficiario,
    (c.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (c.semanas_demora * 1.5)                           AS demora_pct,
    (c.costo_final - c.valor_no_entregadas - c.valor_demora) AS valor_a_pagar,
    (c.costo_final - c.valor_no_entregadas - c.valor_demora - c.valor_pagado) AS saldo,
    CASE
        WHEN c.valor_pagado > 0 AND c.piezas_recibidas = 0               THEN 'Anticipo'
        WHEN c.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN c.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (c.costo_final - c.valor_no_entregadas - c.valor_demora - c.valor_pagado)
             < -0.005                                                    THEN 'Sobrepagado'
        WHEN abs(c.costo_final - c.valor_no_entregadas - c.valor_demora - c.valor_pagado)
             < 0.005                                                     THEN 'Saldado'
        WHEN c.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago
FROM calculado c;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Cuenta por pagar al maquilero, una fila por folio. '
  'valor_a_pagar = costo_final − no entregadas × precio_venta − demora. '
  'La demora se mide entre fecha_cancelacion y fecha_s5, que es la entrega '
  'del maquilero según FECHA_STATUS5 del Excel.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_servicios_pago — proceso y piezas cortadas
--
--    Se recrea en vez de reemplazar: las columnas nuevas deben quedar
--    junto a las suyas y CREATE OR REPLACE no permite reordenar.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_servicios_pago;

CREATE VIEW manumoda.vw_servicios_pago AS
SELECT
    o.idempresa,
    o.folio,
    o.modelo,
    o.familia,
    o.cliente,
    o.maquilero              AS maquilero_nombre,
    o.piezas                 AS piezas_orden,
    COALESCE(o.piezas_cortadas, c.piezas, 0) AS piezas_cortadas,
    o.precio_venta,
    s.servicio,
    s.costo_unitario,
    u.proceso,
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
    SELECT SUM(piezas_cortadas) AS piezas
    FROM manumoda.corte_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
) c ON true
LEFT JOIN LATERAL (
    SELECT SUM(monto) AS monto,
           SUM(monto) FILTER (WHERE es_adelanto) AS adelantos,
           MAX(fecha) AS ultima
    FROM manumoda.servicio_pagos
    WHERE folio = o.folio AND idempresa = o.idempresa AND servicio = s.servicio
) g ON true
WHERE s.costo_unitario IS NOT NULL
   OR u.id IS NOT NULL
   OR g.monto IS NOT NULL;

COMMENT ON VIEW manumoda.vw_servicios_pago IS
  'Cuentas por pagar de los servicios externos, una fila por folio y '
  'servicio, con las piezas cortadas de referencia y el proceso de lavado '
  'cuando aplica. Se paga por las piezas recibidas × su costo unitario.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio en el libro mayor: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. La demora ahora depende de fecha_s5. Cuántos folios la tienen y
--    cuánto descuenta el atraso medido contra ella.
SELECT
  COUNT(*)                                              AS folios,
  COUNT(fecha_entrega_maquilero)                        AS con_entrega_s5,
  COUNT(*) FILTER (WHERE semanas_demora > 0)            AS con_demora,
  MAX(semanas_demora)                                   AS max_semanas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 3. Servicios por tipo, con su proceso de lavado cuando lo tienen.
SELECT servicio, proceso, COUNT(*) AS folios
FROM manumoda.vw_servicios_pago
WHERE idempresa = 1
GROUP BY servicio, proceso
ORDER BY 1, 2 NULLS FIRST;

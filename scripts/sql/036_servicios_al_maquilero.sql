-- ============================================================
-- Los servicios externos se le pagan al maquilero
--
-- CAMBIO DE MODELO. Hasta ahora cada servicio externo era un
-- acreedor aparte, con su propio saldo y sus propios pagos.
-- Operación aclaró que en realidad el maquilero subcontrata esos
-- servicios y nosotros se los reembolsamos: hay UNA sola cuenta
-- por folio.
--
--   valor_a_pagar = costo_final              (maquila)
--                 + valor_servicios          (los que apliquen)
--                 − no entregadas × precio_venta
--                 − demora
--
-- La demora sigue calculándose sobre el costo de maquila y no
-- sobre el total: es un descuento por el atraso del maquilero en
-- su trabajo, no sobre lo que él a su vez le paga a terceros.
--
-- `servicio_pagos` queda obsoleta. NO se borra —recrearla si el
-- criterio cambia costaría más que dejarla— pero sale de las
-- vistas: dos lugares donde registrar el mismo dinero acaban
-- contradiciéndose. Está vacía, así que no se pierde nada.
--
-- PREREQUISITO: scripts 027 a 035 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Retirar las vistas antes de recrearlas
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;
DROP VIEW IF EXISTS manumoda.vw_servicios_pago;
DROP VIEW IF EXISTS manumoda.vw_historial_pagos;

COMMENT ON TABLE manumoda.servicio_pagos IS
  'OBSOLETA desde el script 036: los servicios externos se le pagan al '
  'maquilero junto con la maquila, así que no tienen cuenta propia. Se '
  'conserva vacía por si el criterio cambia.';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. vw_servicios_pago — captura y costo, sin cuenta propia
--
--    Se le quitan pagado, adelantos, saldo y estado: ese dinero ahora
--    vive en la cuenta del maquilero y tenerlo también aquí invitaría a
--    cuadrar dos saldos que miden lo mismo.
-- ════════════════════════════════════════════════════════════════════════════

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
    ROUND(COALESCE(u.piezas_recibidas, 0) * COALESCE(s.costo_unitario, 0), 2) AS valor
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
-- Un servicio sin costo y sin movimiento simplemente no aplica a ese folio
WHERE s.costo_unitario IS NOT NULL
   OR u.id IS NOT NULL;

COMMENT ON VIEW manumoda.vw_servicios_pago IS
  'Servicios externos por folio: costo unitario, piezas y valor. Se cobran '
  'a través del maquilero, así que no tienen saldo propio — el importe se '
  'suma a su valor a pagar en vw_pago_maquilas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_pago_maquilas — los servicios entran al valor a pagar
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
        o.fecha_s1,
        manumoda.fn_plazo_maquilero(o.fecha_s1) AS fecha_limite_maquilero,
        o.fecha_s5             AS fecha_entrega_s5,
        o.fecha_entrega_real   AS fecha_entrega_corregida,
        COALESCE(o.fecha_entrega_real, o.fecha_s5) AS fecha_entrega_maquilero,
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
        -- Los servicios que sí aplican a este folio, sumados
        COALESCE(sv.valor, 0)    AS valor_servicios,
        COALESCE(sv.cuantos, 0)  AS servicios_aplicables,
        GREATEST(0, COALESCE(o.piezas, 0) - COALESCE(r.piezas, 0)) AS piezas_no_entregadas,
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS costo_final,
        manumoda.fn_semanas_demora(
            manumoda.fn_plazo_maquilero(o.fecha_s1),
            COALESCE(o.fecha_entrega_real, o.fecha_s5)
        ) AS semanas_demora
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
    LEFT JOIN LATERAL (
        SELECT SUM(valor) AS valor, COUNT(*) AS cuantos
        FROM manumoda.vw_servicios_pago
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) sv ON true
),
calculado AS (
    SELECT
        b.*,
        ROUND(b.piezas_no_entregadas * COALESCE(b.precio_venta, 0), 2) AS valor_no_entregadas,
        -- La demora castiga el trabajo del maquilero, no lo que él le paga
        -- a terceros: se calcula sobre el costo de maquila, no sobre el total
        ROUND(b.costo_final * b.semanas_demora * 0.015, 2)             AS valor_demora
    FROM base b
)
SELECT
    c.*,
    COALESCE(c.maquilero_catalogo, c.maquilero_nombre) AS beneficiario,
    (c.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (c.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
    (c.semanas_demora * 1.5)                           AS demora_pct,
    (c.costo_final + c.valor_servicios - c.valor_no_entregadas - c.valor_demora)
      AS valor_a_pagar,
    (c.costo_final + c.valor_servicios - c.valor_no_entregadas - c.valor_demora
      - c.valor_pagado) AS saldo,
    CASE
        WHEN c.valor_pagado > 0 AND c.piezas_recibidas = 0               THEN 'Anticipo'
        WHEN c.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN c.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (c.costo_final + c.valor_servicios - c.valor_no_entregadas
              - c.valor_demora - c.valor_pagado) < -0.005                THEN 'Sobrepagado'
        WHEN abs(c.costo_final + c.valor_servicios - c.valor_no_entregadas
              - c.valor_demora - c.valor_pagado) < 0.005                 THEN 'Saldado'
        WHEN c.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago
FROM calculado c;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Cuenta por pagar al maquilero, una fila por folio. '
  'valor_a_pagar = costo_final + valor_servicios − no entregadas × '
  'precio_venta − demora. Los servicios externos se le reembolsan al '
  'maquilero; la demora se calcula solo sobre el costo de maquila.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_historial_pagos — solo pagos al maquilero
-- ════════════════════════════════════════════════════════════════════════════

CREATE VIEW manumoda.vw_historial_pagos AS
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
  ON mq.id = o.idmaquilero;

COMMENT ON VIEW manumoda.vw_historial_pagos IS
  'Pagos al maquilero en una línea de tiempo. Los servicios externos ya no '
  'se pagan por separado: van dentro del pago al maquilero.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Cuánto suman los servicios al valor a pagar.
SELECT
  COUNT(*)                                          AS folios,
  COUNT(*) FILTER (WHERE servicios_aplicables > 0)  AS con_servicios,
  ROUND(SUM(costo_final), 2)                        AS total_maquila,
  ROUND(SUM(valor_servicios), 2)                    AS total_servicios,
  ROUND(SUM(valor_a_pagar), 2)                      AS total_a_pagar
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 3. Servicios que aplican, por tipo.
SELECT servicio, COUNT(*) AS folios, COUNT(costo_unitario) AS con_costo,
       COUNT(*) FILTER (WHERE piezas_recibidas > 0) AS con_recepcion
FROM manumoda.vw_servicios_pago
WHERE idempresa = 1
GROUP BY servicio
ORDER BY 2 DESC;

-- ============================================================
-- Pagos adelantados e historial de pagos
--
-- PROBLEMA 1: no se podían registrar adelantos. Pagar antes de
-- recibir dejaba el saldo en negativo y el folio salía marcado
-- como "Sobrepagado", que es una alarma de error — cuando en
-- realidad es una decisión deliberada.
--
-- PROBLEMA 2: no había forma de ver qué se le ha pagado a un
-- maquilero a lo largo del tiempo. El dinero estaba registrado
-- pero solo se podía consultar folio por folio.
--
-- DISEÑO:
--   · `es_adelanto` en ambas tablas de pagos. La aritmética del
--     saldo no cambia —un adelanto es dinero entregado igual—,
--     pero la INTENCIÓN queda registrada y el estado lo refleja.
--   · Estado 'Anticipo' cuando hay pagos y no hay recepción. Va
--     primero en el CASE: si aún no llega nada, lo pagado es un
--     adelanto, se haya marcado o no.
--   · `vw_historial_pagos` une los pagos de maquila y lavandería
--     en una sola línea de tiempo.
--
-- PREREQUISITO: scripts 027 a 030 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Marca de adelanto
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.maquila_pagos
  ADD COLUMN IF NOT EXISTS es_adelanto boolean NOT NULL DEFAULT false;

ALTER TABLE manumoda.lavanderia_pagos
  ADD COLUMN IF NOT EXISTS es_adelanto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN manumoda.maquila_pagos.es_adelanto IS
  'El pago se hizo antes de recibir la mercancía. No cambia la aritmética '
  'del saldo: registra la intención, para distinguir un adelanto deliberado '
  'de un sobrepago por error.';

COMMENT ON COLUMN manumoda.lavanderia_pagos.es_adelanto IS
  'El pago se hizo antes de recibir la mercancía de lavandería.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_pago_maquilas — estado 'Anticipo' y total de adelantos
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

CREATE VIEW manumoda.vw_pago_maquilas AS
WITH agregados AS (
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
        o.costo_maquila,
        o.costo_lavanderia,
        o.precio_venta,
        o.precio_publico,
        -- ── Maquila ──
        COALESCE(r.piezas, 0)    AS piezas_recibidas,
        r.ultima                 AS ultima_recepcion,
        COALESCE(p.piezas, 0)    AS piezas_penalizadas,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS valor_maquila,
        ROUND(COALESCE(p.piezas, 0) * COALESCE(o.precio_venta, 0), 2)  AS valor_penalizaciones,
        -- ── Lavandería ──
        COALESCE(o.piezas_lavanderia, 0)           AS piezas_lavanderia,
        COALESCE(o.piezas_lavanderia_recibidas, 0) AS piezas_lavanderia_recibidas,
        COALESCE(lp.monto, 0)                      AS lavanderia_pagado,
        COALESCE(lp.adelantos, 0)                  AS lavanderia_adelantos,
        lp.ultima                                  AS ultimo_pago_lavanderia,
        ROUND(COALESCE(o.piezas_lavanderia_recibidas, 0) * COALESCE(o.costo_lavanderia, 0), 2)
                                                   AS valor_lavanderia
    FROM manumoda.ordenes_produccion o
    LEFT JOIN manumoda.maquileros m
      ON m.id = o.idmaquilero
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
    LEFT JOIN LATERAL (
        SELECT SUM(monto) AS monto,
               SUM(monto) FILTER (WHERE es_adelanto) AS adelantos,
               MAX(fecha) AS ultima
        FROM manumoda.lavanderia_pagos
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) lp ON true
)
SELECT
    a.*,
    COALESCE(a.maquilero_catalogo, a.maquilero_nombre) AS beneficiario,
    (a.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (a.piezas_penalizadas > a.piezas_recibidas)        AS penalizadas_exceden_recibidas,
    (a.valor_maquila - a.valor_penalizaciones)         AS valor_a_pagar,
    (a.valor_maquila - a.valor_penalizaciones - a.valor_pagado) AS saldo,
    CASE
        -- Primero: si no ha llegado nada, lo pagado es un adelanto
        WHEN a.valor_pagado > 0 AND a.piezas_recibidas = 0               THEN 'Anticipo'
        WHEN a.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN a.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (a.valor_maquila - a.valor_penalizaciones - a.valor_pagado)
             < -0.005                                                    THEN 'Sobrepagado'
        WHEN abs(a.valor_maquila - a.valor_penalizaciones - a.valor_pagado)
             < 0.005                                                     THEN 'Saldado'
        WHEN a.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago,
    -- ── Lavandería ──
    (a.valor_lavanderia - a.lavanderia_pagado)            AS saldo_lavanderia,
    (a.piezas_lavanderia - a.piezas_lavanderia_recibidas) AS merma_lavanderia,
    (a.valor_lavanderia > 0
      AND abs(a.valor_lavanderia - a.lavanderia_pagado) < 0.005)         AS lavanderia_pagada,
    CASE
        WHEN a.lavanderia_pagado > 0
             AND a.piezas_lavanderia_recibidas = 0                       THEN 'Anticipo'
        WHEN a.costo_lavanderia IS NULL                                  THEN 'Sin valor'
        WHEN a.piezas_lavanderia_recibidas = 0                           THEN 'Sin recepción'
        WHEN (a.valor_lavanderia - a.lavanderia_pagado) < -0.005         THEN 'Sobrepagado'
        WHEN abs(a.valor_lavanderia - a.lavanderia_pagado) < 0.005       THEN 'Saldado'
        WHEN a.lavanderia_pagado > 0                                     THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_lavanderia
FROM agregados a;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Libro mayor por folio de las dos cuentas por pagar: maquilero y '
  'lavandería, cada una con su valor, pagado, adelantos, saldo y estado. '
  'Los importes se derivan de los valores vigentes de la orden; solo los '
  'pagos son cifras guardadas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_historial_pagos — una línea de tiempo de todo lo pagado
--
--    Los ids de las dos tablas vienen de secuencias distintas y
--    pueden repetirse, así que se expone `clave` para identificar
--    cada movimiento de forma única.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_historial_pagos AS
SELECT
    ('M-' || g.id::text)              AS clave,
    'Maquila'::text                   AS tipo,
    g.idempresa,
    g.folio,
    g.fecha,
    g.monto,
    g.es_adelanto,
    g.referencia,
    g.comentarios,
    g.capturado_por,
    g.created_at,
    o.modelo,
    o.cliente,
    COALESCE(mq.nombre, o.maquilero)  AS beneficiario
FROM manumoda.maquila_pagos g
JOIN manumoda.ordenes_produccion o
  ON o.folio = g.folio AND o.idempresa = g.idempresa
LEFT JOIN manumoda.maquileros mq
  ON mq.id = o.idmaquilero

UNION ALL

SELECT
    ('L-' || lp.id::text)             AS clave,
    'Lavandería'::text                AS tipo,
    lp.idempresa,
    lp.folio,
    lp.fecha,
    lp.monto,
    lp.es_adelanto,
    lp.referencia,
    lp.comentarios,
    lp.capturado_por,
    lp.created_at,
    o.modelo,
    o.cliente,
    'Lavandería'::text                AS beneficiario
FROM manumoda.lavanderia_pagos lp
JOIN manumoda.ordenes_produccion o
  ON o.folio = lp.folio AND o.idempresa = lp.idempresa;

COMMENT ON VIEW manumoda.vw_historial_pagos IS
  'Todos los pagos —maquila y lavandería— en una sola línea de tiempo, '
  'con su beneficiario y si fueron adelantos. Para consultar qué se le ha '
  'pagado a alguien a lo largo del tiempo, no folio por folio.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio en el libro mayor: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. El historial suma lo mismo que el libro mayor.
--    Las dos cifras deben coincidir.
SELECT
  (SELECT COALESCE(SUM(monto), 0) FROM manumoda.vw_historial_pagos
    WHERE idempresa = 1 AND tipo = 'Maquila')          AS historial_maquila,
  (SELECT COALESCE(SUM(valor_pagado), 0) FROM manumoda.vw_pago_maquilas
    WHERE idempresa = 1)                               AS libro_mayor_maquila,
  (SELECT COALESCE(SUM(monto), 0) FROM manumoda.vw_historial_pagos
    WHERE idempresa = 1 AND tipo = 'Lavandería')       AS historial_lavanderia,
  (SELECT COALESCE(SUM(lavanderia_pagado), 0) FROM manumoda.vw_pago_maquilas
    WHERE idempresa = 1)                               AS libro_mayor_lavanderia;

-- 3. Pagos por beneficiario.
SELECT beneficiario, tipo, COUNT(*) AS pagos, SUM(monto) AS total,
       SUM(monto) FILTER (WHERE es_adelanto) AS en_adelantos
FROM manumoda.vw_historial_pagos
WHERE idempresa = 1
GROUP BY beneficiario, tipo
ORDER BY total DESC;

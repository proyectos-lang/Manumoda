-- ============================================================
-- Plazo de 45 días desde S1 y fecha de entrega real editable
--
-- 1. PLAZO. El maquilero tiene 45 días desde que arranca maquila
--    (fecha_s1) para entregar. La demora corre a partir de ahí,
--    no desde la fecha comprometida al cliente.
--
--    Antes se medía contra fecha_cancelacion, que es el
--    compromiso con el cliente y va mucho más lejos: la mediana
--    real de entrega cae 23 días ANTES de esa fecha, así que casi
--    nadie salía penalizado por el motivo correcto.
--
--    Con 45 días desde S1: 30 folios con demora, mediana 4
--    semanas, máximo 14.
--
-- 2. ENTREGA REAL EDITABLE. `fecha_s5` viene del Excel y además
--    determina la fase del pedido en Seguimiento de Maquila.
--    Para poder corregir la fecha de entrega sin mover fases, se
--    agrega `fecha_entrega_real` como sobreescritura: si tiene
--    valor manda, si no se usa fecha_s5.
--
--    Dos columnas y no una porque son dos cosas distintas: lo que
--    dice el sistema origen y lo que operación corrigió. Guardar
--    solo la corregida borraría de dónde venía.
--
-- PREREQUISITO: scripts 027 a 034 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Retirar la vista antes de tocar la función de la que depende
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Fecha de entrega real (sobreescritura manual)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS fecha_entrega_real date;

COMMENT ON COLUMN manumoda.ordenes_produccion.fecha_entrega_real IS
  'Fecha real de entrega del maquilero, corregida a mano desde Pago '
  'Maquilas. Manda sobre fecha_s5 para el cálculo de la demora. Se guarda '
  'aparte para no mover la fase del pedido en Seguimiento de Maquila.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. El plazo del maquilero, en un solo lugar
--
--    DROP y CREATE, no REPLACE: Postgres no permite renombrar los
--    parámetros de una función existente.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS manumoda.fn_semanas_demora(date, date);

/*
 * Días que tiene el maquilero para entregar desde que arranca maquila.
 * Si cambia el acuerdo, se cambia aquí y en DEMORA_PLAZO_DIAS de
 * components/pago-maquilas-module.tsx.
 */
CREATE OR REPLACE FUNCTION manumoda.fn_plazo_maquilero(p_fecha_s1 date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_fecha_s1 + 45;
$$;

COMMENT ON FUNCTION manumoda.fn_plazo_maquilero(date) IS
  'Fecha límite de entrega del maquilero: 45 días después del arranque de '
  'maquila (S1). Pasada esa fecha corre la demora de 1.5% por semana.';

CREATE OR REPLACE FUNCTION manumoda.fn_semanas_demora(
    p_fecha_limite  date,
    p_fecha_entrega date
)
RETURNS integer
LANGUAGE sql
-- STABLE, no IMMUTABLE: sin entrega la cuenta corre hasta CURRENT_DATE
STABLE
AS $$
    SELECT CASE
        WHEN p_fecha_limite IS NULL THEN 0
        ELSE GREATEST(
               0,
               (COALESCE(p_fecha_entrega, CURRENT_DATE) - p_fecha_limite) / 7
             )
    END;
$$;

COMMENT ON FUNCTION manumoda.fn_semanas_demora(date, date) IS
  'Semanas completas de atraso entre el plazo del maquilero y su entrega '
  'real. Si aún no entrega, cuenta hasta hoy. Sin plazo (falta S1) no hay '
  'demora. Cada semana descuenta 1.5% del costo final, sin tope.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_pago_maquilas — plazo, entrega real y demora
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
        -- Arranque de maquila y plazo que se le da al maquilero
        o.fecha_s1,
        manumoda.fn_plazo_maquilero(o.fecha_s1) AS fecha_limite_maquilero,
        -- Lo que dijo el Excel y lo que corrigió operación
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
    (c.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
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
  'La demora corre desde S1 + 45 días hasta la entrega real, que es '
  'fecha_entrega_real si se corrigió a mano, o fecha_s5 del Excel.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. La demora con el plazo de 45 días desde S1.
SELECT
  COUNT(*)                                       AS folios,
  COUNT(fecha_s1)                                AS con_s1,
  COUNT(fecha_entrega_maquilero)                 AS con_entrega,
  COUNT(*) FILTER (WHERE semanas_demora > 0)     AS con_demora,
  MAX(semanas_demora)                            AS max_semanas,
  ROUND(SUM(valor_demora), 2)                    AS descuento_total
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 3. Folios sin S1: no tienen plazo, así que nunca acumulan demora.
--    Vale la pena revisar si es correcto que estén así.
SELECT COUNT(*) AS sin_fecha_s1
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL AND fecha_s1 IS NULL;

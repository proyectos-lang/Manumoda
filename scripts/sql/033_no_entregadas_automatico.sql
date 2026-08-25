-- ============================================================
-- Piezas no entregadas automáticas, piezas cortadas del Excel
-- y "precio final" pasa a llamarse "costo final"
--
-- 1. NO ENTREGADAS AUTOMÁTICAS. Dejan de capturarse a mano: se
--    derivan como `piezas de la orden − piezas recibidas`.
--
--    ⚠️ EFECTO INMEDIATO Y FUERTE. Mientras no se capturen las
--    recepciones, "recibidas" es 0 y toda la orden cuenta como no
--    entregada. Con los datos de hoy eso deja 50 de 53 folios con
--    costo en saldo negativo y genera ~$13.5M de descuentos. Es la
--    decisión explícita del cliente ("siempre, desde ahora"),
--    tomada sabiendo esto. Los saldos se normalizan a medida que
--    se registran las entregas.
--
--    La tabla `maquila_penalizaciones` deja de alimentar el
--    cálculo. NO se borra —tiene 6 registros capturados— pero sus
--    piezas ya no descuentan: ahora saldrían duplicadas contra el
--    cálculo automático.
--
-- 2. PIEZAS CORTADAS. Vienen de la columna PIEZAS_CORTADAS del
--    Excel de folios. Se conserva la suma de corte_programacion
--    como respaldo para los folios que el archivo no traiga.
--
-- 3. Se renombra `precio_final` a `costo_final`: es lo que cuesta
--    la maquila, no un precio de venta.
--
-- PREREQUISITO: scripts 027 a 032 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Retirar la vista antes de tocar sus dependencias
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Piezas cortadas del Excel
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS piezas_cortadas integer;

COMMENT ON COLUMN manumoda.ordenes_produccion.piezas_cortadas IS
  'Piezas cortadas según la columna PIEZAS_CORTADAS del Excel de folios. '
  'Es lo que se le entregó al maquilero para confeccionar. Si el archivo no '
  'la trae, la vista cae en la suma de corte_programacion.';

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_piezas_cortadas;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_piezas_cortadas
  CHECK (piezas_cortadas IS NULL OR piezas_cortadas >= 0);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_pago_maquilas — no entregadas automáticas y costo final
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
        -- El Excel manda; corte_programacion es el respaldo
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
        -- Automático: lo que la orden pedía menos lo que llegó
        GREATEST(0, COALESCE(o.piezas, 0) - COALESCE(r.piezas, 0)) AS piezas_no_entregadas,
        -- Costo final: lo que devolvió, a su costo unitario
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS costo_final,
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
        -- 1.5% del costo final por cada semana completa de atraso
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
  'valor_a_pagar = costo_final − no entregadas × precio_venta − demora, '
  'donde costo_final = piezas recibidas × costo_maquila y las no entregadas '
  'se derivan de piezas de la orden − recibidas.';

COMMENT ON TABLE manumoda.maquila_penalizaciones IS
  'OBSOLETA desde el script 033: las piezas no entregadas se calculan solas '
  'como orden − recibidas. Se conserva por sus registros históricos, pero ya '
  'no alimenta ningún cálculo.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_servicios_pago — exponer el precio de venta del folio
--
--    Columna nueva AL FINAL: CREATE OR REPLACE no permite insertarla en
--    medio ni reordenar las existentes.
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
    END AS estado,
    -- NUEVA (al final para no romper columnas existentes)
    o.precio_venta
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
WHERE s.costo_unitario IS NOT NULL
   OR u.id IS NOT NULL
   OR g.monto IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. ⚠️ El impacto del cálculo automático. Cuenta cuántos folios quedan en
--    saldo negativo por no tener recepciones capturadas todavía.
SELECT
  COUNT(*)                                        AS folios_con_costo,
  COUNT(*) FILTER (WHERE saldo < 0)               AS en_negativo,
  COUNT(*) FILTER (WHERE piezas_recibidas = 0)    AS sin_recepciones,
  ROUND(SUM(valor_no_entregadas), 2)              AS descuento_no_entregadas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND maquilero_nombre IS NOT NULL
  AND costo_maquila IS NOT NULL;

-- 3. Cobertura de piezas cortadas. Estará en 0 desde el Excel hasta la
--    próxima carga; mientras tanto sale del respaldo de corte_programacion.
SELECT
  COUNT(*)                                          AS folios,
  COUNT(*) FILTER (WHERE piezas_cortadas > 0)       AS con_cortadas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

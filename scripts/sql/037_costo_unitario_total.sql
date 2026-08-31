-- ============================================================
-- Un solo costo unitario: maquila más todos los procesos
--
-- SIMPLIFICACIÓN. Cada proceso dejaba de tener sus propias
-- cantidades enviadas y recibidas. Operación aclaró que todo se
-- mide sobre las MISMAS piezas: las que recibió el maquilero.
--
--   costo unitario total = costo_maquila
--                        + costo_lavanderia + costo_estampado
--                        + costo_bordado + costo_corte_externo
--                        + costo_otro
--
--   costo_final   = piezas recibidas × costo unitario total
--   valor_a_pagar = costo_final
--                 − no entregadas × precio_venta
--                 − demora
--
-- Los procesos sin costo capturado valen 0 y no suman, pero se
-- siguen mostrando: un renglón en cero dice "este folio no lleva
-- ese proceso", que no es lo mismo que no verlo.
--
-- `servicio_unidades.piezas_enviadas/recibidas` dejan de
-- alimentar el cálculo. Las columnas se conservan —tienen datos y
-- sirven para control de merma— pero el dinero ya no depende de
-- ellas. `proceso` (el tipo de lavado) sigue igual.
--
-- PREREQUISITO: scripts 027 a 036 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Retirar las vistas antes de recrearlas
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;
DROP VIEW IF EXISTS manumoda.vw_servicios_pago;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. vw_pago_maquilas — costo unitario total sobre las piezas recibidas
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
        -- Lo que cuesta una pieza con todos sus procesos encima
        (COALESCE(o.costo_maquila,       0)
       + COALESCE(o.costo_lavanderia,    0)
       + COALESCE(o.costo_estampado,     0)
       + COALESCE(o.costo_bordado,       0)
       + COALESCE(o.costo_corte_externo, 0)
       + COALESCE(o.costo_otro,          0)) AS costo_unitario_total,
        -- Solo la parte de los procesos, sin la maquila
        (COALESCE(o.costo_lavanderia,    0)
       + COALESCE(o.costo_estampado,     0)
       + COALESCE(o.costo_bordado,       0)
       + COALESCE(o.costo_corte_externo, 0)
       + COALESCE(o.costo_otro,          0)) AS costo_unitario_servicios,
        COALESCE(r.piezas, 0)    AS piezas_recibidas,
        r.ultima                 AS ultima_recepcion,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        GREATEST(0, COALESCE(o.piezas, 0) - COALESCE(r.piezas, 0)) AS piezas_no_entregadas,
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
        -- Todo sobre las mismas piezas: las que devolvió el maquilero
        ROUND(b.piezas_recibidas * b.costo_unitario_total, 2)     AS costo_final,
        ROUND(b.piezas_recibidas * COALESCE(b.costo_maquila, 0), 2) AS valor_maquila,
        ROUND(b.piezas_recibidas * b.costo_unitario_servicios, 2) AS valor_servicios,
        ROUND(b.piezas_no_entregadas * COALESCE(b.precio_venta, 0), 2) AS valor_no_entregadas
    FROM base b
),
final AS (
    SELECT
        c.*,
        -- La demora castiga el trabajo del maquilero: se calcula sobre la
        -- maquila, no sobre lo que él le paga a terceros
        ROUND(c.valor_maquila * c.semanas_demora * 0.015, 2) AS valor_demora
    FROM calculado c
)
SELECT
    f.*,
    COALESCE(f.maquilero_catalogo, f.maquilero_nombre) AS beneficiario,
    (f.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (f.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
    (f.semanas_demora * 1.5)                           AS demora_pct,
    (f.costo_final - f.valor_no_entregadas - f.valor_demora) AS valor_a_pagar,
    (f.costo_final - f.valor_no_entregadas - f.valor_demora - f.valor_pagado) AS saldo,
    CASE
        WHEN f.valor_pagado > 0 AND f.piezas_recibidas = 0               THEN 'Anticipo'
        WHEN f.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN f.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (f.costo_final - f.valor_no_entregadas - f.valor_demora - f.valor_pagado)
             < -0.005                                                    THEN 'Sobrepagado'
        WHEN abs(f.costo_final - f.valor_no_entregadas - f.valor_demora - f.valor_pagado)
             < 0.005                                                     THEN 'Saldado'
        WHEN f.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago
FROM final f;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Cuenta por pagar al maquilero, una fila por folio. '
  'costo_final = piezas recibidas × (costo_maquila + los cinco costos de '
  'proceso). valor_a_pagar = costo_final − no entregadas × precio_venta − '
  'demora, y la demora se calcula solo sobre la parte de maquila.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_servicios_pago — el proceso y su costo, sobre las piezas recibidas
--
--    Las cantidades ya no salen de servicio_unidades: todo se mide sobre
--    las piezas que devolvió el maquilero, que son las mismas que pasaron
--    por cada proceso.
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
    COALESCE(r.piezas, 0)    AS piezas_recibidas,
    ROUND(COALESCE(r.piezas, 0) * COALESCE(s.costo_unitario, 0), 2) AS valor
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
    SELECT SUM(piezas) AS piezas
    FROM manumoda.maquila_recepciones
    WHERE folio = o.folio AND idempresa = o.idempresa
) r ON true
WHERE s.costo_unitario IS NOT NULL
   OR u.id IS NOT NULL;

COMMENT ON VIEW manumoda.vw_servicios_pago IS
  'Procesos externos por folio: costo unitario, piezas recibidas del '
  'maquilero y su importe. Todo se mide sobre las mismas piezas; el '
  'importe ya está incluido en costo_final de vw_pago_maquilas.';

COMMENT ON COLUMN manumoda.servicio_unidades.piezas_enviadas IS
  'Control de merma. Desde el script 037 NO alimenta el cálculo: el dinero '
  'se mide sobre las piezas que recibió el maquilero.';
COMMENT ON COLUMN manumoda.servicio_unidades.piezas_recibidas IS
  'Control de merma. Desde el script 037 NO alimenta el cálculo.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. El costo unitario total y su reparto.
SELECT
  COUNT(*)                                            AS folios,
  COUNT(*) FILTER (WHERE costo_unitario_servicios > 0) AS con_procesos,
  ROUND(AVG(costo_unitario_total), 2)                 AS costo_unit_promedio,
  ROUND(SUM(valor_maquila), 2)                        AS total_maquila,
  ROUND(SUM(valor_servicios), 2)                      AS total_procesos,
  ROUND(SUM(costo_final), 2)                          AS costo_final_total
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 3. Ejemplo concreto: el desglose de un folio con recepciones.
SELECT folio, piezas_recibidas,
       costo_maquila, costo_lavanderia, costo_estampado,
       costo_bordado, costo_corte_externo, costo_otro,
       costo_unitario_total, costo_final, valor_a_pagar
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND piezas_recibidas > 0
ORDER BY costo_final DESC
LIMIT 10;

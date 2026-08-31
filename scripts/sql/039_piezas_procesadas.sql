-- ============================================================
-- Piezas procesadas por servicio
--
-- Cada proceso puede haber trabajado una cantidad distinta de la
-- que devolvió el maquilero: la lavandería lava lo que le llega,
-- que no siempre es todo el lote. Se agrega `piezas_procesadas`
-- por folio y servicio, y su costo se calcula sobre ella.
--
--   costo_final = recibidas × costo_maquila
--               + Σ (procesadas del servicio × su costo unitario)
--
-- Si un servicio no tiene procesadas capturadas se usan las
-- recibidas, para que el cálculo funcione desde el primer día.
--
-- `costo_unitario_total` se conserva como referencia de lo que
-- cuesta una pieza con todo encima, pero YA NO es el multiplicador
-- del costo final: cada proceso puede ir sobre su propia cantidad.
--
-- PREREQUISITO: scripts 027 a 038 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;
DROP VIEW IF EXISTS manumoda.vw_servicios_pago;

ALTER TABLE manumoda.servicio_unidades
  ADD COLUMN IF NOT EXISTS piezas_procesadas integer;

COMMENT ON COLUMN manumoda.servicio_unidades.piezas_procesadas IS
  'Piezas que este proceso trabajó realmente. Es la base de su costo. '
  'NULL = usar las piezas recibidas del maquilero.';

ALTER TABLE manumoda.servicio_unidades
  DROP CONSTRAINT IF EXISTS chk_servicio_piezas_procesadas;

ALTER TABLE manumoda.servicio_unidades
  ADD CONSTRAINT chk_servicio_piezas_procesadas
  CHECK (piezas_procesadas IS NULL OR piezas_procesadas >= 0);

-- ════════════════════════════════════════════════════════════════════════════
-- 1. vw_servicios_pago — el costo va sobre las piezas procesadas
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
    COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0) AS piezas_recibidas,
    -- Lo que este proceso trabajó; si no se capturó, lo recibido
    COALESCE(
      u.piezas_procesadas,
      o.piezas_recibidas_ajuste,
      r.piezas,
      0
    ) AS piezas_procesadas,
    (u.piezas_procesadas IS NOT NULL) AS procesadas_capturadas,
    ROUND(
      COALESCE(u.piezas_procesadas, o.piezas_recibidas_ajuste, r.piezas, 0)
      * COALESCE(s.costo_unitario, 0), 2
    ) AS valor
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
  'Procesos externos por folio. El costo se calcula sobre las piezas que '
  'ese proceso trabajó (piezas_procesadas), no sobre las recibidas del '
  'maquilero. Su importe ya está dentro de costo_final de vw_pago_maquilas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_pago_maquilas — el costo final suma maquila y procesos
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
        -- Referencia: lo que cuesta una pieza con todo encima. Ya no es el
        -- multiplicador del costo final, porque cada proceso puede ir sobre
        -- su propia cantidad de piezas procesadas.
        (COALESCE(o.costo_maquila,       0)
       + COALESCE(o.costo_lavanderia,    0)
       + COALESCE(o.costo_estampado,     0)
       + COALESCE(o.costo_bordado,       0)
       + COALESCE(o.costo_corte_externo, 0)
       + COALESCE(o.costo_otro,          0)) AS costo_unitario_total,
        (COALESCE(o.costo_lavanderia,    0)
       + COALESCE(o.costo_estampado,     0)
       + COALESCE(o.costo_bordado,       0)
       + COALESCE(o.costo_corte_externo, 0)
       + COALESCE(o.costo_otro,          0)) AS costo_unitario_servicios,
        COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0) AS piezas_recibidas,
        COALESCE(r.piezas, 0)          AS piezas_recibidas_entregas,
        o.piezas_recibidas_ajuste,
        r.ultima                 AS ultima_recepcion,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        COALESCE(sv.valor, 0)    AS valor_servicios,
        GREATEST(
          0,
          COALESCE(o.piezas, 0) - COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0)
        ) AS piezas_no_entregadas,
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
        SELECT SUM(valor) AS valor
        FROM manumoda.vw_servicios_pago
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) sv ON true
),
calculado AS (
    SELECT
        b.*,
        ROUND(b.piezas_recibidas * COALESCE(b.costo_maquila, 0), 2) AS valor_maquila,
        -- Maquila sobre lo recibido, cada proceso sobre lo que trabajó
        ROUND(b.piezas_recibidas * COALESCE(b.costo_maquila, 0), 2)
          + b.valor_servicios AS costo_final,
        ROUND(b.piezas_no_entregadas * COALESCE(b.precio_venta, 0), 2) AS valor_no_entregadas
    FROM base b
),
final AS (
    SELECT
        c.*,
        ROUND(c.valor_maquila * c.semanas_demora * 0.015, 2) AS valor_demora
    FROM calculado c
)
SELECT
    f.*,
    COALESCE(f.maquilero_catalogo, f.maquilero_nombre) AS beneficiario,
    (f.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (f.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
    (f.piezas_recibidas_ajuste IS NOT NULL)            AS recibidas_ajustadas,
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
  'costo_final = recibidas × costo_maquila + Σ(procesadas × costo del '
  'proceso). valor_a_pagar = costo_final − no entregadas × precio_venta − '
  'demora, y la demora se calcula solo sobre la parte de maquila.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Folios donde las procesadas difieren de las recibidas: ahí es donde
--    el costo deja de ser recibidas × unitario total.
SELECT folio, servicio, piezas_recibidas, piezas_procesadas,
       costo_unitario, valor
FROM manumoda.vw_servicios_pago
WHERE idempresa = 1
  AND procesadas_capturadas
  AND piezas_procesadas <> piezas_recibidas
ORDER BY folio
LIMIT 20;

-- 3. Reparto del costo final.
SELECT
  COUNT(*)                        AS folios,
  ROUND(SUM(valor_maquila), 2)    AS total_maquila,
  ROUND(SUM(valor_servicios), 2)  AS total_procesos,
  ROUND(SUM(costo_final), 2)      AS costo_final_total,
  ROUND(SUM(valor_a_pagar), 2)    AS total_a_pagar
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

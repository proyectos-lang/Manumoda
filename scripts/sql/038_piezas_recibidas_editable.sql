-- ============================================================
-- Piezas recibidas editables a mano
--
-- Las piezas recibidas salían solo de sumar los registros de
-- `maquila_recepciones`. Ahora que TODO el cálculo cuelga de ese
-- número —cada proceso lo multiplica— hace falta poder ajustarlo
-- directo, sin tener que cuadrar el historial de entregas.
--
-- Se resuelve con una sobreescritura, no reemplazando la suma:
--
--   piezas_recibidas = COALESCE(ajuste manual, suma de entregas)
--
-- Dos campos y no uno porque son dos cosas distintas: lo que se
-- fue registrando entrega por entrega y lo que operación afirma
-- que llegó. Guardar solo el ajuste borraría el historial; que el
-- ajuste mande permite corregir sin tener que inventar entregas.
--
-- Es el mismo patrón de `fecha_entrega_real` (script 035).
--
-- PREREQUISITO: scripts 027 a 037 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;
DROP VIEW IF EXISTS manumoda.vw_servicios_pago;

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS piezas_recibidas_ajuste integer;

COMMENT ON COLUMN manumoda.ordenes_produccion.piezas_recibidas_ajuste IS
  'Piezas recibidas del maquilero, fijadas a mano desde Pago Maquilas. '
  'Manda sobre la suma de maquila_recepciones. NULL = usar la suma del '
  'historial de entregas.';

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_piezas_recibidas_ajuste;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_piezas_recibidas_ajuste
  CHECK (piezas_recibidas_ajuste IS NULL OR piezas_recibidas_ajuste >= 0);

-- ════════════════════════════════════════════════════════════════════════════
-- vw_pago_maquilas
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
        -- El ajuste manual manda; si no hay, la suma de las entregas
        COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0) AS piezas_recibidas,
        COALESCE(r.piezas, 0)          AS piezas_recibidas_entregas,
        o.piezas_recibidas_ajuste,
        r.ultima                 AS ultima_recepcion,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
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
),
calculado AS (
    SELECT
        b.*,
        ROUND(b.piezas_recibidas * b.costo_unitario_total, 2)       AS costo_final,
        ROUND(b.piezas_recibidas * COALESCE(b.costo_maquila, 0), 2) AS valor_maquila,
        ROUND(b.piezas_recibidas * b.costo_unitario_servicios, 2)   AS valor_servicios,
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
  'piezas_recibidas sale del ajuste manual si existe, si no de la suma de '
  'entregas. costo_final = piezas recibidas × costo unitario total.';

-- ════════════════════════════════════════════════════════════════════════════
-- vw_servicios_pago — usa las mismas piezas recibidas
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
    ROUND(COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0)
          * COALESCE(s.costo_unitario, 0), 2) AS valor
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
  'Procesos externos por folio, sobre las mismas piezas recibidas que usa '
  'vw_pago_maquilas. Su importe ya está dentro de costo_final.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Cuántos folios tienen las recibidas ajustadas a mano, y si el ajuste
--    difiere de lo que suman sus entregas registradas.
SELECT
  COUNT(*)                                                   AS folios,
  COUNT(*) FILTER (WHERE recibidas_ajustadas)                AS con_ajuste,
  COUNT(*) FILTER (WHERE recibidas_ajustadas
                     AND piezas_recibidas <> piezas_recibidas_entregas)
                                                             AS ajuste_difiere
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 3. Desglose de los folios con recepciones.
SELECT folio, piezas_orden, piezas_recibidas, costo_unitario_total,
       costo_final, valor_no_entregadas, valor_demora, valor_a_pagar
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND piezas_recibidas > 0
ORDER BY costo_final DESC
LIMIT 10;

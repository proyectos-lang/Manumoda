-- ============================================================
-- La entrega real es la última parcialidad
--
-- QUÉ ESTABA MAL:
--   `fecha_entrega_maquilero` salía de FECHA_STATUS5 del Excel (o de
--   la corrección manual). Las entregas que se capturan en la app NO
--   entraban al cálculo de la demora, así que un folio con
--   parcialidades del 31/ago y 2/sep se seguía midiendo contra el
--   2/ago que traía el archivo.
--
-- REGLA NUEVA (decidida por operación):
--
--   1. La entrega real es la fecha de la ÚLTIMA parcialidad recibida.
--      Entregar la mitad dentro del plazo no es entregar a tiempo:
--      la orden está entregada cuando llega la última pieza.
--
--   2. Sin ninguna parcialidad registrada, la orden se considera NO
--      ENTREGADA y la demora corre desde el plazo hasta HOY, creciendo
--      cada semana.
--
--   3. La corrección manual (`fecha_entrega_real`) sigue mandando
--      sobre todo lo anterior. Es la válvula para los casos que el
--      registro no refleja.
--
--   FECHA_STATUS5 deja de alimentar la demora. Se conserva y se sigue
--   mostrando como referencia de lo que dijo el archivo.
--
-- IMPACTO MEDIDO (idempresa 1, antes de ejecutar):
--   demora total   $0.00 → $38,353.80
--   folios con demora   0 → 107
--
--   Hoy da $0 porque FECHA_STATUS5 es anterior al plazo en todos los
--   folios; el castigo por no entregar nunca se estaba aplicando.
--
-- PREREQUISITO: scripts 027 a 044 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La fecha de entrega que manda
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
        o.fecha_pedido,
        o.fecha_cancelacion,
        o.fecha_facturacion,
        o.fecha_s1,
        manumoda.fn_plazo_maquilero(o.fecha_s1) AS fecha_limite_maquilero,
        o.fecha_s5             AS fecha_entrega_s5,
        o.fecha_entrega_real   AS fecha_entrega_corregida,
        -- Última parcialidad recibida; de referencia para la interfaz
        r.ultima               AS fecha_ultima_entrega,
        -- La que manda para la demora: corrección manual > última parcialidad.
        -- Sin parcialidades queda NULL = todavía no entregado.
        COALESCE(o.fecha_entrega_real, r.ultima) AS fecha_entrega_maquilero,
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
        COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0) AS piezas_recibidas,
        COALESCE(r.piezas, 0)          AS piezas_recibidas_entregas,
        o.piezas_recibidas_ajuste,
        r.ultima                 AS ultima_recepcion,
        COALESCE(sv.valor, 0)    AS valor_servicios,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        COALESCE(pf.monto, 0)    AS valor_penalizaciones_fijas,
        COALESCE(pf.cuantas, 0)  AS penalizaciones_fijas,
        GREATEST(
          0,
          COALESCE(o.piezas, 0) - COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0)
        ) AS piezas_no_entregadas,
        -- Sin entrega, el reloj corre contra HOY: la demora sigue creciendo
        -- mientras el maquilero no entregue.
        manumoda.fn_semanas_demora(
            manumoda.fn_plazo_maquilero(o.fecha_s1),
            COALESCE(o.fecha_entrega_real, r.ultima, CURRENT_DATE)
        ) AS semanas_demora,
        (COALESCE(o.fecha_entrega_real, r.ultima) IS NULL) AS sin_entrega
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
        SELECT SUM(valor) AS valor
        FROM manumoda.vw_servicios_pago s
        WHERE s.folio = o.folio AND s.idempresa = o.idempresa
    ) sv ON true
    LEFT JOIN LATERAL (
        SELECT SUM(monto) AS monto,
               SUM(monto) FILTER (WHERE es_adelanto) AS adelantos,
               MAX(fecha) AS ultima
        FROM manumoda.maquila_pagos
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) g ON true
    LEFT JOIN LATERAL (
        SELECT SUM(monto_aplicado) AS monto, COUNT(*) AS cuantas
        FROM manumoda.maquila_penalizaciones_fijas
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) pf ON true
),
calculado AS (
    SELECT
        b.*,
        ROUND(b.piezas_recibidas * COALESCE(b.costo_maquila, 0), 2)
          + b.valor_servicios                                       AS costo_final,
        ROUND(b.piezas_recibidas * COALESCE(b.costo_maquila, 0), 2) AS valor_maquila,
        ROUND(b.piezas_no_entregadas * COALESCE(b.precio_venta, 0), 2) AS valor_no_entregadas
    FROM base b
),
final AS (
    SELECT
        c.*,
        ROUND(c.valor_maquila * c.semanas_demora * 0.015, 2) AS valor_demora
    FROM calculado c
),
totales AS (
    SELECT
        f.*,
        (f.valor_no_entregadas + f.valor_demora + f.valor_penalizaciones_fijas)
          AS valor_penalizaciones
    FROM final f
)
SELECT
    t.*,
    COALESCE(t.maquilero_catalogo, t.maquilero_nombre) AS beneficiario,
    (t.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (t.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
    (t.piezas_recibidas_ajuste IS NOT NULL)            AS recibidas_ajustadas,
    (t.semanas_demora * 1.5)                           AS demora_pct,
    (t.costo_final - t.valor_penalizaciones)                   AS valor_a_pagar,
    (t.costo_final - t.valor_penalizaciones - t.valor_pagado)  AS saldo,
    CASE
        WHEN t.valor_pagado > 0 AND t.piezas_recibidas = 0               THEN 'Anticipo'
        WHEN t.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN t.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (t.costo_final - t.valor_penalizaciones - t.valor_pagado)
             < -0.005                                                    THEN 'Sobrepagado'
        WHEN abs(t.costo_final - t.valor_penalizaciones - t.valor_pagado)
             < 0.005                                                     THEN 'Saldado'
        WHEN t.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago
FROM totales t;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Cuenta por pagar al maquilero, una fila por folio. La entrega real es la '
  'ÚLTIMA parcialidad recibida (o la corrección manual); sin parcialidades la '
  'orden cuenta como no entregada y la demora corre contra la fecha de hoy.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. La entrega real debe coincidir con la última parcialidad de cada folio
--    que tenga entregas y no tenga corrección manual. 0 filas.
SELECT v.folio, v.fecha_entrega_maquilero, r.ultima
FROM manumoda.vw_pago_maquilas v
JOIN LATERAL (
  SELECT MAX(fecha) AS ultima
  FROM manumoda.maquila_recepciones
  WHERE folio = v.folio AND idempresa = v.idempresa
) r ON true
WHERE v.idempresa = 1
  AND r.ultima IS NOT NULL
  AND v.fecha_entrega_corregida IS NULL
  AND v.fecha_entrega_maquilero IS DISTINCT FROM r.ultima;

-- 3. El nuevo reparto de la demora. Esperado: ≈ $38,353.80 en ~107 folios.
SELECT
  COUNT(*)                                        AS folios,
  COUNT(*) FILTER (WHERE sin_entrega)             AS sin_entrega,
  COUNT(*) FILTER (WHERE semanas_demora > 0)      AS con_demora,
  ROUND(SUM(valor_demora), 2)                     AS demora_total
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 4. Coherencia del cálculo: 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

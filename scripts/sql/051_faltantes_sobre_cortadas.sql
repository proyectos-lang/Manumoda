-- ============================================================
-- Las piezas faltantes se miden contra lo CORTADO
--
-- QUÉ ESTABA MAL:
--   `piezas_no_entregadas` salía de `piezas de la orden − recibidas`.
--   Al maquilero se le reclama lo que se le ENTREGÓ para confeccionar,
--   que son las piezas cortadas, no lo que el cliente pidió. Cuando la
--   orden se corta incompleta —a propósito o por falta de tela— la
--   diferencia se le estaba cobrando a él.
--
--   Se descuenta a precio de venta, así que el error no es menor.
--
-- LA REGLA NUEVA:
--
--     faltantes = piezas cortadas − recibidas
--
--   Sin piezas cortadas capturadas NO se descuenta nada: no hay base
--   para el reclamo. Es la decisión de operación, y se corrige solo en
--   cuanto el dato llegue del Excel.
--
--   `piezas_cortadas` de la orden manda; si viene en blanco se usa lo
--   que sumen los registros del plan de corte, igual que en el resto
--   de la vista.
--
-- IMPACTO MEDIDO (idempresa 1, antes de ejecutar):
--   descuento por no entregadas   $33,013,745.40 → $28,579,218.20
--   201 folios con maquilero, 81 de ellos sin piezas cortadas: esos
--   pasan a descontar $0 hasta que se capture el dato.
--
-- PREREQUISITO: scripts 027 a 049 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

CREATE VIEW manumoda.vw_pago_maquilas AS
WITH parametro AS (
    SELECT idempresa, monto
    FROM manumoda.cat_penalizaciones_maquila
    WHERE clave = 'parcialidad_excedente'
),
base AS (
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
        r.ultima               AS fecha_ultima_entrega,
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
        o.penalizacion_negociada,
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
        COALESCE(r.parcialidades, 0)   AS parcialidades,
        GREATEST(0, COALESCE(r.parcialidades, 0) - 3) AS parcialidades_excedentes,
        COALESCE(sv.valor, 0)    AS valor_servicios,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        COALESCE(pf.monto, 0)    AS valor_penalizaciones_fijas,
        COALESCE(pf.cuantas, 0)  AS penalizaciones_fijas,
        -- Las faltantes salen de lo CORTADO, no de lo pedido: al maquilero se
        -- le reclama lo que se le entregó para confeccionar. Sin piezas
        -- cortadas capturadas no hay base para el reclamo y no se descuenta
        -- nada; en cuanto lleguen del Excel, el cálculo se corrige solo.
        CASE
          WHEN COALESCE(o.piezas_cortadas, c.piezas) IS NULL THEN 0
          ELSE GREATEST(
            0,
            COALESCE(o.piezas_cortadas, c.piezas)
              - COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0)
          )
        END AS piezas_no_entregadas,
        manumoda.fn_semanas_demora(
            manumoda.fn_plazo_maquilero(o.fecha_s1),
            COALESCE(o.fecha_entrega_real, r.ultima, CURRENT_DATE)
        ) AS semanas_demora,
        (COALESCE(o.fecha_entrega_real, r.ultima) IS NULL) AS sin_entrega,
        COALESCE(pm.monto, 500) AS monto_parcialidad,
        -- Lo que ya se le pagó a la lavandería y demás servicios
        COALESCE(sp.monto, 0)    AS valor_servicios_pagado
    FROM manumoda.ordenes_produccion o
    LEFT JOIN manumoda.maquileros m
      ON m.id = o.idmaquilero
    LEFT JOIN parametro pm
      ON pm.idempresa = o.idempresa
    LEFT JOIN LATERAL (
        SELECT SUM(piezas_cortadas) AS piezas
        FROM manumoda.corte_programacion
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) c ON true
    LEFT JOIN LATERAL (
        SELECT SUM(piezas) AS piezas, MAX(fecha) AS ultima, COUNT(*) AS parcialidades
        FROM manumoda.maquila_recepciones
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) r ON true
    LEFT JOIN LATERAL (
        SELECT SUM(valor) AS valor
        FROM manumoda.vw_servicios_pago s
        WHERE s.folio = o.folio AND s.idempresa = o.idempresa
    ) sv ON true
    LEFT JOIN LATERAL (
        SELECT SUM(monto) AS monto
        FROM manumoda.servicio_pagos
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) sp ON true
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
        ROUND(b.piezas_no_entregadas * COALESCE(b.precio_venta, 0), 2) AS valor_no_entregadas,
        ROUND(b.parcialidades_excedentes * b.monto_parcialidad, 2)  AS valor_parcialidades
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
        -- Lo que dicta la regla, siempre visible como referencia
        (f.valor_no_entregadas + f.valor_demora + f.valor_parcialidades
         + f.valor_penalizaciones_fijas) AS valor_penalizaciones_calculado,
        -- Lo que se aplica: el acuerdo manda sobre la regla
        COALESCE(
          f.penalizacion_negociada,
          f.valor_no_entregadas + f.valor_demora + f.valor_parcialidades
            + f.valor_penalizaciones_fijas
        ) AS valor_penalizaciones
    FROM final f
)
SELECT
    t.*,
    COALESCE(t.maquilero_catalogo, t.maquilero_nombre) AS beneficiario,
    (t.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (t.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
    (t.piezas_recibidas_ajuste IS NOT NULL)            AS recibidas_ajustadas,
    (t.penalizacion_negociada IS NOT NULL)             AS penalizacion_es_negociada,
    (t.semanas_demora * 1.5)                           AS demora_pct,
    (t.costo_final - t.valor_penalizaciones)                   AS valor_a_pagar,
    (t.costo_final - t.valor_penalizaciones - t.valor_pagado)  AS saldo,
    -- Saldo con la lavandería y los demás servicios, que se pagan aparte
    (t.valor_servicios - t.valor_servicios_pagado)             AS saldo_servicios,
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
  'Cuenta por pagar al maquilero, una fila por folio. Las piezas no '
  'entregadas se miden contra las CORTADAS, que es lo que se le entregó '
  'para confeccionar; sin ese dato no se descuenta nada.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Las faltantes deben cuadrar con cortadas − recibidas, y ser 0 cuando
--    no hay cortadas. 0 filas.
SELECT folio, piezas_cortadas, piezas_recibidas, piezas_no_entregadas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND piezas_no_entregadas <> CASE
        WHEN piezas_cortadas IS NULL OR piezas_cortadas = 0 THEN 0
        ELSE GREATEST(0, piezas_cortadas - piezas_recibidas)
      END;

-- 3. Ningún folio debe descontar por encima de lo cortado. 0 filas.
SELECT folio, piezas_cortadas, piezas_recibidas, piezas_no_entregadas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND piezas_cortadas > 0
  AND piezas_no_entregadas > piezas_cortadas;

-- 4. El nuevo reparto. Esperado ≈ $28,579,218.20 en no entregadas.
SELECT
  COUNT(*)                                              AS folios,
  COUNT(*) FILTER (WHERE piezas_cortadas = 0)           AS sin_cortadas,
  COUNT(*) FILTER (WHERE piezas_no_entregadas > 0)      AS con_faltantes,
  ROUND(SUM(valor_no_entregadas), 2)                    AS descuento_faltantes,
  ROUND(SUM(valor_penalizaciones), 2)                   AS total_penalizaciones
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 5. Coherencia del cálculo: 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

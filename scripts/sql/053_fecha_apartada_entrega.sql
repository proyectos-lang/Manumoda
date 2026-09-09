-- ============================================================
-- Fecha apartada de entrega, y su penalización automática
--
-- QUÉ AGREGA:
--   `fecha_apartada_entrega`: el día que el maquilero aparta para
--   entregar. Se captura en Seguimiento de Maquila (sección C,
--   Confirmación) y se muestra en el Master Tracking.
--
-- LA PENALIZACIÓN:
--   El concepto `sin_apartar_fecha` deja de ser una casilla manual y
--   pasa a calcularse solo. Aplica si se cumple CUALQUIERA de las dos
--   condiciones —es una sola falta con dos formas:
--
--     a) No apartó fecha de entrega, o
--     b) Apartó una fecha y entregó en otra distinta
--
--   La comparación es contra `fecha_entrega_maquilero`, que es la
--   última parcialidad recibida o la corrección manual (script 045).
--   Cualquier diferencia cuenta, en cualquier dirección: adelantarse
--   también descuadra la recepción.
--
--   Mientras la orden no tenga entrega registrada NO se penaliza por
--   fecha distinta: todavía no hay con qué comparar. El caso (a) sí
--   aplica desde el inicio, porque no apartar es una falta por sí
--   misma.
--
-- POR QUÉ AUTOMÁTICA Y NO CASILLA:
--   Las dos condiciones se pueden verificar con los datos que ya
--   existen. Dejarla manual obligaba a comparar fechas a mano folio
--   por folio, y permitía olvidarla. El monto sigue en el catálogo,
--   así que se ajusta desde la app.
--
--   La fila del catálogo se DESACTIVA, no se borra: deja de ofrecerse
--   como casilla pero conserva su monto, que es el que usa el cálculo.
--   Verificado: hoy ningún folio la tiene marcada a mano, así que no
--   hay riesgo de cobro doble.
--
-- PREREQUISITO: scripts 027 a 052 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS fecha_apartada_entrega date;

COMMENT ON COLUMN manumoda.ordenes_produccion.fecha_apartada_entrega IS
  'Día que el maquilero aparta para entregar. Se compara contra la entrega '
  'real: cualquier diferencia penaliza. NULL = no apartó, que también '
  'penaliza.';

-- La casilla se retira: el cálculo la resuelve solo.
UPDATE manumoda.cat_penalizaciones_maquila
SET activo = false,
    nombre = 'No apartó fecha, o entregó en fecha distinta (automática)'
WHERE idempresa = 1 AND clave = 'sin_apartar_fecha';

-- ════════════════════════════════════════════════════════════════════════════
-- vw_pago_maquilas
-- ════════════════════════════════════════════════════════════════════════════

CREATE VIEW manumoda.vw_pago_maquilas AS
WITH parametro AS (
    SELECT idempresa, monto
    FROM manumoda.cat_penalizaciones_maquila
    WHERE clave = 'parcialidad_excedente'
),
param_apartada AS (
    SELECT idempresa, monto
    FROM manumoda.cat_penalizaciones_maquila
    WHERE clave = 'sin_apartar_fecha'
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
        o.fecha_apartada_entrega,
        r.ultima               AS fecha_ultima_entrega,
        COALESCE(o.fecha_entrega_real, r.ultima) AS fecha_entrega_maquilero,
        o.piezas               AS piezas_orden,
        COALESCE(o.piezas_cortadas_ajuste, o.piezas_cortadas, c.piezas, 0)
          AS piezas_cortadas,
        o.piezas_cortadas      AS piezas_cortadas_excel,
        o.piezas_cortadas_ajuste,
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
        CASE
          WHEN COALESCE(o.piezas_cortadas_ajuste, o.piezas_cortadas, c.piezas)
               IS NULL THEN 0
          ELSE GREATEST(
            0,
            COALESCE(o.piezas_cortadas_ajuste, o.piezas_cortadas, c.piezas)
              - COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0)
          )
        END AS piezas_no_entregadas,
        manumoda.fn_semanas_demora(
            manumoda.fn_plazo_maquilero(o.fecha_s1),
            COALESCE(o.fecha_entrega_real, r.ultima, CURRENT_DATE)
        ) AS semanas_demora,
        (COALESCE(o.fecha_entrega_real, r.ultima) IS NULL) AS sin_entrega,
        COALESCE(pm.monto, 500) AS monto_parcialidad,
        COALESCE(pa.monto, 500) AS monto_apartada,
        -- Una sola falta con dos formas: no apartar, o apartar y entregar en
        -- otra fecha. Sin entrega registrada no se juzga (b): no hay contra
        -- qué comparar todavía.
        (
          o.fecha_apartada_entrega IS NULL
          OR (
            COALESCE(o.fecha_entrega_real, r.ultima) IS NOT NULL
            AND COALESCE(o.fecha_entrega_real, r.ultima) <> o.fecha_apartada_entrega
          )
        ) AS incumple_fecha_apartada,
        COALESCE(sp.monto, 0)    AS valor_servicios_pagado
    FROM manumoda.ordenes_produccion o
    LEFT JOIN manumoda.maquileros m
      ON m.id = o.idmaquilero
    LEFT JOIN parametro pm
      ON pm.idempresa = o.idempresa
    LEFT JOIN param_apartada pa
      ON pa.idempresa = o.idempresa
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
        ROUND(b.parcialidades_excedentes * b.monto_parcialidad, 2)  AS valor_parcialidades,
        CASE WHEN b.incumple_fecha_apartada THEN b.monto_apartada ELSE 0 END
          AS valor_fecha_apartada
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
        (f.valor_no_entregadas + f.valor_demora + f.valor_parcialidades
         + f.valor_fecha_apartada + f.valor_penalizaciones_fijas)
          AS valor_penalizaciones_calculado,
        COALESCE(
          f.penalizacion_negociada,
          f.valor_no_entregadas + f.valor_demora + f.valor_parcialidades
            + f.valor_fecha_apartada + f.valor_penalizaciones_fijas
        ) AS valor_penalizaciones
    FROM final f
)
SELECT
    t.*,
    COALESCE(t.maquilero_catalogo, t.maquilero_nombre) AS beneficiario,
    (t.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (t.fecha_entrega_corregida IS NOT NULL)            AS entrega_corregida,
    (t.piezas_recibidas_ajuste IS NOT NULL)            AS recibidas_ajustadas,
    (t.piezas_cortadas_ajuste IS NOT NULL)             AS cortadas_ajustadas,
    (t.penalizacion_negociada IS NOT NULL)             AS penalizacion_es_negociada,
    (t.semanas_demora * 1.5)                           AS demora_pct,
    (t.costo_final - t.valor_penalizaciones)                   AS valor_a_pagar,
    (t.costo_final - t.valor_penalizaciones - t.valor_pagado)  AS saldo,
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
  'Cuenta por pagar al maquilero, una fila por folio. La penalización de '
  'fecha apartada aplica si no se apartó fecha o si se entregó en una '
  'distinta a la apartada.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. La regla de las dos condiciones. 0 filas.
SELECT folio, fecha_apartada_entrega, fecha_entrega_maquilero,
       incumple_fecha_apartada, valor_fecha_apartada
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND incumple_fecha_apartada <> (
        fecha_apartada_entrega IS NULL
        OR (fecha_entrega_maquilero IS NOT NULL
            AND fecha_entrega_maquilero <> fecha_apartada_entrega)
      );

-- 3. Quien apartó y entregó justo ese día NO debe penalizar. 0 filas.
SELECT folio, fecha_apartada_entrega, fecha_entrega_maquilero, valor_fecha_apartada
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND fecha_apartada_entrega IS NOT NULL
  AND fecha_entrega_maquilero = fecha_apartada_entrega
  AND valor_fecha_apartada <> 0;

-- 4. El reparto. Recién ejecutado nadie tiene fecha apartada, así que TODOS
--    los folios caen en la condición (a) y penalizan.
SELECT
  COUNT(*)                                                  AS folios,
  COUNT(*) FILTER (WHERE fecha_apartada_entrega IS NOT NULL) AS con_fecha_apartada,
  COUNT(*) FILTER (WHERE incumple_fecha_apartada)           AS penalizados,
  ROUND(SUM(valor_fecha_apartada), 2)                       AS descuento
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 5. Coherencia del cálculo: 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

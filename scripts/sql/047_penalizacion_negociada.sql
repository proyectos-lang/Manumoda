-- ============================================================
-- Penalización negociada: el monto final que se acuerda
--
-- QUÉ FALTABA:
--   El sistema calcula las penalizaciones por regla —demora, piezas
--   no entregadas, parcialidades, los conceptos fijos—, pero con el
--   maquilero se NEGOCIA. El monto acordado no siempre es el que
--   salió de la fórmula, y no había dónde registrarlo.
--
-- CÓMO FUNCIONA:
--   `penalizacion_negociada` es una SOBREESCRITURA, no un descuento
--   más. Si tiene valor, es el total de penalizaciones que se aplica
--   al folio; el cálculo por regla queda como referencia de lo que
--   se habría cobrado.
--
--       valor_penalizaciones = COALESCE(negociada, suma calculada)
--
--   Es el mismo patrón de `piezas_recibidas_ajuste` (script 038) y
--   `fecha_entrega_real` (035): dos columnas, no una. Guardar solo
--   el monto negociado borraría de dónde salió; que el negociado
--   mande permite corregir sin inventar penalizaciones.
--
--   Cero es un valor válido y significativo: "se negoció no cobrar
--   nada". Por eso la condición es IS NOT NULL, no > 0.
--
-- PREREQUISITO: scripts 027 a 046 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS penalizacion_negociada numeric(12,2);

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_penalizacion_negociada;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_penalizacion_negociada
  CHECK (penalizacion_negociada IS NULL OR penalizacion_negociada >= 0);

COMMENT ON COLUMN manumoda.ordenes_produccion.penalizacion_negociada IS
  'Total de penalizaciones acordado con el maquilero. Manda sobre la suma '
  'calculada por regla. NULL = se aplica lo calculado. 0 = se negoció no '
  'cobrar nada.';

-- ════════════════════════════════════════════════════════════════════════════
-- vw_pago_maquilas
-- ════════════════════════════════════════════════════════════════════════════

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
        GREATEST(
          0,
          COALESCE(o.piezas, 0) - COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0)
        ) AS piezas_no_entregadas,
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
  'Cuenta por pagar al maquilero, una fila por folio. '
  'valor_penalizaciones_calculado es lo que dicta la regla; '
  'valor_penalizaciones es lo que se aplica —el monto negociado si existe—. '
  'saldo_servicios es lo que se le debe a lavandería y demás, que se paga aparte.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Sin ninguna negociación capturada, lo aplicado debe ser igual a lo
--    calculado. 0 filas.
SELECT folio, valor_penalizaciones_calculado, valor_penalizaciones
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND penalizacion_negociada IS NULL
  AND abs(valor_penalizaciones - valor_penalizaciones_calculado) > 0.005;

-- 3. Donde SÍ hay negociación, debe mandar el negociado. 0 filas.
SELECT folio, penalizacion_negociada, valor_penalizaciones
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND penalizacion_negociada IS NOT NULL
  AND abs(valor_penalizaciones - penalizacion_negociada) > 0.005;

-- 4. Coherencia del cálculo: 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

-- 5. Estado de los pagos a servicios (lavandería).
SELECT
  COUNT(*) FILTER (WHERE valor_servicios > 0)            AS folios_con_servicios,
  ROUND(SUM(valor_servicios), 2)                         AS costo_servicios,
  ROUND(SUM(valor_servicios_pagado), 2)                  AS pagado,
  ROUND(SUM(saldo_servicios), 2)                         AS saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1;

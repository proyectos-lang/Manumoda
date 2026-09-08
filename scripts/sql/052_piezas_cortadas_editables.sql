-- ============================================================
-- Piezas cortadas editables a mano
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO EDITAR `piezas_cortadas`:
--   `ordenes_produccion.piezas_cortadas` la escribe la carga del
--   Excel en cada subida (excel-uploader: "el archivo también manda
--   sobre ella"). Si la edición manual escribiera ahí, la siguiente
--   carga la borraría sin avisar y el folio volvería a calcular con
--   el valor del archivo.
--
--   Se resuelve con una sobreescritura, no reemplazando el dato:
--
--     piezas cortadas = COALESCE(ajuste manual,
--                                las del Excel,
--                                las del plan de corte)
--
--   Dos columnas y no una porque son dos cosas distintas: lo que dijo
--   el archivo y lo que operación afirma que se cortó. Guardar solo el
--   ajuste borraría el dato original; que el ajuste mande permite
--   corregir sin pelear con cada recarga.
--
--   Es el mismo patrón de `piezas_recibidas_ajuste` (script 038) y
--   `fecha_entrega_real` (035).
--
-- LO QUE ALIMENTA:
--   Las piezas cortadas son la base del reclamo al maquilero
--   (script 051): faltantes = cortadas − recibidas, y eso se descuenta
--   a precio de venta. Poder corregirlas a mano es justamente lo que
--   destraba los 81 folios que hoy no descuentan por falta del dato.
--
-- PREREQUISITO: scripts 027 a 051 ejecutados.
-- ============================================================

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS piezas_cortadas_ajuste integer;

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_piezas_cortadas_ajuste;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_piezas_cortadas_ajuste
  CHECK (piezas_cortadas_ajuste IS NULL OR piezas_cortadas_ajuste >= 0);

COMMENT ON COLUMN manumoda.ordenes_produccion.piezas_cortadas_ajuste IS
  'Piezas cortadas fijadas a mano desde Pago Maquilas. Manda sobre las del '
  'Excel y sobre la suma del plan de corte. NULL = usar esas. Existe porque '
  'la carga del Excel reescribe piezas_cortadas en cada subida.';

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
        -- El ajuste manual manda; si no, lo del Excel; si no, el plan de corte
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
        -- Las faltantes salen de lo CORTADO, no de lo pedido (script 051).
        -- Sin cortadas —ni del Excel, ni del plan, ni a mano— no hay base
        -- para el reclamo y no se descuenta nada.
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
        (f.valor_no_entregadas + f.valor_demora + f.valor_parcialidades
         + f.valor_penalizaciones_fijas) AS valor_penalizaciones_calculado,
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
  'Cuenta por pagar al maquilero, una fila por folio. Las piezas cortadas '
  'salen del ajuste manual si existe, si no del Excel, si no del plan de '
  'corte; y son la base de las piezas no entregadas.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. La precedencia debe respetarse: ajuste > Excel > plan de corte. 0 filas.
SELECT v.folio, v.piezas_cortadas_ajuste, v.piezas_cortadas_excel, v.piezas_cortadas
FROM manumoda.vw_pago_maquilas v
WHERE v.idempresa = 1
  AND v.piezas_cortadas_ajuste IS NOT NULL
  AND v.piezas_cortadas <> v.piezas_cortadas_ajuste;

-- 3. Las faltantes siguen cuadrando con cortadas − recibidas. 0 filas.
SELECT folio, piezas_cortadas, piezas_recibidas, piezas_no_entregadas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND piezas_no_entregadas <> CASE
        WHEN piezas_cortadas = 0 THEN 0
        ELSE GREATEST(0, piezas_cortadas - piezas_recibidas)
      END;

-- 4. Recién ejecutado no hay ajustes, así que nada debe haber cambiado.
--    Esperado ≈ $28,579,218.20 en no entregadas, igual que tras el 051.
SELECT
  COUNT(*)                                          AS folios,
  COUNT(*) FILTER (WHERE cortadas_ajustadas)        AS con_ajuste_manual,
  COUNT(*) FILTER (WHERE piezas_cortadas = 0)       AS sin_cortadas,
  ROUND(SUM(valor_no_entregadas), 2)                AS descuento_faltantes
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 5. Coherencia del cálculo: 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

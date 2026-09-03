-- ============================================================
-- Parcialidades: $500 por cada entrega a partir de la cuarta
--
-- CAMBIO DE REGLA:
--   "Entrega en más de 3 parcialidades" era un check manual de monto
--   fijo ($500). Operación aclaró que hay folios que se entregan
--   hasta en 7 parcialidades y que el castigo es POR CADA UNA a
--   partir de la cuarta:
--
--       penalización = $500 × MAX(0, parcialidades − 3)
--
--       3 parcialidades → $0
--       4 parcialidades → $500
--       7 parcialidades → $2,000
--
--   Con un monto fijo, entregar en 4 y entregar en 7 costaba lo
--   mismo, que es justo lo que se quiere distinguir.
--
-- POR QUÉ PASA A SER AUTOMÁTICA:
--   El número de parcialidades ya está en `maquila_recepciones`: se
--   cuenta solo. Dejarla como check obligaba a contar entregas a
--   mano y permitía olvidarla. Se une a la demora y a las piezas no
--   entregadas.
--
--   El concepto manual se DESACTIVA, no se borra: los folios que lo
--   tuvieran marcado conservan su descuento congelado. Hoy no hay
--   ninguno.
--
-- SOBRE LOS DATOS FALTANTES:
--   La penalización sale de las entregas REGISTRADAS. Si un folio se
--   entregó en 7 parcialidades pero solo se capturaron 2, cobra $0.
--   Cobra de menos, nunca de más, y se corrige capturando las
--   entregas —que es lo que ya hace falta para el resto del cálculo.
--
-- ADEMÁS: se agrega el concepto manual "Sin entrega de muestra
-- original" ($500).
--
-- IMPACTO MEDIDO (idempresa 1, antes de ejecutar):
--   Ningún folio pasa hoy de 3 parcialidades registradas, así que la
--   penalización arranca en $0.00 y crecerá conforme se capturen las
--   entregas reales.
--
-- PREREQUISITO: scripts 027 a 045 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Catálogo: baja la de parcialidades, alta la de muestra original
-- ════════════════════════════════════════════════════════════════════════════

-- Deja de ofrecerse como check: ahora se calcula sola.
UPDATE manumoda.cat_penalizaciones_maquila
SET activo = false
WHERE idempresa = 1 AND clave = 'mas_3_parciales';

INSERT INTO manumoda.cat_penalizaciones_maquila (idempresa, clave, nombre, monto, orden)
VALUES (1, 'sin_muestra_original', 'Sin entrega de muestra original', 500.00, 40)
ON CONFLICT (idempresa, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. El monto por parcialidad excedente, configurable
--
--    Vive en el mismo catálogo que el resto: es un monto que operación
--    va a querer mover sin pedir un script, igual que los demás.
--    Se guarda desactivado para que no aparezca como check en la
--    pantalla del folio; solo se usa como parámetro.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO manumoda.cat_penalizaciones_maquila (idempresa, clave, nombre, monto, orden, activo)
VALUES (1, 'parcialidad_excedente',
        'Por cada parcialidad a partir de la cuarta (automática)', 500.00, 35, false)
ON CONFLICT (idempresa, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_pago_maquilas — la nueva automática entra al cálculo
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

CREATE VIEW manumoda.vw_pago_maquilas AS
WITH parametro AS (
    -- El monto por parcialidad excedente. Si alguien borra la fila, cae a 500.
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
        -- Cuántas veces entregó
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
        COALESCE(pm.monto, 500) AS monto_parcialidad
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
         + f.valor_penalizaciones_fijas) AS valor_penalizaciones
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
  'Cuenta por pagar al maquilero, una fila por folio. Penalizaciones: demora '
  '(1.5% semanal), piezas no entregadas (× precio de venta), parcialidades '
  'excedentes (a partir de la cuarta) y los conceptos fijos marcados a mano.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. La cuenta de parcialidades debe cuadrar con las entregas registradas,
--    y el excedente con MAX(0, n − 3). 0 filas.
SELECT v.folio, v.parcialidades, r.n, v.parcialidades_excedentes, v.valor_parcialidades
FROM manumoda.vw_pago_maquilas v
JOIN LATERAL (
  SELECT COUNT(*) AS n
  FROM manumoda.maquila_recepciones
  WHERE folio = v.folio AND idempresa = v.idempresa
) r ON true
WHERE v.idempresa = 1
  AND (v.parcialidades <> r.n
    OR v.parcialidades_excedentes <> GREATEST(0, r.n - 3)
    OR abs(v.valor_parcialidades - v.parcialidades_excedentes * 500) > 0.005);

-- 3. El catálogo: 'mas_3_parciales' inactiva, 'sin_muestra_original' activa,
--    'parcialidad_excedente' inactiva (es parámetro, no check).
SELECT clave, nombre, monto, orden, activo
FROM manumoda.cat_penalizaciones_maquila
WHERE idempresa = 1
ORDER BY orden;

-- 4. Reparto de las penalizaciones.
SELECT
  COUNT(*)                                          AS folios,
  COUNT(*) FILTER (WHERE parcialidades > 3)         AS con_exceso_parcialidades,
  ROUND(SUM(valor_no_entregadas), 2)                AS no_entregadas,
  ROUND(SUM(valor_demora), 2)                       AS demora,
  ROUND(SUM(valor_parcialidades), 2)                AS parcialidades,
  ROUND(SUM(valor_penalizaciones_fijas), 2)         AS fijas,
  ROUND(SUM(valor_penalizaciones), 2)               AS total
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 5. Coherencia del cálculo: 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

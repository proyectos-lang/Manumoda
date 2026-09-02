-- ============================================================
-- Penalizaciones manuales de monto fijo
--
-- QUÉ FALTABA:
--   El folio ya descuenta dos penalizaciones AUTOMÁTICAS —la demora
--   (1.5% semanal sobre la maquila) y las piezas no entregadas
--   (× precio de venta)—, pero operación aplica además conceptos de
--   MONTO FIJO que se marcan a mano: no entregó el packing list, no
--   apartó fecha de entrega, entregó en más de tres parcialidades.
--   No había dónde registrarlos.
--
-- POR QUÉ UN CATÁLOGO Y NO COLUMNAS:
--   Los conceptos cambian y sus montos también —hay tres más por
--   definir—. Con columnas, cada concepto nuevo sería una migración
--   y una publicación. Con catálogo se administran desde la app.
--
-- MODELO:
--   cat_penalizaciones_maquila   → el concepto y su monto vigente
--   maquila_penalizaciones_fijas → qué folio tiene cuál marcado
--
--   La fila EXISTE = la penalización aplica. No hay booleano que
--   pueda contradecir a la fila, y desmarcar es borrar.
--
--   `monto_aplicado` congela el monto del catálogo al momento de
--   marcarla. Sin eso, subir el monto de un concepto reescribiría
--   hacia atrás lo que ya se le descontó a un maquilero pagado.
--   Es el mismo criterio de `costo_maquila_aplicado` en maquila_pagos.
--
-- NO se toca `maquila_penalizaciones` (la vieja, por piezas). Quedó
-- huérfana cuando el script 033 volvió automáticas las no entregadas,
-- pero todavía tiene filas y borrarla no aporta nada hoy.
--
-- PREREQUISITO: scripts 027 a 039 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Catálogo de conceptos
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.cat_penalizaciones_maquila (
  id           serial PRIMARY KEY,
  idempresa    integer NOT NULL,
  clave        text    NOT NULL,
  nombre       text    NOT NULL,
  monto        numeric(12,2) NOT NULL,
  orden        integer NOT NULL DEFAULT 100,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cat_penal_monto CHECK (monto >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cat_penal_empresa_clave
  ON manumoda.cat_penalizaciones_maquila (idempresa, clave);

COMMENT ON TABLE manumoda.cat_penalizaciones_maquila IS
  'Conceptos de penalización de monto fijo que se marcan a mano en la '
  'gestión del folio. Se administran desde Pago Maquilas.';
COMMENT ON COLUMN manumoda.cat_penalizaciones_maquila.activo IS
  'Un concepto retirado se desactiva, no se borra: los folios que ya lo '
  'tienen marcado conservan su descuento.';

-- Los tres del mockup. Los montos son los que ahí aparecen; se ajustan
-- desde la app sin volver a correr esto.
INSERT INTO manumoda.cat_penalizaciones_maquila (idempresa, clave, nombre, monto, orden)
VALUES
  (1, 'sin_packing_list',  'Sin entrega de Packing List',        1000.00, 10),
  (1, 'sin_apartar_fecha', 'No apartó fecha de entrega',         1000.00, 20),
  (1, 'mas_3_parciales',   'Entrega en más de 3 parcialidades',  1000.00, 30)
ON CONFLICT (idempresa, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Penalizaciones marcadas por folio
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.maquila_penalizaciones_fijas (
  id             serial PRIMARY KEY,
  idempresa      integer NOT NULL,
  folio          text    NOT NULL,
  idpenalizacion integer NOT NULL REFERENCES manumoda.cat_penalizaciones_maquila(id),
  monto_aplicado numeric(12,2) NOT NULL,
  comentarios    text,
  capturado_por  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_penal_fija_monto CHECK (monto_aplicado >= 0)
);

-- Un concepto se marca una sola vez por folio
CREATE UNIQUE INDEX IF NOT EXISTS ux_penal_fija_folio_concepto
  ON manumoda.maquila_penalizaciones_fijas (idempresa, folio, idpenalizacion);

CREATE INDEX IF NOT EXISTS ix_penal_fija_empresa_folio
  ON manumoda.maquila_penalizaciones_fijas (idempresa, folio);

COMMENT ON TABLE manumoda.maquila_penalizaciones_fijas IS
  'Penalizaciones de monto fijo aplicadas a un folio. La fila existe = la '
  'penalización aplica; desmarcarla es borrarla.';
COMMENT ON COLUMN manumoda.maquila_penalizaciones_fijas.monto_aplicado IS
  'Monto del catálogo congelado al marcarla. Subir el monto del concepto no '
  'reescribe lo que ya se le descontó a un folio.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_pago_maquilas — las manuales entran al valor a pagar
--
--    Se recrea completa: una vista no se puede reordenar con CREATE OR
--    REPLACE, y hay columnas nuevas en medio del cálculo.
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
        COALESCE(o.piezas_recibidas_ajuste, r.piezas, 0) AS piezas_recibidas,
        COALESCE(r.piezas, 0)          AS piezas_recibidas_entregas,
        o.piezas_recibidas_ajuste,
        r.ultima                 AS ultima_recepcion,
        COALESCE(sv.valor, 0)    AS valor_servicios,
        COALESCE(g.monto, 0)     AS valor_pagado,
        COALESCE(g.adelantos, 0) AS valor_adelantos,
        g.ultima                 AS ultimo_pago,
        -- Penalizaciones de monto fijo marcadas a mano
        COALESCE(pf.monto, 0)    AS valor_penalizaciones_fijas,
        COALESCE(pf.cuantas, 0)  AS penalizaciones_fijas,
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
        -- La maquila va sobre las recibidas; cada servicio sobre sus procesadas
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
  'Cuenta por pagar al maquilero, una fila por folio. '
  'costo_final = recibidas × costo_maquila + Σ(procesadas × costo del servicio). '
  'valor_a_pagar = costo_final − no entregadas − demora − penalizaciones fijas.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. El catálogo sembrado.
SELECT clave, nombre, monto, orden, activo
FROM manumoda.cat_penalizaciones_maquila
WHERE idempresa = 1
ORDER BY orden;

-- 3. Sin ninguna penalización fija marcada todavía, el valor a pagar no debe
--    haberse movido: valor_penalizaciones = no entregadas + demora.
SELECT
  COUNT(*)                                              AS folios,
  COUNT(*) FILTER (WHERE penalizaciones_fijas > 0)      AS con_penal_fija,
  ROUND(SUM(valor_no_entregadas), 2)                    AS no_entregadas,
  ROUND(SUM(valor_demora), 2)                           AS demora,
  ROUND(SUM(valor_penalizaciones_fijas), 2)             AS fijas,
  ROUND(SUM(valor_penalizaciones), 2)                   AS total_penalizaciones
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

-- 4. Coherencia del cálculo: debe devolver 0 filas.
SELECT folio, costo_final, valor_penalizaciones, valor_a_pagar, valor_pagado, saldo
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND (abs(valor_a_pagar - (costo_final - valor_penalizaciones)) > 0.005
    OR abs(saldo - (valor_a_pagar - valor_pagado)) > 0.005);

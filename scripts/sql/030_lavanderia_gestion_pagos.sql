-- ============================================================
-- Lavandería: gestión completa de pagos
--
-- PROBLEMA: la lavandería solo tenía unidades enviadas y una
-- marca de pagado/no pagado. No se podía registrar lo que
-- regresó, ni abonos parciales, ni ver un saldo.
--
-- DISEÑO: se le da el mismo tratamiento que al maquilero.
--   · `piezas_lavanderia`           — unidades enviadas
--   · `piezas_lavanderia_recibidas` — unidades que regresaron
--   · `lavanderia_pagos`            — abonos, con su historial
--
--   El importe se calcula sobre las RECIBIDAS: se le paga a la
--   lavandería por lo que efectivamente devolvió. La diferencia
--   contra lo enviado queda visible como merma.
--
--   La marca `fecha_pago_lavanderia` deja de usarse: convivir
--   una bandera con una tabla de pagos son dos fuentes de verdad
--   que se contradicen. "Pagada" pasa a derivarse del saldo.
--   La columna se conserva (estaba vacía) para no romper nada.
--
-- PREREQUISITO: scripts 027, 028 y 029 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Unidades que regresaron de lavandería
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS piezas_lavanderia_recibidas integer;

COMMENT ON COLUMN manumoda.ordenes_produccion.piezas_lavanderia_recibidas IS
  'Unidades que la lavandería devolvió. Es la base de lo que se le paga; '
  'la diferencia contra piezas_lavanderia (enviadas) es la merma.';

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_piezas_lav_recibidas;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_piezas_lav_recibidas
  CHECK (piezas_lavanderia_recibidas IS NULL OR piezas_lavanderia_recibidas >= 0);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Pagos a la lavandería
--
--    Tabla propia y no un `tipo` dentro de maquila_pagos: es otro
--    acreedor, con su propio saldo. Mezclarlos obligaría a filtrar
--    en cada consulta y un olvido pagaría de una bolsa la deuda
--    de la otra.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.lavanderia_pagos (
    id            bigserial     PRIMARY KEY,
    idempresa     integer       NOT NULL DEFAULT 1,
    folio         text          NOT NULL,
    fecha         date          NOT NULL DEFAULT CURRENT_DATE,
    monto         numeric(12,2) NOT NULL,
    referencia    text,
    comentarios   text,
    capturado_por text,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_lav_pago_monto CHECK (monto > 0),
    CONSTRAINT fk_lav_pago_orden
      FOREIGN KEY (idempresa, folio)
      REFERENCES manumoda.ordenes_produccion (idempresa, folio)
      ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE manumoda.lavanderia_pagos IS
  'Abonos a la lavandería, uno por transferencia. Admite pagos parciales.';

CREATE INDEX IF NOT EXISTS idx_lavanderia_pagos_folio
  ON manumoda.lavanderia_pagos (idempresa, folio);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lavanderia_pagos_referencia
  ON manumoda.lavanderia_pagos (idempresa, referencia)
  WHERE referencia IS NOT NULL AND btrim(referencia) <> '';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_pago_maquilas — bloque de lavandería con su propio saldo
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_pago_maquilas;

CREATE VIEW manumoda.vw_pago_maquilas AS
WITH agregados AS (
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
        o.piezas               AS piezas_orden,
        o.costo_maquila,
        o.costo_lavanderia,
        o.precio_venta,
        o.precio_publico,
        -- ── Maquila ──
        COALESCE(r.piezas, 0)  AS piezas_recibidas,
        r.ultima               AS ultima_recepcion,
        COALESCE(p.piezas, 0)  AS piezas_penalizadas,
        COALESCE(g.monto, 0)   AS valor_pagado,
        g.ultima               AS ultimo_pago,
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS valor_maquila,
        ROUND(COALESCE(p.piezas, 0) * COALESCE(o.precio_venta, 0), 2)  AS valor_penalizaciones,
        -- ── Lavandería ──
        COALESCE(o.piezas_lavanderia, 0)           AS piezas_lavanderia,
        COALESCE(o.piezas_lavanderia_recibidas, 0) AS piezas_lavanderia_recibidas,
        COALESCE(lp.monto, 0)                      AS lavanderia_pagado,
        lp.ultima                                  AS ultimo_pago_lavanderia,
        -- Se paga por lo que la lavandería devolvió
        ROUND(COALESCE(o.piezas_lavanderia_recibidas, 0) * COALESCE(o.costo_lavanderia, 0), 2)
                                                   AS valor_lavanderia
    FROM manumoda.ordenes_produccion o
    LEFT JOIN manumoda.maquileros m
      ON m.id = o.idmaquilero
    LEFT JOIN LATERAL (
        SELECT SUM(piezas) AS piezas, MAX(fecha) AS ultima
        FROM manumoda.maquila_recepciones
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) r ON true
    LEFT JOIN LATERAL (
        SELECT SUM(piezas) AS piezas
        FROM manumoda.maquila_penalizaciones
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) p ON true
    LEFT JOIN LATERAL (
        SELECT SUM(monto) AS monto, MAX(fecha) AS ultima
        FROM manumoda.maquila_pagos
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) g ON true
    LEFT JOIN LATERAL (
        SELECT SUM(monto) AS monto, MAX(fecha) AS ultima
        FROM manumoda.lavanderia_pagos
        WHERE folio = o.folio AND idempresa = o.idempresa
    ) lp ON true
)
SELECT
    a.*,
    COALESCE(a.maquilero_catalogo, a.maquilero_nombre) AS beneficiario,
    (a.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (a.piezas_penalizadas > a.piezas_recibidas)        AS penalizadas_exceden_recibidas,
    (a.valor_maquila - a.valor_penalizaciones)         AS valor_a_pagar,
    (a.valor_maquila - a.valor_penalizaciones - a.valor_pagado) AS saldo,
    CASE
        WHEN a.costo_maquila IS NULL                                     THEN 'Sin costo'
        WHEN a.piezas_recibidas = 0                                      THEN 'Sin recepción'
        WHEN (a.valor_maquila - a.valor_penalizaciones - a.valor_pagado)
             < -0.005                                                    THEN 'Sobrepagado'
        WHEN abs(a.valor_maquila - a.valor_penalizaciones - a.valor_pagado)
             < 0.005                                                     THEN 'Saldado'
        WHEN a.valor_pagado > 0                                          THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_pago,
    -- ── Lavandería: mismo modelo de saldo y estado ──
    (a.valor_lavanderia - a.lavanderia_pagado)         AS saldo_lavanderia,
    (a.piezas_lavanderia - a.piezas_lavanderia_recibidas) AS merma_lavanderia,
    (a.valor_lavanderia > 0
      AND abs(a.valor_lavanderia - a.lavanderia_pagado) < 0.005)         AS lavanderia_pagada,
    CASE
        WHEN a.costo_lavanderia IS NULL                                  THEN 'Sin valor'
        WHEN a.piezas_lavanderia_recibidas = 0                           THEN 'Sin recepción'
        WHEN (a.valor_lavanderia - a.lavanderia_pagado) < -0.005         THEN 'Sobrepagado'
        WHEN abs(a.valor_lavanderia - a.lavanderia_pagado) < 0.005       THEN 'Saldado'
        WHEN a.lavanderia_pagado > 0                                     THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado_lavanderia
FROM agregados a;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Libro mayor por folio de las dos cuentas por pagar: maquilero '
  '(recibidas x costo_maquila menos penalizaciones) y lavandería '
  '(recibidas de lavandería x costo_lavanderia). Cada una con su valor, '
  'pagado, saldo y estado. Los importes se derivan de los valores vigentes '
  'de la orden; solo los pagos son cifras guardadas.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una fila por folio: debe devolver 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 2. Estado de la cuenta de lavandería.
SELECT estado_lavanderia, COUNT(*) AS folios
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND costo_lavanderia IS NOT NULL
GROUP BY estado_lavanderia
ORDER BY 2 DESC;

-- 3. Folios con merma: se envió más de lo que regresó.
SELECT folio, piezas_lavanderia AS enviadas,
       piezas_lavanderia_recibidas AS recibidas, merma_lavanderia
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND merma_lavanderia > 0
ORDER BY merma_lavanderia DESC
LIMIT 20;

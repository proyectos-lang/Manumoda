-- ============================================================
-- Lavandería: unidades propias
--
-- PROBLEMA: el importe de lavandería se calculaba sobre las
-- piezas recibidas del maquilero. Pero la lavandería es otro
-- proveedor y su cantidad no tiene por qué coincidir: se le
-- manda un lote y lo que devuelve el maquilero es otra cosa.
--
-- SOLUCIÓN: un campo propio, `piezas_lavanderia`, donde se
-- registra cuántas unidades se pasaron a lavandería. El importe
-- pasa a ser `piezas_lavanderia × costo_lavanderia`.
--
-- Efecto: los folios que hoy tienen valor de lavandería quedarán
-- en $0 hasta que se capturen sus unidades. Es correcto — antes
-- el número salía de una cantidad que no era la suya.
--
-- NOTA sobre DROP VIEW: el resto del proyecto evita DROP porque
-- arrastra vistas dependientes (ver script 013). Aquí es seguro:
-- vw_pago_maquilas es nueva y nada depende de ella. Se recrea en
-- vez de reemplazar porque hay una columna nueva que debe quedar
-- junto a las demás y CREATE OR REPLACE no permite reordenar.
--
-- PREREQUISITO: scripts 027 y 028 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. El campo
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS piezas_lavanderia integer;

COMMENT ON COLUMN manumoda.ordenes_produccion.piezas_lavanderia IS
  'Unidades que se pasaron a lavandería. Es la base de lo que se le paga '
  'a ese proveedor: no tiene por qué coincidir con las piezas recibidas '
  'del maquilero.';

ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_piezas_lavanderia;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_piezas_lavanderia
  CHECK (piezas_lavanderia IS NULL OR piezas_lavanderia >= 0);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_pago_maquilas — lavandería sobre sus propias unidades
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
        o.fecha_pago_lavanderia,
        o.piezas               AS piezas_orden,
        o.costo_maquila,
        o.costo_lavanderia,
        o.precio_venta,
        o.precio_publico,
        COALESCE(o.piezas_lavanderia, 0) AS piezas_lavanderia,
        COALESCE(r.piezas, 0)  AS piezas_recibidas,
        r.ultima               AS ultima_recepcion,
        COALESCE(p.piezas, 0)  AS piezas_penalizadas,
        COALESCE(g.monto, 0)   AS valor_pagado,
        g.ultima               AS ultimo_pago,
        -- Redondeo a 2 decimales una sola vez, aquí
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2) AS valor_maquila,
        ROUND(COALESCE(p.piezas, 0) * COALESCE(o.precio_venta, 0), 2)  AS valor_penalizaciones,
        -- Lavandería sobre SUS unidades, no sobre lo recibido del maquilero
        ROUND(COALESCE(o.piezas_lavanderia, 0) * COALESCE(o.costo_lavanderia, 0), 2)
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
)
SELECT
    a.*,
    COALESCE(a.maquilero_catalogo, a.maquilero_nombre) AS beneficiario,
    (a.costo_maquila IS NOT NULL)                      AS costo_capturado,
    (a.fecha_pago_lavanderia IS NOT NULL)              AS lavanderia_pagada,
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
    END AS estado_pago
FROM agregados a;

COMMENT ON VIEW manumoda.vw_pago_maquilas IS
  'Libro mayor de cuentas por pagar a maquileros: una fila por folio con '
  'piezas recibidas, penalizaciones, valor a pagar, pagado y saldo. '
  'Los importes se derivan de los valores vigentes de la orden; solo los '
  'pagos son cifras guardadas. La lavandería se calcula sobre sus propias '
  'unidades (piezas_lavanderia), no sobre lo recibido del maquilero.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Folios con valor de lavandería pero sin unidades capturadas.
--    Su importe es $0 hasta que se registren; hay que capturarlas.
SELECT COUNT(*) AS sin_unidades_lavanderia
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
  AND costo_lavanderia IS NOT NULL
  AND piezas_lavanderia = 0;

-- 2. La vista sigue devolviendo una fila por folio: debe dar 0 filas.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

-- 3. Cobertura de los valores unitarios.
SELECT
  COUNT(*)                              AS folios_con_maquilero,
  COUNT(costo_maquila)                  AS con_valor_maquila,
  COUNT(costo_lavanderia)               AS con_valor_lavanderia,
  COUNT(precio_venta)                   AS con_precio_venta
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL;

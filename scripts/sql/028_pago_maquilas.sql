-- ============================================================
-- Pago Maquilas — recepciones, penalizaciones y pagos
--
-- CONTEXTO: hasta ahora no existía ninguna tabla de dinero en la
-- base. Este script crea el libro de cuentas por pagar a los
-- maquileros: cuánta mercancía se recibió por folio, qué
-- penalizaciones hubo por producto malo, y qué se ha pagado.
--
-- DISEÑO:
--   · Los importes NO se guardan, se derivan. El costo unitario
--     vive en la orden y el total sale de multiplicarlo por las
--     piezas recibidas — así un costo corregido en el Excel se
--     refleja sin reescribir históricos. Fue decisión explícita
--     del cliente ("se recalcula todo"), asumiendo que un costo a
--     la baja puede dejar un folio sobrepagado.
--   · Lo único inmutable es `maquila_pagos.monto`: lo que de
--     verdad se transfirió. Junto a él se guarda el costo unitario
--     vigente al pagar, para que el sobrepago quede auditable.
--   · Redondeo a 2 decimales UNA sola vez, a nivel folio. Los
--     unitarios llevan 4 decimales; si los derivados arrastraran
--     esa precisión, `saldo = 0` casi nunca se cumpliría por
--     residuos y ningún folio quedaría marcado como saldado.
--
-- PREREQUISITO: script 027 ejecutado (columnas de costo y el
-- índice único de (idempresa, folio), que este script referencia).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Órdenes: lavandería, vínculo al catálogo y cordura de los costos
-- ════════════════════════════════════════════════════════════════════════════

-- Una sola columna, no un par booleano+fecha que puedan contradecirse.
-- Mismo precedente que fecha_facturacion (script 016).
ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS fecha_pago_lavanderia date;

COMMENT ON COLUMN manumoda.ordenes_produccion.fecha_pago_lavanderia IS
  'Fecha en que se le pagó a la lavandería. Si tiene valor, está pagada. '
  'La lavandería es un tercero: no se mezcla con el pago al maquilero.';

-- El maquilero se guardaba solo como texto libre, sin validar contra el
-- catálogo. Para pagar hace falta un beneficiario estable: un typo parte a
-- una persona en dos y le calcula dos saldos distintos.
ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS idmaquilero integer REFERENCES manumoda.maquileros (id);

COMMENT ON COLUMN manumoda.ordenes_produccion.idmaquilero IS
  'Maquilero del catálogo. Se resuelve por nombre al cargar el Excel; '
  'la columna de texto `maquilero` se conserva como lo que dijo el archivo.';

-- Backfill re-ejecutable: solo toca lo que aún no está vinculado, para poder
-- correrlo otra vez después de dar de alta un maquilero que faltaba.
-- Sin `unaccent` (es una extensión que puede no estar instalada).
UPDATE manumoda.ordenes_produccion o
SET idmaquilero = m.id
FROM manumoda.maquileros m
WHERE o.idmaquilero IS NULL
  AND o.maquilero IS NOT NULL
  AND m.idempresa = o.idempresa
  AND upper(trim(regexp_replace(m.nombre,   '\s+', ' ', 'g')))
    = upper(trim(regexp_replace(o.maquilero, '\s+', ' ', 'g')));

-- Un costo negativo es un typo del archivo, no un precio.
ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_op_montos_no_negativos;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_op_montos_no_negativos
  CHECK (
        COALESCE(costo_maquila,    0) >= 0
    AND COALESCE(costo_lavanderia, 0) >= 0
    AND COALESCE(precio_venta,     0) >= 0
    AND COALESCE(precio_publico,   0) >= 0
  );

CREATE INDEX IF NOT EXISTS idx_ordenes_maquilero
  ON manumoda.ordenes_produccion (idempresa, maquilero);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Recepciones de mercancía
--
--    Se capturan a mano: `fecha` es la fecha de negocio que teclea
--    quien recibe; `created_at` es cuándo se guardó. Son cosas
--    distintas y ambas hacen falta para auditar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.maquila_recepciones (
    id            bigserial   PRIMARY KEY,
    idempresa     integer     NOT NULL DEFAULT 1,
    folio         text        NOT NULL,
    fecha         date        NOT NULL DEFAULT CURRENT_DATE,
    piezas        integer     NOT NULL,
    comentarios   text,
    capturado_por text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_recepcion_piezas CHECK (piezas > 0),
    CONSTRAINT fk_recepcion_orden
      FOREIGN KEY (idempresa, folio)
      REFERENCES manumoda.ordenes_produccion (idempresa, folio)
      ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE manumoda.maquila_recepciones IS
  'Entregas de mercancía del maquilero, una fila por recepción parcial. '
  'La suma de piezas es la base del cálculo de lo que se le paga.';

CREATE INDEX IF NOT EXISTS idx_maquila_recepciones_folio
  ON manumoda.maquila_recepciones (idempresa, folio);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Penalizaciones por producto malo
--
--    Solo se guardan las piezas: el importe se deriva de
--    precio_venta vigente, coherente con "se recalcula todo".
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.maquila_penalizaciones (
    id            bigserial   PRIMARY KEY,
    idempresa     integer     NOT NULL DEFAULT 1,
    folio         text        NOT NULL,
    fecha         date        NOT NULL DEFAULT CURRENT_DATE,
    piezas        integer     NOT NULL,
    motivo        text        NOT NULL,
    comentarios   text,
    capturado_por text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_penalizacion_piezas CHECK (piezas > 0),
    CONSTRAINT chk_penalizacion_motivo CHECK (btrim(motivo) <> ''),
    CONSTRAINT fk_penalizacion_orden
      FOREIGN KEY (idempresa, folio)
      REFERENCES manumoda.ordenes_produccion (idempresa, folio)
      ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE manumoda.maquila_penalizaciones IS
  'Piezas defectuosas que se le descuentan al maquilero. El importe se '
  'calcula como piezas × precio_venta de la orden. El motivo es obligatorio: '
  'un descuento de dinero sin motivo no es auditable.';

CREATE INDEX IF NOT EXISTS idx_maquila_penalizaciones_folio
  ON manumoda.maquila_penalizaciones (idempresa, folio);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Pagos al maquilero
--
--    El monto es un HECHO: lo que se transfirió. No se recalcula
--    nunca y no debería editarse — para corregir, se borra y se
--    vuelve a capturar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.maquila_pagos (
    id                     bigserial     PRIMARY KEY,
    idempresa              integer       NOT NULL DEFAULT 1,
    folio                  text          NOT NULL,
    fecha                  date          NOT NULL DEFAULT CURRENT_DATE,
    monto                  numeric(12,2) NOT NULL,
    referencia             text,
    costo_maquila_aplicado numeric(12,4),
    comentarios            text,
    capturado_por          text,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_pago_monto CHECK (monto > 0),
    CONSTRAINT fk_pago_orden
      FOREIGN KEY (idempresa, folio)
      REFERENCES manumoda.ordenes_produccion (idempresa, folio)
      ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE manumoda.maquila_pagos IS
  'Abonos al maquilero, uno por transferencia. Admite pagos parciales. '
  'El monto no se recalcula nunca.';

COMMENT ON COLUMN manumoda.maquila_pagos.costo_maquila_aplicado IS
  'Costo unitario vigente en el momento de pagar. Si el Excel cambia el '
  'costo después, esta columna deja rastro de con qué cifra se pagó.';

CREATE INDEX IF NOT EXISTS idx_maquila_pagos_folio
  ON manumoda.maquila_pagos (idempresa, folio);

-- Una referencia de transferencia repetida es, casi siempre, un pago
-- capturado dos veces — la causa número uno de sobrepago.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maquila_pagos_referencia
  ON manumoda.maquila_pagos (idempresa, referencia)
  WHERE referencia IS NOT NULL AND btrim(referencia) <> '';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Protección: no borrar lo que ya sostiene un pago
--
--    Borrar una recepción baja retroactivamente el valor a pagar y
--    puede voltear un folio saldado a sobrepagado. Se prohíbe en la
--    base y no solo en la interfaz: sin RLS, un guardarraíl de UI es
--    una sugerencia. Antes del primer pago se edita y borra libre.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_bloquear_borrado_con_pagos()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pagos numeric;
BEGIN
  SELECT COALESCE(SUM(monto), 0) INTO v_pagos
  FROM manumoda.maquila_pagos
  WHERE folio = OLD.folio AND idempresa = OLD.idempresa;

  IF v_pagos > 0 THEN
    RAISE EXCEPTION
      'El folio % ya tiene pagos registrados (%). Elimina primero los pagos si necesitas corregir.',
      OLD.folio, v_pagos
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_bloquear_borrado_con_pagos() IS
  'Impide borrar recepciones o penalizaciones de un folio que ya tiene pagos: '
  'alteraría el valor a pagar de algo ya liquidado.';

DROP TRIGGER IF EXISTS trg_recepcion_no_borrar_con_pagos ON manumoda.maquila_recepciones;
CREATE TRIGGER trg_recepcion_no_borrar_con_pagos
  BEFORE DELETE ON manumoda.maquila_recepciones
  FOR EACH ROW EXECUTE FUNCTION manumoda.fn_bloquear_borrado_con_pagos();

DROP TRIGGER IF EXISTS trg_penalizacion_no_borrar_con_pagos ON manumoda.maquila_penalizaciones;
CREATE TRIGGER trg_penalizacion_no_borrar_con_pagos
  BEFORE DELETE ON manumoda.maquila_penalizaciones
  FOR EACH ROW EXECUTE FUNCTION manumoda.fn_bloquear_borrado_con_pagos();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. vw_pago_maquilas — el libro mayor, una fila por folio
--
--    Las tres tablas hijas se agregan con LEFT JOIN LATERAL. Con
--    tres LEFT JOIN planos habría producto cartesiano —3 recepciones
--    × 2 pagos = 6 filas— y los importes saldrían multiplicados.
--    Una subconsulta de solo agregados y SIN group by devuelve
--    siempre exactamente una fila: no agregar GROUP BY ahí dentro.
--
--    Sin WHERE: filtrar por `maquilero IS NOT NULL` haría que un
--    folio con pagos desapareciera —con su dinero adentro— si
--    alguien vacía ese campo de texto. La vista es el libro mayor;
--    el filtro vive en la interfaz.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_pago_maquilas AS
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
        COALESCE(r.piezas, 0)  AS piezas_recibidas,
        r.ultima               AS ultima_recepcion,
        COALESCE(p.piezas, 0)  AS piezas_penalizadas,
        COALESCE(g.monto, 0)   AS valor_pagado,
        g.ultima               AS ultimo_pago,
        -- Redondeo a 2 decimales una sola vez, aquí
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_maquila, 0), 2)    AS valor_maquila,
        ROUND(COALESCE(p.piezas, 0) * COALESCE(o.precio_venta, 0), 2)     AS valor_penalizaciones,
        ROUND(COALESCE(r.piezas, 0) * COALESCE(o.costo_lavanderia, 0), 2) AS valor_lavanderia
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
    -- El beneficiario que ve el usuario: el del catálogo si resolvió,
    -- si no el texto del Excel. Así los huérfanos siguen agrupando.
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
  'Los importes se derivan del costo vigente de la orden; solo los pagos '
  'son cifras guardadas.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Maquileros de las órdenes que NO están en el catálogo.
--    Sus folios se agrupan por el texto del Excel, no por el catálogo.
--    Para resolverlos: darlos de alta en Configuración → Maquileros y
--    volver a correr el UPDATE de backfill de la sección 1.
SELECT DISTINCT o.maquilero, COUNT(*) AS folios
FROM manumoda.ordenes_produccion o
WHERE o.maquilero IS NOT NULL
  AND o.idmaquilero IS NULL
GROUP BY o.maquilero
ORDER BY 2 DESC;

-- 2. Cobertura del vínculo al catálogo.
SELECT
  COUNT(*) FILTER (WHERE maquilero IS NOT NULL)     AS con_maquilero,
  COUNT(*) FILTER (WHERE idmaquilero IS NOT NULL)   AS vinculados,
  COUNT(*) FILTER (WHERE maquilero IS NOT NULL
                     AND idmaquilero IS NULL)       AS sin_vincular
FROM manumoda.ordenes_produccion
WHERE idempresa = 1;

-- 3. Estado del libro mayor. Recién aplicado, todo debe salir en
--    "Sin costo" o "Sin recepción": aún no se ha capturado nada.
SELECT estado_pago, COUNT(*) AS folios
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1 AND maquilero_nombre IS NOT NULL
GROUP BY estado_pago
ORDER BY 2 DESC;

-- 4. Una fila por folio: debe devolver 0 filas.
--    Si devuelve alguna, hay doble conteo de dinero.
SELECT folio, COUNT(*) AS filas
FROM manumoda.vw_pago_maquilas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) > 1;

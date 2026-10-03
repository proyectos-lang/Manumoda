-- ============================================================
-- Dos etapas más: Entrega de maquila (S7) y Programar despacho a cliente
--
-- QUÉ SE AGREGA, DESPUÉS DE LA 9 (Entrega a maquilero):
--   10 · Entrega de maquila — el maquilero entrega la producción
--        terminada. Es el estatus 7 de Seguimiento Maquila: se completa
--        sola cuando ahí se captura `fecha_s7`, y no se edita en Panel
--        General para que las dos pantallas no se contradigan.
--   11 · Programar despacho a cliente — el día y la hora en que se
--        despacha al cliente. Se captura en Panel General, y el
--        calendario de recepciones lo pinta junto a las entregas de los
--        maquileros, en otro color (operación, 02-oct-2026).
--
-- DÓNDE VIVE EL DESPACHO:
--   En la orden, no en `orden_etapas`. El calendario ya lee de la orden
--   el apartado del maquilero (`fecha_apartada_entrega` + su hora), y
--   así los dos salen del mismo sitio con la misma forma. `time` y no
--   `timestamp`, por lo mismo que en el 078: el día ya está en la otra
--   columna y guardarlo dos veces invita a que se contradigan.
--
-- CUÁNDO SE COMPLETA EL DESPACHO:
--   Con `fecha_facturacion`. Es la señal que todo el sistema ya usa para
--   "entregada" —Master Tracking, el calendario, los días restantes— y
--   en la base es consistente: 105 facturadas y ninguna sin S7.
--   Programar el despacho lo pone "En proceso"; una fecha ya pasada NO
--   lo completa sola, porque programar no es despachar.
--
-- POR QUÉ LAS OTRAS DOS VISTAS QUEDAN IGUALES:
--   `vw_orden_avance` y `vw_etapas_cola` son genéricas sobre el
--   catálogo: cuentan y encadenan las etapas que haya. Se recrean
--   porque dependen de `vw_orden_etapas` y esta se borra, pero son las
--   mismas del script 063, línea por línea.
--
-- POR QUÉ DROP Y NO CREATE OR REPLACE:
--   A `vw_orden_etapas` solo se le agregan columnas al final, que con
--   REPLACE bastaría; pero las otras dos dependen de ella y el script
--   063 fijó el patrón de borrar las tres y recrearlas. Se repite igual
--   para no tener dos maneras de hacer lo mismo.
--
-- PREREQUISITO: scripts 063 y 078 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Dónde se guarda el despacho
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS fecha_despacho_cliente date;

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS hora_despacho_cliente time;

COMMENT ON COLUMN manumoda.ordenes_produccion.fecha_despacho_cliente IS
  'Día programado para despachar al cliente (etapa 11). Lo pinta el '
  'calendario de recepciones junto a las entregas de los maquileros.';

COMMENT ON COLUMN manumoda.ordenes_produccion.hora_despacho_cliente IS
  'Hora del despacho, para el cronograma del día. Opcional: sin ella el '
  'despacho es "sin hora", no a medianoche.';

-- Una hora sin su día no significa nada: sería un despacho flotante que
-- el calendario no sabría dónde poner. Mismo criterio que el apartado.
ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_hora_despacho_requiere_fecha;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_hora_despacho_requiere_fecha
  CHECK (hora_despacho_cliente IS NULL OR fecha_despacho_cliente IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Las dos etapas en el catálogo
--
--    Mismo ON CONFLICT que el 056: repetir el script no duplica.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO manumoda.cat_etapas_produccion
  (idempresa, numero, clave, nombre, descripcion, gestion_externa, modulo)
VALUES
  (1, 10, 'entrega_maquila',  'Entrega de maquila (S7)',
   'El maquilero entrega la producción terminada; es el estatus 7 de Seguimiento Maquila',
   true, 'seguimiento'),
  (1, 11, 'despacho_cliente', 'Programar despacho a cliente',
   'Día y hora en que se despacha al cliente; alimenta el calendario de recepciones',
   false, NULL)
ON CONFLICT (idempresa, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Las vistas: se borran las tres y se recrean, como en el 063
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_etapas_cola;
DROP VIEW IF EXISTS manumoda.vw_orden_avance;
DROP VIEW IF EXISTS manumoda.vw_orden_etapas;

CREATE VIEW manumoda.vw_orden_etapas AS
SELECT
    o.idempresa,
    o.folio,
    o.modelo,
    o.cliente,
    o.fase_actual,
    o.fecha_pedido,
    o.fecha_cancelacion,
    o.piezas,
    e.id                       AS idetapa,
    e.numero,
    e.clave,
    e.nombre                   AS etapa,
    e.gestion_externa,
    e.modulo,
    -- OJO CON EL ORDEN: "Completada" va ANTES que "No aplica", igual que en
    -- Panel General. Si quedó constancia de que la etapa ocurrió, la etapa
    -- se hizo, aunque la orden diga que no la requería.
    CASE e.clave
      WHEN 'diseno' THEN
        CASE
          WHEN o.fecha_aprobacion_diseno IS NOT NULL THEN 'Completada'
          WHEN o.no_requiere_diseno            THEN 'No aplica'
          WHEN o.diseno_programado             THEN 'En proceso'
          ELSE 'Pendiente'
        END
      WHEN 'corte' THEN
        CASE
          WHEN cp.cumplido                     THEN 'Completada'
          WHEN o.no_requiere_corte             THEN 'No aplica'
          WHEN o.corte_programado              THEN 'En proceso'
          ELSE 'Pendiente'
        END
      WHEN 'entrega_s1' THEN
        CASE
          WHEN o.fecha_s1 IS NOT NULL          THEN 'Completada'
          WHEN o.maquilero IS NOT NULL         THEN 'En proceso'
          ELSE 'Pendiente'
        END
      -- Etapa 10: el estatus 7 de maquila. Entre S1 y S7 la prenda está
      -- en el taller, que es "En proceso" para esta etapa.
      WHEN 'entrega_maquila' THEN
        CASE
          WHEN o.fecha_s7 IS NOT NULL          THEN 'Completada'
          WHEN o.fecha_s1 IS NOT NULL          THEN 'En proceso'
          ELSE 'Pendiente'
        END
      -- Etapa 11: programar no es despachar. Solo la factura la cierra;
      -- una fecha programada, aunque ya haya pasado, la deja En proceso.
      WHEN 'despacho_cliente' THEN
        CASE
          WHEN o.fecha_facturacion IS NOT NULL      THEN 'Completada'
          WHEN o.fecha_despacho_cliente IS NOT NULL THEN 'En proceso'
          ELSE 'Pendiente'
        END
      ELSE COALESCE(oe.estado::text, 'Pendiente')
    END                        AS estado,
    CASE e.clave
      WHEN 'diseno'           THEN o.fecha_aprobacion_diseno
      WHEN 'corte'            THEN cp.fecha_corte
      WHEN 'entrega_s1'       THEN o.fecha_s1
      WHEN 'entrega_maquila'  THEN o.fecha_s7
      WHEN 'despacho_cliente' THEN o.fecha_facturacion
      ELSE oe.fecha_completada
    END                        AS fecha_completada,
    oe.fecha_inicio,
    oe.responsable,
    oe.notas,
    COALESCE(oe.datos, '{}'::jsonb) AS datos,
    oe.capturado_por,
    oe.updated_at,
    (oe.id IS NOT NULL)        AS tiene_registro,

    -- ── Agregadas al final (script 079) ──
    -- Lo que la hoja de etapas necesita mostrar en las dos nuevas sin
    -- otra consulta: desde cuándo está en maquila, cuándo entregó, y
    -- qué despacho hay programado.
    o.fecha_s1,
    o.fecha_s7,
    o.fecha_despacho_cliente,
    o.hora_despacho_cliente
FROM manumoda.ordenes_produccion o
CROSS JOIN manumoda.cat_etapas_produccion e
LEFT JOIN manumoda.orden_etapas oe
  ON oe.folio = o.folio
 AND oe.idempresa = o.idempresa
 AND oe.idetapa = e.id
LEFT JOIN LATERAL (
    SELECT bool_or(cumplimiento_corte = 'Si') AS cumplido,
           MAX(fecha) FILTER (WHERE cumplimiento_corte = 'Si') AS fecha_corte
    FROM manumoda.corte_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
) cp ON true
WHERE e.idempresa = o.idempresa
  AND e.activo;

COMMENT ON VIEW manumoda.vw_orden_etapas IS
  'Las etapas de cada folio con su estado. Diseño, Corte, Entrega S1, '
  'Entrega de maquila (S7) y Despacho se leen de su fuente real; el resto, '
  'de orden_etapas.';

-- ── vw_orden_avance: idéntica al 063 ──
CREATE VIEW manumoda.vw_orden_avance AS
SELECT
    idempresa,
    folio,
    COUNT(*)                                              AS etapas,
    COUNT(*) FILTER (WHERE estado = 'Completada')         AS completadas,
    COUNT(*) FILTER (WHERE estado = 'En proceso')         AS en_proceso,
    COUNT(*) FILTER (WHERE estado = 'Pendiente')          AS pendientes,
    COUNT(*) FILTER (WHERE estado = 'No aplica')          AS no_aplican,
    CASE WHEN COUNT(*) FILTER (WHERE estado <> 'No aplica') > 0
         THEN ROUND(
           100.0 * COUNT(*) FILTER (WHERE estado = 'Completada')
           / COUNT(*) FILTER (WHERE estado <> 'No aplica'), 1)
         ELSE 0
    END                                                   AS avance_pct,
    MIN(numero) FILTER (WHERE estado IN ('Pendiente', 'En proceso')) AS etapa_actual,
    jsonb_agg(
      jsonb_build_object('numero', numero, 'etapa', etapa, 'estado', estado)
      ORDER BY numero
    ) AS etapas_detalle
FROM manumoda.vw_orden_etapas
GROUP BY idempresa, folio;

COMMENT ON VIEW manumoda.vw_orden_avance IS
  'Cuántas etapas lleva cada folio y en cuál está parado. Las etapas que no '
  'aplican no cuentan contra el porcentaje. `etapas_detalle` trae el estado '
  'de todas para pintar el indicador sin cargar la vista de etapas.';

-- ── vw_etapas_cola: idéntica al 063 ──
CREATE VIEW manumoda.vw_etapas_cola AS
SELECT
    v.idempresa,
    v.folio,
    v.modelo,
    v.cliente,
    v.piezas,
    v.numero,
    v.clave,
    v.etapa,
    v.gestion_externa,
    v.modulo,
    v.estado,
    v.responsable,
    v.notas,
    v.fecha_pedido,
    v.fecha_cancelacion,
    CASE WHEN v.fecha_pedido IS NOT NULL
         THEN (CURRENT_DATE - v.fecha_pedido)::integer
    END                                        AS dias_espera,
    prev.numero                                AS etapa_previa_numero,
    prev.etapa                                 AS etapa_previa,
    prev.estado                                AS etapa_previa_estado,
    CASE
      WHEN v.estado = 'Completada'  THEN 'Completada'
      WHEN v.estado = 'No aplica'   THEN 'No aplica'
      WHEN v.estado = 'En proceso'  THEN 'En proceso'
      WHEN prev.numero IS NULL      THEN 'Lista'
      WHEN prev.estado IN ('Completada', 'No aplica') THEN 'Lista'
      ELSE 'Bloqueada'
    END                                        AS situacion
FROM manumoda.vw_orden_etapas v
LEFT JOIN LATERAL (
    SELECT p.numero, p.etapa, p.estado
    FROM manumoda.vw_orden_etapas p
    WHERE p.folio = v.folio
      AND p.idempresa = v.idempresa
      AND p.numero < v.numero
    ORDER BY p.numero DESC
    LIMIT 1
) prev ON true;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El catálogo tiene 11 etapas y las dos nuevas son la 10 y la 11.
SELECT numero, clave, nombre, gestion_externa, modulo
FROM manumoda.cat_etapas_produccion
WHERE idempresa = 1 AND numero >= 9
ORDER BY numero;

-- 2. Las columnas del despacho existen y la hora es `time`.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'ordenes_produccion'
  AND column_name IN ('fecha_despacho_cliente', 'hora_despacho_cliente');

-- 3. La vista expone las cuatro columnas nuevas. Esperado: 4 filas.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'vw_orden_etapas'
  AND column_name IN ('fecha_s1', 'fecha_s7', 'fecha_despacho_cliente',
                      'hora_despacho_cliente');

-- 4. Cómo quedan las dos etapas nuevas en los 662 folios.
--    Esperado: entrega_maquila ≈ 171 Completada, 127 En proceso;
--              despacho_cliente ≈ 105 Completada, 0 En proceso.
SELECT clave, estado, COUNT(*) AS folios
FROM manumoda.vw_orden_etapas
WHERE idempresa = 1 AND clave IN ('entrega_maquila', 'despacho_cliente')
GROUP BY clave, estado
ORDER BY clave, estado;

-- 5. Los folios listos para programar despacho: entregados por el
--    maquilero y aún sin facturar. Esperado: ≈ 66.
SELECT COUNT(*) AS listos_para_despacho
FROM manumoda.vw_etapas_cola
WHERE idempresa = 1 AND clave = 'despacho_cliente' AND situacion = 'Lista';

-- 6. El avance cuenta 11 etapas por folio. Esperado: todas con etapas = 11.
SELECT etapas, COUNT(*) AS folios
FROM manumoda.vw_orden_avance
WHERE idempresa = 1
GROUP BY etapas;

-- 7. La restricción: hora sin día se rechaza con 23514.
--    El primero pasa; el segundo debe fallar.
-- UPDATE manumoda.ordenes_produccion
-- SET fecha_despacho_cliente = CURRENT_DATE, hora_despacho_cliente = '10:00'
-- WHERE idempresa = 1 AND folio = '2171';
-- UPDATE manumoda.ordenes_produccion
-- SET fecha_despacho_cliente = NULL, hora_despacho_cliente = '10:00'
-- WHERE idempresa = 1 AND folio = '2171';
-- UPDATE manumoda.ordenes_produccion
-- SET fecha_despacho_cliente = NULL, hora_despacho_cliente = NULL
-- WHERE idempresa = 1 AND folio = '2171';

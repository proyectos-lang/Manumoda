-- ============================================================
-- Folios por etapa: qué puede trabajar cada etapa hoy
--
-- QUÉ AGREGA:
--   `vw_orden_etapas` no exponía la fecha del pedido ni las piezas, y
--   sin eso la cola de trabajo no puede ordenarse por antigüedad ni
--   decir cuánto hay que producir. Se agregan a la vista.
--
--   Y se agrega `vw_etapas_cola`, que clasifica cada folio pendiente
--   en una de tres situaciones, según su etapa ANTERIOR:
--
--     Lista        la etapa previa ya está Completada o No aplica:
--                  este folio ya se puede trabajar.
--     En proceso   la etapa ya arrancó pero no termina.
--     Bloqueada    la etapa previa todavía no está lista.
--
-- POR QUÉ SOLO LA ETAPA ANTERIOR Y NO TODAS:
--   Decisión de operación (2026-09-14). Exigir que TODAS las
--   anteriores estén completas amontonaría hoy los 630 folios en la
--   etapa 1 y dejaría las otras ocho vacías, porque las seis etapas
--   nuevas aún no tienen captura. Mirando solo la etapa previa, el
--   tablero refleja que Diseño y Corte ya avanzaron.
--
--   La etapa 1 no tiene anterior: siempre está lista.
--
-- SOBRE `dias_espera`:
--   Se cuenta desde la fecha del pedido, no desde que la etapa quedó
--   lista: lo que le importa a quien prioriza es cuánto lleva el
--   CLIENTE esperando, no cuánto lleva el papel en ese escritorio.
--
-- PREREQUISITO: script 056 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. vw_orden_etapas — se le agregan las fechas y las piezas
--
--    Se recrea completa (no se puede ALTER una vista para agregar
--    columnas en medio). El resto de la lógica es idéntica al 056:
--    "Completada" sigue ganando sobre "No aplica".
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
    -- Nuevas: la cola de trabajo las necesita para priorizar
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
    -- se hizo, aunque la orden diga que no la requería: hoy son 101 folios
    -- con `no_requiere_diseno` y fecha de aprobación al mismo tiempo.
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
      ELSE COALESCE(oe.estado::text, 'Pendiente')
    END                        AS estado,
    CASE e.clave
      WHEN 'diseno'     THEN o.fecha_aprobacion_diseno
      WHEN 'corte'      THEN cp.fecha_corte
      WHEN 'entrega_s1' THEN o.fecha_s1
      ELSE oe.fecha_completada
    END                        AS fecha_completada,
    oe.fecha_inicio,
    oe.responsable,
    oe.notas,
    COALESCE(oe.datos, '{}'::jsonb) AS datos,
    oe.capturado_por,
    oe.updated_at,
    (oe.id IS NOT NULL)        AS tiene_registro
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
  'Las nueve etapas de cada folio con su estado. Diseño, Corte y Entrega S1 '
  'se leen de su fuente real; el resto, de orden_etapas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_orden_avance — se recrea igual (dependía de la vista anterior)
-- ════════════════════════════════════════════════════════════════════════════

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
  'de las nueve para pintar el indicador sin cargar la vista de etapas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_etapas_cola — la cola de trabajo de cada etapa
-- ════════════════════════════════════════════════════════════════════════════

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
    -- Desde que se pidió, no desde que la etapa quedó lista: lo que
    -- importa al priorizar es cuánto lleva esperando el cliente.
    CASE WHEN v.fecha_pedido IS NOT NULL
         THEN (CURRENT_DATE - v.fecha_pedido)::integer
    END                                        AS dias_espera,
    prev.numero                                AS etapa_previa_numero,
    prev.etapa                                 AS etapa_previa,
    prev.estado                                AS etapa_previa_estado,
    -- La clasificación. La etapa 1 no tiene anterior: siempre lista.
    CASE
      WHEN v.estado = 'Completada'  THEN 'Completada'
      WHEN v.estado = 'No aplica'   THEN 'No aplica'
      WHEN v.estado = 'En proceso'  THEN 'En proceso'
      WHEN prev.numero IS NULL      THEN 'Lista'
      WHEN prev.estado IN ('Completada', 'No aplica') THEN 'Lista'
      ELSE 'Bloqueada'
    END                                        AS situacion
FROM manumoda.vw_orden_etapas v
-- LATERAL con LIMIT 1: la etapa inmediatamente anterior de este folio.
-- Se busca por `numero < v.numero` y no por `v.numero - 1` para que
-- siga funcionando si alguien desactiva una etapa del catálogo y los
-- números dejan de ser consecutivos.
LEFT JOIN LATERAL (
    SELECT p.numero, p.etapa, p.estado
    FROM manumoda.vw_orden_etapas p
    WHERE p.folio = v.folio
      AND p.idempresa = v.idempresa
      AND p.numero < v.numero
    ORDER BY p.numero DESC
    LIMIT 1
) prev ON true;

COMMENT ON VIEW manumoda.vw_etapas_cola IS
  'Qué puede trabajar cada etapa hoy. `situacion` = Lista (la etapa previa ya '
  'está resuelta), En proceso, Bloqueada (la previa no está lista), '
  'Completada o No aplica.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La vista de etapas sigue dando 9 filas por folio: 5,670 con 630 folios.
SELECT COUNT(*) AS filas,
       COUNT(DISTINCT folio) AS folios,
       COUNT(*) / NULLIF(COUNT(DISTINCT folio), 0) AS etapas_por_folio
FROM manumoda.vw_orden_etapas
WHERE idempresa = 1;

-- 2. Las columnas nuevas llegan con dato. Esperado: números > 0.
SELECT
  COUNT(*) FILTER (WHERE fecha_pedido IS NOT NULL)      AS con_fecha_pedido,
  COUNT(*) FILTER (WHERE piezas IS NOT NULL)            AS con_piezas
FROM manumoda.vw_orden_etapas
WHERE idempresa = 1 AND numero = 1;

-- 3. La cola, por etapa y situación. Esperado con los datos de hoy:
--    Pre orden 630 Listas; Ficha de producción 118 Listas;
--    Adquisición habilitación simple 108 Listas; el resto Bloqueadas.
SELECT numero, etapa, situacion, COUNT(*) AS folios
FROM manumoda.vw_etapas_cola
WHERE idempresa = 1
GROUP BY numero, etapa, situacion
ORDER BY numero, situacion;

-- 4. Toda fila cae en exactamente una situación: la suma debe dar el
--    total de la vista de etapas. 0 filas si cuadra.
SELECT 'descuadre' AS problema
FROM (
  SELECT
    (SELECT COUNT(*) FROM manumoda.vw_etapas_cola WHERE idempresa = 1)  AS cola,
    (SELECT COUNT(*) FROM manumoda.vw_orden_etapas WHERE idempresa = 1) AS etapas
) t
WHERE t.cola <> t.etapas;

-- 5. La etapa 1 nunca puede salir Bloqueada: no tiene anterior. 0 filas.
SELECT folio, situacion
FROM manumoda.vw_etapas_cola
WHERE idempresa = 1 AND numero = 1 AND situacion = 'Bloqueada';

-- 6. Panel General no cambió: el avance sigue igual que antes.
SELECT COUNT(*) AS folios, ROUND(AVG(avance_pct), 1) AS avance_promedio
FROM manumoda.vw_orden_avance
WHERE idempresa = 1;

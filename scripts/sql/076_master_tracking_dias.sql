-- ============================================================
-- Master Tracking: los días, la fecha apartada, y fuera la calificación
--
-- POR QUÉ SALÍAN VACÍAS TRES COLUMNAS:
--   La pantalla lee `vw_resumen_operacion`, pero esa vista NUNCA tuvo
--   `dias_restantes`, `fecha_apartada_entrega` ni `calificacion_corte`:
--   las tres llegaban `undefined` al navegador y se pintaban con un
--   guion en TODAS las filas.
--
--   El script 070 agregó fecha apartada y calificación, sí, pero a
--   `vw_seguimiento_integrado` —otra vista, que esta pantalla no
--   consulta para su tabla—. Por eso el arreglo no se vio.
--
--   No era falta de datos: de las 55 filas visibles, 55 tienen fecha de
--   cancelación y 6 tienen apartada. Era que la vista no las exponía.
--
-- LOS DÍAS VAN CONTRA EL LÍMITE DE ENTREGA:
--   Es `fecha_cancelacion`, la misma columna que la tabla ya muestra
--   (operación, 26-sep-2026). Así el número se puede comprobar a
--   simple vista contra la fecha de al lado, sin adivinar de dónde
--   salió. Las 55 filas visibles la tienen, así que la columna Días
--   deja de estar vacía por completo.
--
-- FUERA LA CALIFICACIÓN DE CORTE:
--   `corte_programacion.calificacion` está vacía en sus 82 filas: la
--   columna existe pero nunca se ha capturado. Una columna que jamás
--   muestra nada ocupa ancho y hace dudar de si está rota. Se retira de
--   las dos vistas.
--
--   La COLUMNA de origen NO se toca: se sigue capturando en el módulo
--   de Corte, y el día que haya datos volver a exponerla es una línea.
--
-- LA CALIDAD NO SE VE, Y ES ESPERABLE:
--   El dato existe —149 órdenes lo traen— pero TODAS están en fase S7,
--   que es donde se califica al cerrar. Y la tabla sigue sin mostrar
--   S7: es seguimiento de lo que está EN PROCESO, y un folio cerrado ya
--   no se sigue (operación, 26-sep-2026).
--
--   Consecuencia asumida: la columna Calidad queda vacía en las 55
--   filas visibles, porque ninguna ha llegado todavía al punto donde se
--   califica. Se muestra igual para que se vea llegar el dato cuando un
--   folio avance, pero la pantalla lo explica en vez de dejar 55
--   guiones sin motivo aparente.
--
-- PREREQUISITO: script 070 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. vw_resumen_operacion — la que alimenta la tabla de Master Tracking
--
--    Se recrea entera con las columnas nuevas al final. CREATE OR
--    REPLACE basta porque solo se AGREGA: no se quita ni se reordena
--    ninguna de las que ya tenía.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_resumen_operacion AS
SELECT
    o.id,
    o.idempresa,
    o.folio,
    o.piezas,
    o.fase_actual,
    o.fecha_cancelacion,
    o.maquilero AS maquilero_nombre,
    manumoda.fn_riesgo_entrega(
        o.fecha_facturacion, o.fecha_cancelacion, o.fase_actual
    ) AS riesgo_entrega,
    o.fecha_s1 - COALESCE(o.fecha_pedido, date(o.created_at)) AS dias_prog_s1,
    o.fecha_s2 - o.fecha_s1 AS dias_s1_s2,
    o.fecha_s3 - o.fecha_s2 AS dias_s2_s3,
    o.fecha_s4 - o.fecha_s3 AS dias_s3_s4,
    o.fecha_s5 - o.fecha_s4 AS dias_s4_s5,
    o.fecha_s6 - o.fecha_s5 AS dias_s5_s6,
    o.fecha_s7 - o.fecha_s6 AS dias_s6_s7,
    o.fecha_s1,
    o.fecha_s2,
    o.fecha_s3,
    o.fecha_s4,
    o.fecha_s5,
    o.fecha_s6,
    o.fecha_s7,
    -- La calidad de la revisión de maquila. 149 órdenes la traen; donde
    -- sale vacía es que no se ha registrado la revisión.
    o.calidad,
    o.familia,
    dis.nombre AS nombre_disenador,
    cos.nombre AS nombre_costurera,
    o.fecha_contra_muestra,
    o.modelo,
    o.cliente,
    o.fecha_limite_confirmacion,
    o.fecha_ultima_revision,
    o.fecha_facturacion,
    o.fecha_cancelacion_original,

    -- ── Columnas nuevas, obligatoriamente al final ──
    --
    -- El día que el maquilero aparta para entregar (existe en la orden
    -- desde el script 053). La pantalla la pedía y la vista no la daba.
    o.fecha_apartada_entrega,

    -- Los días que faltan para el Límite de Entrega, que es la columna
    -- de al lado en la tabla: así el número se comprueba a simple
    -- vista. Sin límite capturado queda NULL y la pantalla pone un
    -- guion, que es más honesto que inventar una referencia.
    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes

FROM manumoda.ordenes_produccion o
LEFT JOIN LATERAL (
    SELECT iddisenadora, idcosturera
    FROM manumoda.diseno_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
    ORDER BY id DESC
    LIMIT 1
) dp ON true
LEFT JOIN manumoda.disenadoras dis ON dp.iddisenadora = dis.id
LEFT JOIN manumoda.costureras   cos ON dp.idcosturera  = cos.id
-- Solo lo que está EN PROCESO: un folio cerrado (S7) ya no se sigue, y
-- 'Por Programar' todavía no tiene fechas ni avance que seguir.
--
-- OJO: esto deja la columna Calidad vacía a propósito. Se registra al
-- cerrar, en S7, así que ninguna fila visible puede traerla todavía.
WHERE o.fase_actual <> 'Por Programar'::text
  AND o.fase_actual <> 'S7'::text;

COMMENT ON VIEW manumoda.vw_resumen_operacion IS
  'La tabla de Master Tracking: solo folios en proceso, sin Por '
  'Programar ni S7. dias_restantes va contra el Límite de Entrega. La '
  'calidad se registra en S7, así que aquí siempre llega vacía.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. vw_seguimiento_integrado — el mismo criterio de días, y sin la
--    calificación de corte
--
--    DROP y no CREATE OR REPLACE: se QUITA una columna, y eso Postgres
--    no lo permite reemplazando. Se comprobó contra la base que ninguna
--    otra vista depende de esta.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_seguimiento_integrado;

CREATE VIEW manumoda.vw_seguimiento_integrado AS
SELECT
    o.id,
    o.idempresa,
    o.folio,
    o.modelo,
    o.familia,
    o.cliente,
    o.maquilero AS maquilero_nombre,
    o.piezas,
    o.fase_actual,

    -- ── Fechas de la orden ──────────────────────────────────────────────────
    o.fecha_pedido,
    o.fecha_limite_confirmacion,
    o.fecha_contra_muestra,
    o.fecha_cancelacion,
    o.fecha_ultima_revision,

    -- ── Etapa 1: Diseño ─────────────────────────────────────────────────────
    dp.fecha                AS fecha_diseno,
    dis.nombre              AS nombre_disenador,
    dp.cumplimiento_diseno,
    o.fecha_aprobacion_diseno,
    o.no_requiere_diseno,

    -- ── Etapa 2: Corte ──────────────────────────────────────────────────────
    cp.fecha                AS fecha_corte,
    cor.nombre              AS nombre_cortador,
    cp.cumplimiento_corte,
    o.no_requiere_corte,

    -- ── Etapa 3: Maquila ────────────────────────────────────────────────────
    o.fecha_s1,
    o.fecha_s2,
    o.fecha_s3,
    o.fecha_s4,
    o.fecha_s5,
    o.fecha_s6,
    o.fecha_s7,
    o.calidad,
    o.tipo_revision,
    o.habilitaciones_insumos,
    o.comentarios_generales,

    -- ── Riesgo de entrega ───────────────────────────────────────────────────
    --
    -- El riesgo sigue mirando SOLO la cancelación, a propósito: es el
    -- compromiso con el cliente y es lo que define si un folio va tarde.
    -- Un apartado interno no puede cambiar el semáforo.
    manumoda.fn_riesgo_entrega(
        o.fecha_facturacion, o.fecha_cancelacion, o.fase_actual
    ) AS riesgo_entrega,

    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes,

    o.fecha_facturacion,
    o.fecha_apartada_entrega

FROM manumoda.ordenes_produccion o

LEFT JOIN LATERAL (
    SELECT fecha, iddisenadora, cumplimiento_diseno
    FROM manumoda.diseno_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
    ORDER BY id DESC
    LIMIT 1
) dp ON true

LEFT JOIN LATERAL (
    SELECT fecha, idcortador, cumplimiento_corte
    FROM manumoda.corte_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
    ORDER BY id DESC
    LIMIT 1
) cp ON true

LEFT JOIN manumoda.disenadoras dis ON dp.iddisenadora = dis.id
LEFT JOIN manumoda.cortadores   cor ON cp.idcortador  = cor.id;

COMMENT ON VIEW manumoda.vw_seguimiento_integrado IS
  'Un folio de punta a punta por las tres etapas. dias_restantes va '
  'contra el Límite de Entrega; ya no expone la calificación de corte, '
  'que nunca se capturó.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La vista de la tabla ya expone las dos que faltaban.
--    Esperado: 2 filas.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'vw_resumen_operacion'
  AND column_name IN ('dias_restantes', 'fecha_apartada_entrega')
ORDER BY column_name;

-- 2. La calificación de corte ya no está en ninguna vista. Esperado: 0.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND column_name = 'calificacion_corte';

-- 3. Ni S7 ni Por Programar aparecen. Esperado: 55 folios, ningún S7.
SELECT fase_actual, COUNT(*) AS folios
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1
GROUP BY fase_actual
ORDER BY folios DESC;

-- 4. Cuántos muestran días. Esperado: 55 de 55.
SELECT COUNT(*) FILTER (WHERE dias_restantes IS NOT NULL) AS con_dias,
       COUNT(*) FILTER (WHERE dias_restantes IS NULL)     AS sin_limite,
       COUNT(*)                                            AS folios
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 5. El número cuadra con el Límite de Entrega. Esperado: 0.
SELECT COUNT(*) AS descuadrados
FROM manumoda.vw_resumen_operacion
WHERE dias_restantes IS NOT NULL
  AND dias_restantes <> (fecha_cancelacion - CURRENT_DATE)::integer;

-- 6. La calidad llega vacía, y es lo esperado: se registra en S7, que
--    esta vista no muestra. Esperado: 0 con calidad.
SELECT COUNT(*) FILTER (WHERE calidad IS NOT NULL) AS con_calidad,
       COUNT(*)                                     AS folios
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 7. La fecha apartada sí llega. Esperado: 6.
SELECT COUNT(*) FILTER (WHERE fecha_apartada_entrega IS NOT NULL) AS con_apartada
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 8. La columna de origen NO se borró de corte_programacion: el día que
--    se capture, volver a exponerla es una línea. Esperado: 1 fila.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'corte_programacion'
  AND column_name = 'calificacion';

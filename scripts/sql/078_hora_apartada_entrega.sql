-- ============================================================
-- La hora del apartado de entrega
--
-- PARA QUÉ:
--   El calendario de recepciones muestra cuántas entregas caen cada
--   día. Con la hora se puede abrir el día y ver la ocupación real:
--   qué franjas están llenas y cuáles libres, como en una agenda.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO CAMBIAR LA FECHA A timestamp:
--   `fecha_apartada_entrega` es `date` y la usan Master Tracking, Pago
--   Maquilas, Seguimiento Maquila y el calendario. Convertirla a
--   timestamp cambiaría el tipo bajo todas esas consultas: las
--   comparaciones `= fecha` dejarían de cuadrar en cuanto hubiera una
--   hora distinta de medianoche, y en silencio.
--
--   Una columna aparte es aislada: lo que ya funciona sigue igual, y
--   quitarla si no se usa es un ALTER TABLE.
--
-- time Y NO timestamp:
--   El día ya lo dice la otra columna. Guardar el día dos veces
--   invitaría a que se contradigan, y entonces habría que decidir cuál
--   manda.
--
-- ES OPCIONAL:
--   Las 13 órdenes que hoy tienen apartado no traen hora, y muchos
--   maquileros apartan un día sin comprometer hora. Sin hora, el
--   calendario las muestra aparte, no las inventa en una franja.
--
-- OJO — ESTE SCRIPT YA TRAE EL FILTRO DEL 077:
--   Al recrear `vw_resumen_operacion` para exponer la hora, se repite
--   entera, y la versión que se repite es la que excluye S7. Si el 077
--   no se ha corrido, este lo deja aplicado de todos modos; si ya se
--   corrió, no cambia nada.
--
-- PREREQUISITO: script 053 ejecutado.
-- ============================================================

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS hora_apartada_entrega time;

COMMENT ON COLUMN manumoda.ordenes_produccion.hora_apartada_entrega IS
  'Hora a la que el maquilero se compromete a entregar, para el '
  'cronograma del día en el calendario de recepciones. Opcional: sin '
  'ella la entrega es "sin hora", no a medianoche.';

-- Una hora sin su día no significa nada: sería una entrega flotante que
-- el calendario no sabría dónde poner.
ALTER TABLE manumoda.ordenes_produccion
  DROP CONSTRAINT IF EXISTS chk_hora_apartada_requiere_fecha;

ALTER TABLE manumoda.ordenes_produccion
  ADD CONSTRAINT chk_hora_apartada_requiere_fecha
  CHECK (hora_apartada_entrega IS NULL OR fecha_apartada_entrega IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════════════
-- Exponerla donde ya se usa la fecha
--
--   Solo se AGREGA una columna al final, así que CREATE OR REPLACE
--   basta: no se quita ni se reordena ninguna de las que ya están.
-- ════════════════════════════════════════════════════════════════════════════

-- Master Tracking la trae por si más adelante quiere mostrar la hora
-- junto a la fecha apartada; hoy no la pinta, pero tenerla evita
-- rehacer la vista cuando haga falta.
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
    o.fecha_apartada_entrega,
    (o.fecha_cancelacion - CURRENT_DATE) AS dias_restantes,

    -- ── La columna nueva, al final ──
    o.hora_apartada_entrega

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
WHERE o.fase_actual <> 'Por Programar'::text
  AND o.fase_actual <> 'S7'::text;

COMMENT ON VIEW manumoda.vw_resumen_operacion IS
  'La tabla de Master Tracking: solo folios en proceso, sin Por '
  'Programar ni S7. dias_restantes va contra el Límite de Entrega. La '
  'calidad se registra en S7, así que aquí siempre llega vacía.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La columna existe y es `time`. Esperado: 'time without time zone'.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'ordenes_produccion'
  AND column_name = 'hora_apartada_entrega';

-- 2. La vista la expone. Esperado: 1 fila.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'vw_resumen_operacion'
  AND column_name = 'hora_apartada_entrega';

-- 3. La restricción impide una hora sin día.
--    El primero pasa; el segundo debe fallar con 23514.
-- UPDATE manumoda.ordenes_produccion
-- SET hora_apartada_entrega = '09:30'
-- WHERE idempresa = 1 AND folio = '2171';   -- este sí tiene fecha
-- UPDATE manumoda.ordenes_produccion
-- SET hora_apartada_entrega = '09:30'
-- WHERE idempresa = 1 AND fecha_apartada_entrega IS NULL AND folio = '2235';
-- UPDATE manumoda.ordenes_produccion
-- SET hora_apartada_entrega = NULL WHERE idempresa = 1 AND folio = '2171';

-- 4. Y que borrar la fecha no deje la hora huérfana: la restricción lo
--    impide, así que hay que limpiar las dos juntas.
--    Esperado: 0 filas con hora y sin fecha.
SELECT COUNT(*) AS horas_huerfanas
FROM manumoda.ordenes_produccion
WHERE hora_apartada_entrega IS NOT NULL
  AND fecha_apartada_entrega IS NULL;

-- 5. Cuántas entregas tienen hora. Esperado al principio: 0 de 13.
SELECT COUNT(*) FILTER (WHERE hora_apartada_entrega IS NOT NULL) AS con_hora,
       COUNT(*) FILTER (WHERE fecha_apartada_entrega IS NOT NULL) AS con_fecha
FROM manumoda.ordenes_produccion
WHERE idempresa = 1;

-- ============================================================
-- Master Tracking: fuera los folios cerrados (S7)
--
-- POR QUÉ UN SCRIPT APARTE:
--   El 076 se corrió cuando todavía incluía S7. La corrección llegó
--   después, así que la base quedó con 219 filas y 164 de ellas
--   cerradas. Volver a correr el 076 entero también serviría —es
--   repetible— pero este script hace solo el cambio que falta y deja
--   constancia de por qué.
--
-- QUÉ CAMBIA:
--   La tabla muestra solo lo que está EN PROCESO: 55 folios en S1–S6.
--   Un folio cerrado ya no se sigue, y 'Por Programar' todavía no
--   tiene fechas ni avance que seguir (operación, 26-sep-2026).
--
-- CONSECUENCIA ASUMIDA — LA CALIDAD QUEDA VACÍA:
--   Se registra al cerrar, en S7. Al no mostrar S7, ninguna fila
--   visible puede traerla. La columna se deja en pantalla —el dato
--   aparecería si alguien califica antes de cerrar— pero el encabezado
--   dice dónde se captura, para que 55 casillas vacías no parezcan un
--   fallo.
--
-- LO DEMÁS NO SE TOCA:
--   `dias_restantes` y `fecha_apartada_entrega` ya quedaron del 076 y
--   se repiten igual. Los 55 folios visibles tienen Límite de Entrega,
--   así que la columna Días deja de estar vacía.
--
-- PREREQUISITO: script 076 ejecutado.
-- ============================================================

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
    -- Se registra al cerrar (S7), que esta vista ya no muestra: aquí
    -- llega siempre vacía, y es lo esperado.
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
WHERE o.fase_actual <> 'Por Programar'::text
  AND o.fase_actual <> 'S7'::text;

COMMENT ON VIEW manumoda.vw_resumen_operacion IS
  'La tabla de Master Tracking: solo folios en proceso, sin Por '
  'Programar ni S7. dias_restantes va contra el Límite de Entrega. La '
  'calidad se registra en S7, así que aquí siempre llega vacía.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Ni S7 ni Por Programar. Esperado: 55 folios, ninguno en S7.
SELECT fase_actual, COUNT(*) AS folios
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1
GROUP BY fase_actual
ORDER BY fase_actual;

-- 2. El total. Esperado: 55 (antes de este script eran 219).
SELECT COUNT(*) AS folios_visibles
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 3. Los 55 muestran días, que era el punto del 076. Esperado: 55 y 0.
SELECT COUNT(*) FILTER (WHERE dias_restantes IS NOT NULL) AS con_dias,
       COUNT(*) FILTER (WHERE dias_restantes IS NULL)     AS sin_limite
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 4. La fecha apartada también llega. Esperado: 6.
SELECT COUNT(*) FILTER (WHERE fecha_apartada_entrega IS NOT NULL) AS con_apartada
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 5. La calidad llega vacía, y es lo esperado. Esperado: 0.
SELECT COUNT(*) FILTER (WHERE calidad IS NOT NULL) AS con_calidad
FROM manumoda.vw_resumen_operacion
WHERE idempresa = 1;

-- 6. Los folios en S7 siguen existiendo en la orden: solo dejaron de
--    mostrarse aquí. Esperado: 164.
SELECT COUNT(*) AS cerrados_en_s7
FROM manumoda.ordenes_produccion
WHERE idempresa = 1 AND fase_actual = 'S7';

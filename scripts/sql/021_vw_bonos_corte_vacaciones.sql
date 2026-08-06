-- ============================================================
-- vw_bonos_corte: conectar las vacaciones de cortadores al bono
--
-- PROBLEMA:
--   vw_bonos_corte leía los ausentismos de las tablas dedicadas
--   `corte_ausentismos` / `corte_tiempos_fuera` (vacías), pero la
--   pestaña de Vacaciones de Corte del frontend escribe en
--   `vacaciones_permisos` (con idcortador). Resultado: las vacaciones
--   de un cortador no restaban horas en su liquidación.
--
-- FIX:
--   Reapuntar los subselects de ausentismos y horas fuera de área a
--   `vacaciones_permisos` / `tiempos_fuera_area` filtrando por
--   idcortador — las mismas tablas que usa Diseño. El frontend no
--   cambia.
--
-- Efecto en el bono (igual que en diseño):
--   eficiencia = (horas_cumplidas + horas_fuera) / (45 − ausentismos)
--   Las vacaciones bajan el divisor (menos horas disponibles esa
--   semana), y si ausentismos + fuera de área > 40% de la semana el
--   criterio de aceptación cae a 'No'.
--
-- ⚠️ PREREQUISITO: script 017 ejecutado (agrega idcortador a
--    vacaciones_permisos y tiempos_fuera_area). Sin él estas columnas
--    no existen y este script falla.
--
-- Reemplaza la versión del script 020 (que leía las tablas vacías).
-- ============================================================

CREATE OR REPLACE VIEW manumoda.vw_bonos_corte AS
WITH
  semanas_base AS (
    SELECT
      corte_programacion.idcortador AS idcolaborador,
      corte_programacion.semana,
      EXTRACT(year FROM corte_programacion.fecha) AS anio
    FROM manumoda.corte_programacion
    WHERE corte_programacion.idcortador IS NOT NULL
    UNION
    SELECT
      corte_programacion.idapoyo AS idcolaborador,
      corte_programacion.semana,
      EXTRACT(year FROM corte_programacion.fecha) AS anio
    FROM manumoda.corte_programacion
    WHERE corte_programacion.idapoyo IS NOT NULL
    UNION
    -- Tiempos fuera de área de cortadores (tabla compartida)
    SELECT
      tf.idcortador AS idcolaborador,
      tf.semana,
      EXTRACT(year FROM tf.fecha) AS anio
    FROM manumoda.tiempos_fuera_area tf
    WHERE tf.idcortador IS NOT NULL
    UNION
    -- Vacaciones / permisos de cortadores (tabla compartida)
    SELECT
      vp.idcortador AS idcolaborador,
      vp.semana,
      EXTRACT(year FROM vp.fecha_inicio) AS anio
    FROM manumoda.vacaciones_permisos vp
    WHERE vp.idcortador IS NOT NULL
  ),
  totales_horas_cortador AS (
    SELECT
      sb.idcolaborador,
      sb.semana,
      sb.anio,
      c.nombre,
      CASE WHEN c.activo = true THEN 'Activo'::text ELSE 'Baja'::text END AS estatus_colaborador,
      COALESCE((
        SELECT sum(vw_plan_corte_detalle.horas_cumplimiento_corte) AS sum
        FROM manumoda.vw_plan_corte_detalle
        WHERE vw_plan_corte_detalle.idcortador = sb.idcolaborador
          AND vw_plan_corte_detalle.semana = sb.semana
      ), 0::numeric) + COALESCE((
        SELECT sum(vw_plan_corte_detalle.horas_cumplimiento_corte) AS sum
        FROM manumoda.vw_plan_corte_detalle
        WHERE vw_plan_corte_detalle.idapoyo = sb.idcolaborador
          AND vw_plan_corte_detalle.semana = sb.semana
      ), 0::numeric) AS horas_cumplidas,
      -- Fuera de área: ahora desde tiempos_fuera_area por idcortador
      COALESCE((
        SELECT sum(tf.tiempo_af) AS sum
        FROM manumoda.tiempos_fuera_area tf
        WHERE tf.idcortador = sb.idcolaborador
          AND tf.semana = sb.semana
      ), 0::numeric) AS horas_fuera_area,
      -- Ausentismos: ahora desde vacaciones_permisos por idcortador
      COALESCE((
        SELECT sum(vp.horas_totales) AS sum
        FROM manumoda.vacaciones_permisos vp
        WHERE vp.idcortador = sb.idcolaborador
          AND vp.semana = sb.semana
      ), 0::numeric) AS ausentismos,
      45::numeric AS horas_semana
    FROM semanas_base sb
    JOIN manumoda.cortadores c ON sb.idcolaborador = c.id
  ),
  calculo_eficiencia AS (
    SELECT
      t.idcolaborador, t.semana, t.anio, t.nombre, t.estatus_colaborador,
      t.horas_cumplidas, t.horas_fuera_area, t.ausentismos, t.horas_semana,
      CASE
        WHEN t.estatus_colaborador = 'Baja'::text THEN NULL::numeric
        WHEN (t.horas_semana - t.ausentismos) <= 0::numeric THEN 0::numeric
        ELSE round((t.horas_cumplidas + t.horas_fuera_area) / (t.horas_semana - t.ausentismos), 4)
      END AS eficiencia_pct,
      CASE
        WHEN t.estatus_colaborador = 'Baja'::text THEN 'No'::text
        WHEN round(t.horas_cumplidas / 45::numeric, 2) > 0.8 THEN 'Si'::text
        WHEN ((t.horas_fuera_area + t.ausentismos) / 45::numeric) > 0.4 THEN 'No'::text
        ELSE 'Si'::text
      END AS criterio_aceptacion
    FROM totales_horas_cortador t
  ),
  max_cortes_por_mes AS (
    SELECT
      vw_plan_corte_detalle.semana,
      EXTRACT(year FROM vw_plan_corte_detalle.fecha) AS anio,
      count(vw_plan_corte_detalle.registro_id) AS total_cortes_semana
    FROM manumoda.vw_plan_corte_detalle
    GROUP BY vw_plan_corte_detalle.semana, (EXTRACT(year FROM vw_plan_corte_detalle.fecha))
  ),
  bono_semanal_flag AS (
    SELECT
      ce.idcolaborador, ce.semana, ce.anio, ce.nombre, ce.estatus_colaborador,
      ce.horas_cumplidas, ce.horas_fuera_area, ce.ausentismos, ce.horas_semana,
      ce.eficiencia_pct, ce.criterio_aceptacion,
      CASE
        WHEN ce.estatus_colaborador = 'Baja'::text THEN 'No'::text
        WHEN ce.eficiencia_pct > 0.7 AND ce.criterio_aceptacion = 'Si'::text THEN 'Si'::text
        ELSE 'No'::text
      END AS bono_semanal
    FROM calculo_eficiencia ce
  )
SELECT
  idcolaborador AS registro,
  anio,
  semana,
  nombre,
  'Corte'::text AS area,
  horas_semana,
  horas_cumplidas,
  horas_fuera_area,
  ausentismos,
  round(eficiencia_pct * 100::numeric, 2) AS porcentaje_eficiencia,
  criterio_aceptacion,
  bono_semanal,
  CASE
    WHEN bono_semanal = 'No'::text THEN 0::numeric
    ELSE round(600::numeric / COALESCE((
      SELECT max(max_cortes_por_mes.total_cortes_semana) AS max
      FROM max_cortes_por_mes
      WHERE max_cortes_por_mes.anio = b.anio
    ), 1::bigint)::numeric, 2)
  END AS monto,
  estatus_colaborador,
  round(horas_cumplidas / 45::numeric * 100::numeric, 2) AS porcentaje_productividad_directa
FROM bono_semanal_flag b;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════
-- Tras registrar una vacación a un cortador en la pestaña de Corte,
-- su fila en el bono debe mostrar ausentismos > 0 esa semana:
SELECT nombre, semana, horas_cumplidas, ausentismos, porcentaje_eficiencia
FROM manumoda.vw_bonos_corte
WHERE ausentismos > 0
ORDER BY anio DESC, semana DESC;

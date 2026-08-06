-- ============================================================
-- vw_bonos_corte — definición vigente, versionada para referencia
--
-- Esta vista NO se modifica aquí: el fix de horas cumplidas de corte
-- (script 019) vive en vw_plan_corte_detalle, de donde esta vista
-- suma horas_cumplimiento_corte. Se guarda su definición para tenerla
-- bajo control de versiones (antes no estaba en el repo).
--
-- Re-ejecutar este script reproduce exactamente la vista ya existente.
--
-- ⚠️ NOTA IMPORTANTE (pendiente, no resuelto aquí):
--   Esta vista lee los ausentismos de las tablas dedicadas
--   `corte_ausentismos` y `corte_tiempos_fuera` (hoy vacías), NO de
--   `vacaciones_permisos` / `tiempos_fuera_area`. La pestaña de
--   Vacaciones de Corte del frontend escribe en vacaciones_permisos
--   (con idcortador), así que esos registros NO restan horas en el
--   bono de corte. Para conectarlos hay que decidir una de dos:
--     a) que la pestaña de Corte escriba en corte_ausentismos /
--        corte_tiempos_fuera, o
--     b) reapuntar estos subselects a vacaciones_permisos /
--        tiempos_fuera_area filtrando por idcortador.
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
    SELECT
      corte_tiempos_fuera.idcortador AS idcolaborador,
      corte_tiempos_fuera.semana,
      EXTRACT(year FROM corte_tiempos_fuera.fecha) AS anio
    FROM manumoda.corte_tiempos_fuera
    UNION
    SELECT
      corte_ausentismos.idcortador AS idcolaborador,
      corte_ausentismos.semana,
      EXTRACT(year FROM corte_ausentismos.fecha_inicio) AS anio
    FROM manumoda.corte_ausentismos
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
      COALESCE((
        SELECT sum(corte_tiempos_fuera.tiempo_af) AS sum
        FROM manumoda.corte_tiempos_fuera
        WHERE corte_tiempos_fuera.idcortador = sb.idcolaborador
          AND corte_tiempos_fuera.semana = sb.semana
      ), 0::numeric) AS horas_fuera_area,
      COALESCE((
        SELECT sum(corte_ausentismos.horas_totales) AS sum
        FROM manumoda.corte_ausentismos
        WHERE corte_ausentismos.idcortador = sb.idcolaborador
          AND corte_ausentismos.semana = sb.semana
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

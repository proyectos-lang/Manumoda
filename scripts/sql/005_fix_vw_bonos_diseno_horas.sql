-- ============================================================
-- Fix vw_bonos_diseno
--
-- Cambios respecto a la definición original:
--
-- 1. Rama Diseño → usa horas_diseno_cumplidas directamente.
--    Esta columna la setea el trigger (script 006) ya con la
--    lógica de rechazo_orden (÷2) incluida. Antes sólo se sumaba
--    sin filtro de idempresa, lo que podía mezclar empresas.
--
-- 2. Filtro idempresa agregado en TODOS los subselects de
--    diseno_programacion, tiempos_fuera_area y vacaciones_permisos.
--
-- PREREQUISITO: Ejecutar script 006 y luego script 004 antes de
-- correr este script, para que horas_diseno_cumplidas esté
-- correctamente actualizada en todos los registros históricos.
-- ============================================================

CREATE OR REPLACE VIEW manumoda.vw_bonos_diseno AS
WITH
  semanas_diseno AS (
    SELECT dp.idempresa, dp.iddisenadora AS idcolaborador, 'Diseño'::text AS tipo_personal,
           EXTRACT(year FROM dp.fecha) AS anio, dp.semana
    FROM manumoda.diseno_programacion dp WHERE dp.iddisenadora IS NOT NULL
    UNION
    SELECT tf.idempresa, tf.iddisenadora AS idcolaborador, 'Diseño'::text AS tipo_personal,
           EXTRACT(year FROM tf.fecha) AS anio, tf.semana
    FROM manumoda.tiempos_fuera_area tf WHERE tf.iddisenadora IS NOT NULL
    UNION
    SELECT vp.idempresa, vp.iddisenadora AS idcolaborador, 'Diseño'::text AS tipo_personal,
           EXTRACT(year FROM vp.fecha_inicio) AS anio, vp.semana
    FROM manumoda.vacaciones_permisos vp WHERE vp.iddisenadora IS NOT NULL
  ),
  semanas_costura AS (
    SELECT dp.idempresa, dp.idcosturera AS idcolaborador, 'Costura'::text AS tipo_personal,
           EXTRACT(year FROM dp.fecha) AS anio, dp.semana
    FROM manumoda.diseno_programacion dp WHERE dp.idcosturera IS NOT NULL
    UNION
    SELECT tf.idempresa, tf.idcosturera AS idcolaborador, 'Costura'::text AS tipo_personal,
           EXTRACT(year FROM tf.fecha) AS anio, tf.semana
    FROM manumoda.tiempos_fuera_area tf WHERE tf.idcosturera IS NOT NULL
    UNION
    SELECT vp.idempresa, vp.idcosturera AS idcolaborador, 'Costura'::text AS tipo_personal,
           EXTRACT(year FROM vp.fecha_inicio) AS anio, vp.semana
    FROM manumoda.vacaciones_permisos vp WHERE vp.idcosturera IS NOT NULL
  ),
  semanas_base AS (
    SELECT * FROM semanas_diseno
    UNION
    SELECT * FROM semanas_costura
  ),
  agregados AS (
    SELECT
      b.idempresa, b.anio, b.semana, b.idcolaborador, b.tipo_personal,
      CASE
        WHEN b.tipo_personal = 'Diseño' THEN (SELECT d.nombre FROM manumoda.disenadoras d WHERE d.id = b.idcolaborador)
        ELSE                                  (SELECT c.nombre FROM manumoda.costureras  c WHERE c.id = b.idcolaborador)
      END AS nombre,

      -- ── Horas cumplidas ──────────────────────────────────────────────────────
      CASE
        WHEN b.tipo_personal = 'Diseño' THEN COALESCE((
          -- El trigger (006) setea horas_diseno_cumplidas con la fórmula de
          -- catálogos e incluye la lógica de rechazo_orden (÷2)
          SELECT SUM(d.horas_diseno_cumplidas)
          FROM manumoda.diseno_programacion d
          WHERE d.iddisenadora = b.idcolaborador
            AND d.semana       = b.semana
            AND d.idempresa    = b.idempresa
            AND EXTRACT(year FROM d.fecha) = b.anio
        ), 0)
        ELSE COALESCE((
          SELECT SUM(
            CASE
              WHEN d.rechazo_orden = true AND d.cumplimiento_costura = true
                THEN COALESCE(d.horas_costura_cumplidas, d.horas_plan_costura)
              ELSE d.horas_costura_cumplidas
            END
          )
          FROM manumoda.diseno_programacion d
          WHERE d.idcosturera = b.idcolaborador
            AND d.semana      = b.semana
            AND d.idempresa   = b.idempresa
            AND EXTRACT(year FROM d.fecha) = b.anio
        ), 0)
      END AS horas_cumplidas,

      -- ── Horas fuera de área ──────────────────────────────────────────────────
      CASE
        WHEN b.tipo_personal = 'Diseño' THEN COALESCE((
          SELECT SUM(af.tiempo_af) FROM manumoda.tiempos_fuera_area af
          WHERE af.iddisenadora = b.idcolaborador
            AND af.semana       = b.semana
            AND af.idempresa    = b.idempresa
            AND EXTRACT(year FROM af.fecha) = b.anio
        ), 0)
        ELSE COALESCE((
          SELECT SUM(af.tiempo_af) FROM manumoda.tiempos_fuera_area af
          WHERE af.idcosturera = b.idcolaborador
            AND af.semana      = b.semana
            AND af.idempresa   = b.idempresa
            AND EXTRACT(year FROM af.fecha) = b.anio
        ), 0)
      END AS horas_fuera_area,

      -- ── Ausentismos ─────────────────────────────────────────────────────────
      CASE
        WHEN b.tipo_personal = 'Diseño' THEN COALESCE((
          SELECT SUM(au.horas_totales) FROM manumoda.vacaciones_permisos au
          WHERE au.iddisenadora = b.idcolaborador
            AND au.semana       = b.semana
            AND au.idempresa    = b.idempresa
            AND EXTRACT(year FROM au.fecha_inicio) = b.anio
        ), 0)
        ELSE COALESCE((
          SELECT SUM(au.horas_totales) FROM manumoda.vacaciones_permisos au
          WHERE au.idcosturera = b.idcolaborador
            AND au.semana      = b.semana
            AND au.idempresa   = b.idempresa
            AND EXTRACT(year FROM au.fecha_inicio) = b.anio
        ), 0)
      END AS ausentismos

    FROM semanas_base b
  ),
  calculos_base AS (
    SELECT
      a.*,
      45::numeric AS horas_semana,
      CASE
        WHEN (45::numeric - a.ausentismos) <= 0 THEN 0::numeric
        ELSE ROUND((a.horas_cumplidas + a.horas_fuera_area) / (45::numeric - a.ausentismos), 4)
      END AS eficiencia,
      CASE
        WHEN (a.horas_cumplidas / 45::numeric) > 0.8 THEN 'Si'
        WHEN ((a.horas_fuera_area + a.ausentismos) / 45::numeric) > 0.4 THEN 'No'
        ELSE 'Si'
      END AS criterio_aceptacion
    FROM agregados a
  ),
  bonos_individuales AS (
    SELECT
      cb.*,
      CASE WHEN cb.eficiencia > 0.7 AND cb.criterio_aceptacion = 'Si' THEN 'Si' ELSE 'No' END AS bono_semanal,
      CASE WHEN cb.eficiencia > 0.8 AND cb.criterio_aceptacion = 'Si' THEN 150 ELSE 0 END      AS monto_individual
    FROM calculos_base cb
  ),
  promedio_colectivo AS (
    SELECT bi.idempresa, bi.anio, bi.semana, AVG(bi.eficiencia) AS eficiencia_promedio
    FROM bonos_individuales bi
    GROUP BY bi.idempresa, bi.anio, bi.semana
  )
SELECT
  bi.idempresa, bi.anio, bi.semana, bi.idcolaborador,
  bi.tipo_personal, bi.nombre,
  bi.horas_semana, bi.horas_cumplidas, bi.horas_fuera_area, bi.ausentismos,
  ROUND(bi.eficiencia * 100::numeric, 2) AS eficiencia_pct,
  bi.criterio_aceptacion, bi.bono_semanal,
  bi.monto_individual AS monto,
  CASE WHEN pc.eficiencia_promedio > 0.7 THEN 150 ELSE 0 END AS bono_colectivo,
  bi.monto_individual + CASE WHEN pc.eficiencia_promedio > 0.7 THEN 150 ELSE 0 END AS bono_total
FROM bonos_individuales bi
JOIN promedio_colectivo pc
  ON bi.anio = pc.anio AND bi.semana = pc.semana AND bi.idempresa = pc.idempresa;

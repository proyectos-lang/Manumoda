-- ============================================================
-- Vacaciones y permisos para cortadores
--
-- vacaciones_permisos y tiempos_fuera_area solo contemplaban
-- diseñadoras y costureras. Se agrega el vínculo con cortadores
-- para poder registrar sus ausencias igual que en Diseño.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.vacaciones_permisos
  ADD COLUMN IF NOT EXISTS idcortador bigint REFERENCES manumoda.cortadores (id);

ALTER TABLE manumoda.tiempos_fuera_area
  ADD COLUMN IF NOT EXISTS idcortador bigint REFERENCES manumoda.cortadores (id);

CREATE INDEX IF NOT EXISTS idx_vacaciones_cortador
  ON manumoda.vacaciones_permisos (idcortador, semana)
  WHERE idcortador IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tiempos_fuera_cortador
  ON manumoda.tiempos_fuera_area (idcortador, semana)
  WHERE idcortador IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. ⚠️ PENDIENTE — contar estas ausencias en los bonos de corte
-- ════════════════════════════════════════════════════════════════════════════
--
-- vw_bonos_corte calcula la columna `ausentismos`, pero su definición
-- NO está versionada en este repositorio, así que no se puede editar
-- a ciegas sin arriesgar romper el cálculo de bonos.
--
-- Mientras no se actualice, las vacaciones que se registren a un
-- cortador se guardan y se ven en el módulo, pero NO restan horas en
-- su liquidación semanal.
--
-- Para completarlo:
--
--   1. Obtener la definición actual:
--        SELECT pg_get_viewdef('manumoda.vw_bonos_corte'::regclass, true);
--
--   2. Guardarla como script versionado (ver nota en 015_rls_preparacion).
--
--   3. En el subselect que calcula `ausentismos`, sumar también las filas
--      de vacaciones_permisos donde idcortador = <el cortador de la fila>,
--      de forma análoga a como lo hace vw_bonos_diseno:
--
--        COALESCE((
--          SELECT SUM(au.horas_totales)
--          FROM manumoda.vacaciones_permisos au
--          WHERE au.idcortador = <colaborador>
--            AND au.semana     = <semana>
--            AND au.idempresa  = <idempresa>
--            AND EXTRACT(year FROM au.fecha_inicio) = <anio>
--        ), 0)
--
--      Y lo mismo para tiempos_fuera_area con `tiempo_af`.

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name IN ('vacaciones_permisos', 'tiempos_fuera_area')
  AND column_name LIKE 'id%'
ORDER BY table_name, column_name;

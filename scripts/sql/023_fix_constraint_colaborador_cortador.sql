-- ============================================================
-- Permitir cortadores en vacaciones y tiempos fuera de área
--
-- PROBLEMA:
--   El script 017 agregó la columna `idcortador` a
--   vacaciones_permisos y tiempos_fuera_area, pero esas tablas
--   tienen restricciones CHECK escritas cuando solo existían
--   diseñadoras y costureras:
--     · vacaciones_permisos → chk_vp_colaborador
--     · tiempos_fuera_area  → chk_tf_colaborador
--   Como esas reglas exigen que el colaborador sea diseñadora o
--   costurera, guardar una vacación de cortador falla con
--   "violates check constraint". La pestaña de Vacaciones de Corte
--   no puede guardar nada.
--
-- FIX:
--   Reemplazar ambas restricciones para que acepten exactamente uno
--   de los tres roles (diseñadora, costurera o cortador).
--
-- PREREQUISITO: script 017 ejecutado (crea la columna idcortador).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. vacaciones_permisos
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.vacaciones_permisos
  DROP CONSTRAINT IF EXISTS chk_vp_colaborador;

ALTER TABLE manumoda.vacaciones_permisos
  ADD CONSTRAINT chk_vp_colaborador
  CHECK (num_nonnulls(iddisenadora, idcosturera, idcortador) = 1);

COMMENT ON CONSTRAINT chk_vp_colaborador ON manumoda.vacaciones_permisos IS
  'El ausentismo pertenece a exactamente un colaborador: diseñadora, costurera o cortador.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. tiempos_fuera_area
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.tiempos_fuera_area
  DROP CONSTRAINT IF EXISTS chk_tf_colaborador;

ALTER TABLE manumoda.tiempos_fuera_area
  ADD CONSTRAINT chk_tf_colaborador
  CHECK (num_nonnulls(iddisenadora, idcosturera, idcortador) = 1);

COMMENT ON CONSTRAINT chk_tf_colaborador ON manumoda.tiempos_fuera_area IS
  'El tiempo fuera de área pertenece a exactamente un colaborador: diseñadora, costurera o cortador.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════
--
-- Si alguna fila existente viola la regla nueva, el ALTER falla y hay que
-- revisarla primero con:
--
--   SELECT id, iddisenadora, idcosturera, idcortador
--   FROM manumoda.vacaciones_permisos
--   WHERE num_nonnulls(iddisenadora, idcosturera, idcortador) <> 1;
--
-- Tras aplicar: registrar una vacación a un cortador desde la pestaña de
-- Vacaciones en el módulo de Corte debe guardar sin error, y su fila en
-- vw_bonos_corte debe mostrar ausentismos > 0 esa semana (script 021).

SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conname IN ('chk_vp_colaborador', 'chk_tf_colaborador');

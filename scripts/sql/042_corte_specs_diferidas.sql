-- ============================================================
-- Programar corte sin las especificaciones todavía
--
-- CAMBIO DE PROCESO (pedido por operación):
--   Al programar un corte solo se decide QUIÉN lo hace y en qué
--   semana. Las especificaciones —familia, categoría, tela, trazos,
--   tendidos, complementos, metros, piezas— se capturan después, en
--   el Plan de Corte, al calificar el trabajo de la semana. Antes de
--   cortar nadie las conoce con certeza, y exigirlas por adelantado
--   obligaba a inventarlas.
--
--   Diseño se programa igual que siempre: ahí las horas sí se pueden
--   estimar de entrada.
--
-- LO ÚNICO QUE LO IMPEDÍA:
--   `metros_utilizar` era la única columna NOT NULL del bloque de
--   especificaciones. El resto ya aceptaba NULL.
--
-- `horas_plan_corte` queda en NULL hasta que se capturen las
-- especificaciones; la app lo calcula y lo guarda en ese momento.
-- Un registro sin especificaciones aporta 0 h a la carga de la
-- semana, que es lo correcto: todavía no se sabe cuánto trabajo es.
--
-- PREREQUISITO: ninguno.
-- ============================================================

ALTER TABLE manumoda.corte_programacion
  ALTER COLUMN metros_utilizar DROP NOT NULL;

COMMENT ON COLUMN manumoda.corte_programacion.metros_utilizar IS
  'Metros de tela. Se captura al calificar el corte, no al programarlo: '
  'antes de cortar todavía no se conoce.';

COMMENT ON COLUMN manumoda.corte_programacion.horas_plan_corte IS
  'Horas plan del corte. NULL mientras el registro no tenga capturadas sus '
  'especificaciones; la app la calcula al guardarlas.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La columna debe aceptar NULL ahora.
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'manumoda'
  AND table_name = 'corte_programacion'
  AND column_name IN ('metros_utilizar', 'horas_plan_corte', 'fecha', 'semana');

-- 2. Cuántos registros del plan de corte están sin especificar.
--    Recién ejecutado el script debe ser 0: los que ya existen las traen.
SELECT
  COUNT(*)                                                  AS registros,
  COUNT(*) FILTER (WHERE idfamilia_corte IS NULL)           AS sin_familia,
  COUNT(*) FILTER (WHERE metros_utilizar IS NULL)           AS sin_metros,
  COUNT(*) FILTER (WHERE horas_plan_corte IS NULL)          AS sin_horas
FROM manumoda.corte_programacion
WHERE idempresa = 1;

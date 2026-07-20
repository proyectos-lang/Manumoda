-- ============================================================
-- Unicidad de folio en diseno_programacion + índices de soporte
--
-- CONTEXTO:
--   El script 003 eliminó la restricción única de folio para
--   permitir reprogramaciones. Pero las reprogramaciones generan
--   folios NUEVOS con sufijo (ABC.2, ABC.3…), así que el folio
--   texto SÍ debe ser único. Sin la restricción:
--
--   1. vw_bonos_diseno suma TODAS las filas por persona/semana →
--      un folio duplicado infla el bono silenciosamente (las vistas
--      de tracking deduplican con LATERAL LIMIT 1, así que el
--      duplicado es invisible en pantalla).
--   2. El generador de sufijos del frontend calcula el siguiente .N
--      con un COUNT — dos inserciones concurrentes pueden colisionar.
--
--   Con el índice único, una colisión produce error 23505 visible
--   (el frontend lo captura y reintenta con el siguiente sufijo).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 1 — Detectar duplicados existentes (ejecutar ANTES del índice)
-- ════════════════════════════════════════════════════════════════════════════
-- Si esta query devuelve filas, hay duplicados que YA inflaron bonos.
-- Revisar manualmente cuál fila conservar (normalmente la de mayor id,
-- que es la más reciente) y borrar la otra ANTES de crear el índice.

SELECT folio, idempresa, COUNT(*) AS filas,
       array_agg(id ORDER BY id) AS ids
FROM manumoda.diseno_programacion
GROUP BY folio, idempresa
HAVING COUNT(*) > 1;

-- Detalle de los duplicados (para revisar antes de limpiar):
--   SELECT dp.id, dp.folio, dp.semana, dp.fecha, dp.iddisenadora,
--          dp.cumplimiento_diseno, dp.horas_plan_diseno, dp.horas_diseno_cumplidas
--   FROM manumoda.diseno_programacion dp
--   WHERE (dp.idempresa, dp.folio) IN (
--     SELECT idempresa, folio FROM manumoda.diseno_programacion
--     GROUP BY idempresa, folio HAVING COUNT(*) > 1)
--   ORDER BY dp.folio, dp.id;

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 1b — Limpieza automática
-- ════════════════════════════════════════════════════════════════════════════
-- Conserva la fila MÁS RECIENTE (mayor id) de cada grupo duplicado — que es
-- la misma que muestran las vistas de tracking (ORDER BY id DESC LIMIT 1) —
-- y elimina las anteriores. Las filas eliminadas eran las que inflaban los
-- bonos sin ser visibles en pantalla.

DELETE FROM manumoda.diseno_programacion dp
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY idempresa, folio
           ORDER BY id DESC
         ) AS rn
  FROM manumoda.diseno_programacion
) ranked
WHERE dp.id = ranked.id
  AND ranked.rn > 1;
-- Devuelve "DELETE n" — n = filas duplicadas eliminadas.

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 2 — Índice único
-- ════════════════════════════════════════════════════════════════════════════
-- Falla con "could not create unique index" si el paso 1 no está limpio.

CREATE UNIQUE INDEX IF NOT EXISTS uq_diseno_programacion_folio
  ON manumoda.diseno_programacion (idempresa, folio);

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 3 — Índices de soporte
-- ════════════════════════════════════════════════════════════════════════════
-- Hoy los LATERAL JOIN de las vistas, el trigger de propagación de
-- fecha_cancelacion y los subselects de bonos hacen seq-scan.

-- Lookups por folio en corte (LATERAL de vw_seguimiento_integrado,
-- trigger de propagación del script 008)
CREATE INDEX IF NOT EXISTS idx_corte_programacion_folio
  ON manumoda.corte_programacion (idempresa, folio);

-- Subselects de vw_bonos_diseno (rama Diseño)
CREATE INDEX IF NOT EXISTS idx_diseno_prog_disenadora_semana
  ON manumoda.diseno_programacion (iddisenadora, semana)
  WHERE iddisenadora IS NOT NULL;

-- Subselects de vw_bonos_diseno (rama Costura)
CREATE INDEX IF NOT EXISTS idx_diseno_prog_costurera_semana
  ON manumoda.diseno_programacion (idcosturera, semana)
  WHERE idcosturera IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'manumoda'
  AND tablename IN ('diseno_programacion', 'corte_programacion')
ORDER BY tablename, indexname;

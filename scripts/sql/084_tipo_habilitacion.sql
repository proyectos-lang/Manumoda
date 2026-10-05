-- ============================================================
-- Tipo de habilitación (compleja / simple) en la ficha técnica
--
-- QUÉ AGREGA:
--   Cada línea de habilitación de la ficha se marca como COMPLEJA o
--   SIMPLE. Es informativo (operación, 05-oct-2026): no completa ni
--   mueve las etapas 4 (Habilitaciones complejas) y 8 (Adquisición
--   habilitación simple), que se siguen gestionando a mano.
--
-- COLUMNA PROPIA Y NO `uso`:
--   `uso` es texto libre de las telas (forro, entretela…). El tipo de
--   habilitación tiene dos valores fijos, y mezclarlos en la misma
--   columna haría que un "SIMPLE" escrito a mano en una tela pareciera
--   una habilitación.
--
-- TAMBIÉN TRAE LA COLUMNA `uso` DEL SCRIPT 065, QUE NO SE HABÍA CORRIDO:
--   Comprobado contra la base (05-oct-2026): `ficha_materiales.uso` no
--   existe, y la ficha la manda al guardar. Resultado: hoy NO se puede
--   guardar ninguna línea de tela ni de habilitación — falla con
--   "Could not find the 'uso' column". Se repite aquí tal cual, con
--   IF NOT EXISTS, para no depender de correr el 065 aparte.
--
-- PREREQUISITO: script 057 ejecutado.
-- ============================================================

-- ── Lo del 065: el uso de la tela ──
ALTER TABLE manumoda.ficha_materiales
  ADD COLUMN IF NOT EXISTS uso text;

COMMENT ON COLUMN manumoda.ficha_materiales.uso IS
  'Uso de la tela en la prenda (forro, entretela, principal…). Texto libre: '
  'un catálogo cerrado pediría una migración por cada uso nuevo.';

CREATE INDEX IF NOT EXISTS ix_ficha_materiales_uso
  ON manumoda.ficha_materiales (idempresa, uso)
  WHERE uso IS NOT NULL;

-- ── Lo nuevo: el tipo de habilitación ──
ALTER TABLE manumoda.ficha_materiales
  ADD COLUMN IF NOT EXISTS tipo_habilitacion text;

COMMENT ON COLUMN manumoda.ficha_materiales.tipo_habilitacion IS
  'Compleja o Simple, solo en habilitaciones. Informativo: no mueve las '
  'etapas 4 y 8. NULL = sin clasificar.';

ALTER TABLE manumoda.ficha_materiales
  DROP CONSTRAINT IF EXISTS chk_ficha_materiales_tipo_habilitacion;

-- Solo dos valores, y solo en habilitaciones: en una tela no significa
-- nada. 'Habilitacion' va SIN acento: es el valor del dominio de
-- `ficha_materiales.tipo` (script 057), distinto del de `articulos`.
ALTER TABLE manumoda.ficha_materiales
  ADD CONSTRAINT chk_ficha_materiales_tipo_habilitacion
  CHECK (
    tipo_habilitacion IS NULL
    OR (tipo_habilitacion IN ('Compleja', 'Simple') AND tipo = 'Habilitacion')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las dos columnas existen. Esperado: 2 filas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ficha_materiales'
  AND column_name IN ('uso', 'tipo_habilitacion');

-- 2. Cómo están clasificadas las habilitaciones capturadas.
SELECT tipo, tipo_habilitacion, COUNT(*) AS lineas
FROM manumoda.ficha_materiales
WHERE idempresa = 1
GROUP BY tipo, tipo_habilitacion
ORDER BY tipo, tipo_habilitacion;

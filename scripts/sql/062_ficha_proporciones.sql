-- ============================================================
-- Proporción por talla en la ficha técnica
--
-- QUÉ FALTABA:
--   La ficha original tiene DOS proporciones distintas y el script 057
--   solo modeló una:
--
--   a) Un renglón "Proporcion" bajo los encabezados de talla, con un
--      valor POR TALLA (1, 1, 1, 1 en la ficha del modelo 2058). Es la
--      proporción del tendido: cuántas prendas de cada talla salen de
--      un trazo.
--
--   b) Una columna "Proporcion" al final de cada renglón de color, que
--      ya existía como `ficha_tallas.proporcion`.
--
--   Son cosas distintas: (a) es del tendido y aplica a todas las
--   tallas; (b) es del color. Sin (a), el PDF no se puede reproducir.
--
-- POR QUÉ jsonb Y NO UNA TABLA:
--   Es un valor por talla, exactamente la misma forma que
--   `cantidades`. Guardarlo igual mantiene las dos cosas juntas y
--   permite que el juego de tallas siga siendo libre.
--
-- PREREQUISITO: script 057 ejecutado.
-- ============================================================

ALTER TABLE manumoda.ficha_tallas
  /**
   * Proporción del tendido por talla: {"0X":1,"1X":1,"2X":1,"3X":1}.
   * Distinta de `proporcion`, que es la del color (columna al final).
   */
  ADD COLUMN IF NOT EXISTS proporciones jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ficha_tallas_proporciones'
  ) THEN
    ALTER TABLE manumoda.ficha_tallas
      ADD CONSTRAINT chk_ficha_tallas_proporciones
      CHECK (jsonb_typeof(proporciones) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN manumoda.ficha_tallas.proporciones IS
  'Proporción del tendido por talla, ej. {"0X":1,"1X":1}. Distinta de '
  '`proporcion`, que es la del renglón de color.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La columna existe y es jsonb. Esperado: 1 fila.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ficha_tallas'
  AND column_name = 'proporciones';

-- 2. Las dos proporciones conviven: la del tendido (por talla) y la del
--    color (una por renglón). Esperado: las dos columnas listadas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ficha_tallas'
  AND column_name IN ('proporcion', 'proporciones')
ORDER BY column_name;

-- 3. Nada se rompió: los renglones ya capturados siguen ahí.
SELECT COUNT(*) AS renglones_de_tallas FROM manumoda.ficha_tallas;

-- ============================================================
-- Eliminar constraint UNIQUE en folio de diseno_programacion
--
-- Por qué:
--   El módulo de Diseño crea una fila nueva con el mismo folio
--   cuando se reprograma una orden rechazada (patrón de historial).
--   El constraint bloqueaba esa inserción.
--
--   La vista vw_resumen_operacion ya usa LATERAL JOIN con
--   ORDER BY id DESC LIMIT 1, por lo que deduplicar a nivel
--   de constraint no es necesario.
-- ============================================================

ALTER TABLE manumoda.diseno_programacion
    DROP CONSTRAINT IF EXISTS unique_folio_diseno;

-- Por si fue creado con nombre alternativo
ALTER TABLE manumoda.diseno_programacion
    DROP CONSTRAINT IF EXISTS unite_folio_diseno;

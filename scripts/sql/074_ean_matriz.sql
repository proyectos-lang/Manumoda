-- ============================================================
-- El código EAN, uno por color y talla
--
-- POR QUÉ CAMBIA:
--   El script 072 guardó UN EAN por folio, que era lo pedido entonces.
--   Pero en el comercio un EAN identifica un SKU: la misma blusa en
--   negro talla M y en blanco talla L son dos códigos distintos. Un
--   solo código por folio no sirve para etiquetar la prenda.
--
--   Decisión de operación (24-sep-2026): se captura una matriz, colores
--   en filas y tallas en columnas, igual que el reparto de piezas.
--
-- POR QUÉ UNA TABLA Y NO COLUMNAS:
--   Las tallas cambian por cliente y por familia —hoy CH/M/G/XG, mañana
--   28/30/32/34—. Con columnas fijas cada juego nuevo sería una
--   migración. Se usa la misma forma que `ficha_tallas`: una fila por
--   color y un jsonb {talla: código}.
--
-- POR QUÉ NO SE METE EN ficha_tallas:
--   Esa tabla guarda CANTIDADES y se reescribe entera al aplicar el
--   reparto. Los códigos no deben borrarse porque alguien recalculó las
--   piezas: son dato del cliente, no del plan de producción.
--
-- QUÉ PASA CON codigo_ean DEL 072:
--   Se queda. Vale como código general del folio cuando el cliente da
--   uno solo, y ya hay fichas capturadas con él. La matriz es el
--   detalle; el general es el respaldo.
--
-- NO SE VALIDA EL DÍGITO VERIFICADOR:
--   Igual que en el 072: un código mal tecleado no debe impedir guardar
--   la ficha. Solo se exige que sean dígitos.
--
-- PREREQUISITO: script 072 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La tabla
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.ficha_ean (
  id         serial PRIMARY KEY,
  idempresa  integer NOT NULL,
  folio      text    NOT NULL,
  color      text    NOT NULL,
  /** El orden de captura, para que la matriz se lea igual que el reparto. */
  orden      integer NOT NULL DEFAULT 1,
  /**
   * Los códigos por talla: {"CH":"7501234567890","M":"7501234567906"}.
   *
   * Una talla sin código simplemente no está en el objeto. Vacío no es
   * lo mismo que cero aquí: significa que el cliente no lo dio.
   */
  codigos    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_ficha_ean_codigos CHECK (jsonb_typeof(codigos) = 'object')
);

COMMENT ON TABLE manumoda.ficha_ean IS
  'Los códigos de barras de la ficha, uno por color y talla. Misma '
  'forma que ficha_tallas, pero tabla aparte: aplicar el reparto '
  'reescribe las cantidades y no debe borrar los códigos.';

COMMENT ON COLUMN manumoda.ficha_ean.codigos IS
  'jsonb {talla: código}. La talla sin código no aparece: el cliente '
  'no lo dio, que es distinto de darlo vacío.';

-- Un color, una fila. Si se captura dos veces el mismo, es la misma.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ficha_ean_folio_color
  ON manumoda.ficha_ean (idempresa, folio, color);

CREATE INDEX IF NOT EXISTS ix_ficha_ean_folio
  ON manumoda.ficha_ean (idempresa, folio);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Que los códigos sean dígitos
--
--    Se valida el CONTENIDO del jsonb, no solo su forma: un código con
--    letras entró mal y conviene atajarlo. Pero se admite la cadena
--    vacía —es como queda una celda que se escribió y se borró— y el
--    largo no se exige, igual que en el 072.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_ean_codigos_validos(p_codigos jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_each_text(p_codigos) AS e(talla, codigo)
    WHERE e.codigo <> '' AND e.codigo !~ '^[0-9]{1,14}$'
  );
$$;

COMMENT ON FUNCTION manumoda.fn_ean_codigos_validos(jsonb) IS
  'Cierto si todos los códigos del objeto son dígitos (o vacíos). No '
  'exige el largo ni el dígito verificador: un código a medio teclear '
  'no debe impedir guardar la ficha.';

ALTER TABLE manumoda.ficha_ean
  DROP CONSTRAINT IF EXISTS chk_ficha_ean_solo_digitos;

ALTER TABLE manumoda.ficha_ean
  ADD CONSTRAINT chk_ficha_ean_solo_digitos
  CHECK (manumoda.fn_ean_codigos_validos(codigos));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Cuántos códigos lleva cada folio, para la ficha
--
--    La pantalla necesita saber si la matriz está capturada sin
--    traerse todas las filas. Se cuenta aquí.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_ficha_ean_resumen AS
SELECT
  e.idempresa,
  e.folio,
  COUNT(*)                                   AS colores,
  SUM(c.capturados)                          AS codigos
FROM manumoda.ficha_ean e
CROSS JOIN LATERAL (
  SELECT COUNT(*) AS capturados
  FROM jsonb_each_text(e.codigos) AS x(talla, codigo)
  WHERE x.codigo <> ''
) c
GROUP BY e.idempresa, e.folio;

COMMENT ON VIEW manumoda.vw_ficha_ean_resumen IS
  'Cuántos colores y cuántos códigos no vacíos tiene la matriz de cada '
  'folio.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La tabla existe con sus columnas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ficha_ean'
ORDER BY ordinal_position;

-- 2. La restricción acepta dígitos y vacíos, y rechaza letras.
--    El primero pasa; el segundo falla con 23514.
-- INSERT INTO manumoda.ficha_ean (idempresa, folio, color, codigos)
-- VALUES (1, 'PRUEBA-EAN', 'NEGRO', '{"CH":"7501234567890","M":""}'::jsonb);
-- INSERT INTO manumoda.ficha_ean (idempresa, folio, color, codigos)
-- VALUES (1, 'PRUEBA-EAN2', 'BLANCO', '{"CH":"ABC"}'::jsonb);

-- 3. El resumen cuenta solo los no vacíos. Esperado para la prueba: 1.
-- SELECT * FROM manumoda.vw_ficha_ean_resumen WHERE folio = 'PRUEBA-EAN';

-- 4. Limpieza de la prueba.
-- DELETE FROM manumoda.ficha_ean WHERE folio LIKE 'PRUEBA-EAN%';

-- 5. Cuántos folios traen ya la matriz. Esperado al principio: 0 filas.
SELECT * FROM manumoda.vw_ficha_ean_resumen WHERE idempresa = 1;

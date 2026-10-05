-- ============================================================
-- Despacho: distribución por proporción, sin color ni tallas
--
-- QUÉ CAMBIA:
--   El 080 pedía, por cada caja, su color y piezas por talla. Se
--   simplifica (operación, 05-oct-2026): se captura el TOTAL a
--   despachar y una distribución como "1, 2, 1, 2". Cada número es una
--   caja, y el total se reparte en esa proporción:
--     600 piezas con 1,2,1,2 → 100, 200, 100, 200.
--   Cada caja conserva si es caja o bulto.
--
-- DÓNDE SE GUARDA:
--   El total y la distribución van en la cabecera (`despachos`). Las
--   piezas que tocan a cada caja siguen en `despacho_empaques`, que es
--   lo que se rotula y lo que se cuenta; la pantalla las calcula y la
--   función comprueba que sumen el total.
--
--   Las columnas `tallas`, `color` y `cantidades` del 080 se quedan
--   —vacías de ahora en adelante— por si vuelve a hacer falta el
--   detalle. Quitarlas no aporta nada y obligaría a migrar.
--
-- POR QUÉ SE BORRA LA FUNCIÓN ANTERIOR:
--   Se le agregan dos parámetros. CREATE OR REPLACE con otra lista crea
--   una sobrecarga y la llamada queda ambigua (42725), como ya pasó con
--   fn_crear_orden en el 075.
--
-- PREREQUISITO: script 080 ejecutado.
-- ============================================================

ALTER TABLE manumoda.despachos
  ADD COLUMN IF NOT EXISTS total_piezas integer;

ALTER TABLE manumoda.despachos
  ADD COLUMN IF NOT EXISTS distribucion integer[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN manumoda.despachos.total_piezas IS
  'Piezas a despachar. Se reparten entre las cajas según `distribucion`.';

COMMENT ON COLUMN manumoda.despachos.distribucion IS
  'Proporción por caja, en orden: {1,2,1,2} = cuatro cajas, la 2 y la 4 '
  'llevan el doble. Su largo es el número de empaques.';

ALTER TABLE manumoda.despachos
  DROP CONSTRAINT IF EXISTS chk_despachos_distribucion;

ALTER TABLE manumoda.despachos
  ADD CONSTRAINT chk_despachos_distribucion
  CHECK (0 < ALL (distribucion) OR cardinality(distribucion) = 0);

DROP FUNCTION IF EXISTS manumoda.fn_guardar_despacho(
  integer, text, date, time, text, text[], jsonb, text, text, text, text
);

CREATE OR REPLACE FUNCTION manumoda.fn_guardar_despacho(
  p_idempresa    integer,
  p_folio        text,
  p_fecha        date,
  p_hora         time,
  p_cedi         text,
  p_tallas       text[],
  p_empaques     jsonb,
  p_pdf_path     text,
  p_pdf_nombre   text,
  p_notas        text,
  p_usuario      text,
  p_total        integer   DEFAULT NULL,
  p_distribucion integer[] DEFAULT '{}'
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_total integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM manumoda.ordenes_produccion
    WHERE idempresa = p_idempresa AND folio = p_folio
  ) THEN
    RAISE EXCEPTION 'El folio % no existe', p_folio;
  END IF;

  IF jsonb_typeof(COALESCE(p_empaques, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Los empaques deben venir como una lista';
  END IF;

  -- La distribución define cuántas cajas hay: si no coincide con los
  -- empaques que llegan, algo se desfasó en pantalla y no se guarda.
  IF cardinality(COALESCE(p_distribucion, '{}')) > 0
     AND cardinality(p_distribucion) <> jsonb_array_length(COALESCE(p_empaques, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'La distribución tiene % cajas y llegaron % empaques',
      cardinality(p_distribucion), jsonb_array_length(p_empaques);
  END IF;

  UPDATE manumoda.ordenes_produccion
  SET fecha_despacho_cliente = p_fecha,
      hora_despacho_cliente  = CASE WHEN p_fecha IS NULL THEN NULL ELSE p_hora END
  WHERE idempresa = p_idempresa AND folio = p_folio;

  INSERT INTO manumoda.despachos (
    idempresa, folio, cedi_destino, tallas, pdf_path, pdf_nombre, notas,
    capturado_por, total_piezas, distribucion, updated_at
  ) VALUES (
    p_idempresa, p_folio, NULLIF(btrim(p_cedi), ''),
    COALESCE(p_tallas, '{}'), p_pdf_path, p_pdf_nombre,
    NULLIF(btrim(p_notas), ''), p_usuario,
    p_total, COALESCE(p_distribucion, '{}'), now()
  )
  ON CONFLICT (idempresa, folio) DO UPDATE SET
    cedi_destino  = EXCLUDED.cedi_destino,
    tallas        = EXCLUDED.tallas,
    pdf_path      = EXCLUDED.pdf_path,
    pdf_nombre    = EXCLUDED.pdf_nombre,
    notas         = EXCLUDED.notas,
    capturado_por = EXCLUDED.capturado_por,
    total_piezas  = EXCLUDED.total_piezas,
    distribucion  = EXCLUDED.distribucion,
    updated_at    = now();

  DELETE FROM manumoda.despacho_empaques
  WHERE idempresa = p_idempresa AND folio = p_folio;

  INSERT INTO manumoda.despacho_empaques (
    idempresa, folio, numero, tipo, color, cantidades, piezas
  )
  SELECT
    p_idempresa,
    p_folio,
    (e.ordinal)::integer,
    COALESCE(NULLIF(e.item->>'tipo', ''), 'Caja'),
    NULLIF(btrim(e.item->>'color'), ''),
    COALESCE(e.item->'cantidades', '{}'::jsonb),
    CASE
      WHEN jsonb_typeof(e.item->'cantidades') = 'object'
       AND e.item->'cantidades' <> '{}'::jsonb
      THEN (SELECT COALESCE(SUM((v.value)::numeric), 0)::integer
            FROM jsonb_each_text(e.item->'cantidades') v
            WHERE v.value ~ '^[0-9]+(\.[0-9]+)?$')
      ELSE COALESCE((e.item->>'piezas')::integer, 0)
    END
  FROM jsonb_array_elements(COALESCE(p_empaques, '[]'::jsonb))
       WITH ORDINALITY AS e(item, ordinal);

  SELECT COALESCE(SUM(piezas), 0) INTO v_total
  FROM manumoda.despacho_empaques
  WHERE idempresa = p_idempresa AND folio = p_folio;

  -- El reparto tiene que cuadrar con el total: la pantalla redondea de
  -- modo que siempre sume, así que un descuadre aquí es un error.
  IF p_total IS NOT NULL AND v_total <> p_total THEN
    RAISE EXCEPTION 'Las cajas suman % y el total es %', v_total, p_total;
  END IF;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_guardar_despacho IS
  'Guarda día, hora, CEDI, total, distribución, empaques y PDF del '
  'despacho en una transacción. Rechaza el guardado si las cajas no '
  'suman el total o no coinciden con la distribución.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Una sola función, con 13 parámetros.
SELECT p.oid::regprocedure AS firma
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'manumoda' AND p.proname = 'fn_guardar_despacho';

-- 2. Prueba: 600 piezas con 1,2,1,2 → 100, 200, 100, 200. Luego se deshace.
-- SELECT manumoda.fn_guardar_despacho(
--   1, '2203', CURRENT_DATE + 3, '10:00', 'CEDI PRUEBA', '{}',
--   '[{"tipo":"Caja","piezas":100},{"tipo":"Caja","piezas":200},
--     {"tipo":"Bulto","piezas":100},{"tipo":"Caja","piezas":200}]'::jsonb,
--   NULL, NULL, NULL, 'prueba', 600, ARRAY[1,2,1,2]);
-- SELECT numero, tipo, piezas FROM manumoda.despacho_empaques
-- WHERE folio = '2203' ORDER BY numero;
-- DELETE FROM manumoda.despacho_empaques WHERE folio = '2203';
-- DELETE FROM manumoda.despachos WHERE folio = '2203';
-- UPDATE manumoda.ordenes_produccion
-- SET fecha_despacho_cliente = NULL, hora_despacho_cliente = NULL
-- WHERE folio = '2203';

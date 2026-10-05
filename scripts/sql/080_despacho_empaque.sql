-- ============================================================
-- Detalle de empaque del despacho a cliente (etapa 11)
--
-- QUÉ SE CAPTURA, JUNTO AL DÍA Y LA HORA DEL DESPACHO:
--   · El CEDI de destino.
--   · Cada empaque: si es caja o bulto, su color y cuántas piezas lleva
--     de cada talla. De ahí salen solos el número de cajas, de bultos y
--     el total de piezas: no se teclean aparte para que no se
--     contradigan con el detalle.
--   · Un PDF de registro o respaldo de la entrega.
--   (operación, 05-oct-2026)
--
-- POR QUÉ UNA FILA POR EMPAQUE Y NO UN TOTAL:
--   La distribución es por caja —la 1 lleva 12 M y 12 G, la 2 lleva 24
--   CH— y eso es lo que pide el CEDI al recibir. Un total por talla no
--   permite reconstruir qué va en cada caja.
--
-- POR QUÉ LAS TALLAS SON LIBRES Y NO SALEN SIEMPRE DE LA FICHA:
--   Hoy solo un folio tiene reparto por talla capturado en la ficha.
--   Exigirlo bloquearía el despacho de todo lo demás. La pantalla
--   propone las tallas de la ficha cuando existen; si no, una escala.
--
-- GUARDADO ATÓMICO:
--   `fn_guardar_despacho` escribe la cabecera, reemplaza los empaques y
--   actualiza día y hora de la orden en UNA transacción. Desde el
--   navegador serían tres llamadas, y un corte entre la segunda y la
--   tercera dejaría las cajas borradas y sin reemplazo.
--
-- EL PDF:
--   Bucket PRIVADO `despachos`: el respaldo de entrega lleva datos del
--   cliente y no debe quedar en una URL pública. Se abre con un enlace
--   firmado que caduca.
--
--   OJO: la app no usa la autenticación de Supabase —tiene su propio
--   login— y habla con la base con la llave anónima. Por eso las
--   políticas del bucket son para `anon`. Es el mismo guardarraíl que
--   el resto del sistema (script 015): impide el acceso desde fuera
--   del bucket, no a quien tenga la llave de la app.
--
-- PREREQUISITO: script 079 ejecutado.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La cabecera del despacho: una por folio
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.despachos (
  id            serial PRIMARY KEY,
  idempresa     integer NOT NULL,
  folio         text    NOT NULL,
  cedi_destino  text,
  -- Las columnas de talla de la distribución, en el orden en que se
  -- capturan. Se guardan aparte de los empaques para que una talla sin
  -- piezas en ninguna caja siga apareciendo como columna.
  tallas        text[]  NOT NULL DEFAULT '{}',
  -- Ruta dentro del bucket `despachos`, no URL: el enlace es firmado y
  -- caduca, así que se genera al abrirlo.
  pdf_path      text,
  pdf_nombre    text,
  notas         text,
  capturado_por text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_despachos_folio
  ON manumoda.despachos (idempresa, folio);

COMMENT ON TABLE manumoda.despachos IS
  'Detalle del despacho a cliente (etapa 11): CEDI, tallas de la '
  'distribución y PDF de respaldo. Día y hora viven en la orden, junto '
  'al apartado del maquilero, porque el calendario los lee de ahí.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Los empaques: una fila por caja o bulto
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.despacho_empaques (
  id          serial PRIMARY KEY,
  idempresa   integer NOT NULL,
  folio       text    NOT NULL,
  -- El número de la caja: 1, 2, 3… Es lo que se rotula en el empaque.
  numero      integer NOT NULL,
  tipo        text    NOT NULL DEFAULT 'Caja',
  color       text,
  -- {talla: piezas}. Vacío cuando no se detalla por talla: entonces
  -- manda `piezas`.
  cantidades  jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Total del empaque. Si hay detalle por talla, la función lo
  -- recalcula como su suma: nunca se contradicen.
  piezas      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_despacho_empaque_tipo
    CHECK (tipo IN ('Caja', 'Bulto')),
  CONSTRAINT chk_despacho_empaque_numero
    CHECK (numero > 0),
  CONSTRAINT chk_despacho_empaque_piezas
    CHECK (piezas >= 0),
  CONSTRAINT chk_despacho_empaque_cantidades
    CHECK (jsonb_typeof(cantidades) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_despacho_empaques_numero
  ON manumoda.despacho_empaques (idempresa, folio, numero);

COMMENT ON TABLE manumoda.despacho_empaques IS
  'Cada caja o bulto del despacho, con su color y piezas por talla. El '
  'número de cajas y el total de piezas se derivan de aquí.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Guardar todo de una vez
-- ════════════════════════════════════════════════════════════════════════════

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
  p_usuario      text
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

  -- Día y hora en la orden: es donde los lee el calendario. Sin día no
  -- hay hora (la restricción del 079 lo exige).
  UPDATE manumoda.ordenes_produccion
  SET fecha_despacho_cliente = p_fecha,
      hora_despacho_cliente  = CASE WHEN p_fecha IS NULL THEN NULL ELSE p_hora END
  WHERE idempresa = p_idempresa AND folio = p_folio;

  INSERT INTO manumoda.despachos (
    idempresa, folio, cedi_destino, tallas, pdf_path, pdf_nombre, notas,
    capturado_por, updated_at
  ) VALUES (
    p_idempresa, p_folio, NULLIF(btrim(p_cedi), ''),
    COALESCE(p_tallas, '{}'), p_pdf_path, p_pdf_nombre,
    NULLIF(btrim(p_notas), ''), p_usuario, now()
  )
  ON CONFLICT (idempresa, folio) DO UPDATE SET
    cedi_destino  = EXCLUDED.cedi_destino,
    tallas        = EXCLUDED.tallas,
    pdf_path      = EXCLUDED.pdf_path,
    pdf_nombre    = EXCLUDED.pdf_nombre,
    notas         = EXCLUDED.notas,
    capturado_por = EXCLUDED.capturado_por,
    updated_at    = now();

  -- Los empaques se reemplazan completos: es una lista que se edita
  -- entera en pantalla, y reconciliar fila por fila no aporta nada.
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
    -- Con detalle por talla, el total es su suma; sin él, el que venga.
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

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_guardar_despacho IS
  'Guarda día, hora, CEDI, tallas, empaques y PDF del despacho en una '
  'transacción. Los empaques se numeran por su orden en la lista y su '
  'total se recalcula desde el detalle por talla. Devuelve las piezas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. El bucket del PDF
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('despachos', 'despachos', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS despachos_leer      ON storage.objects;
DROP POLICY IF EXISTS despachos_subir     ON storage.objects;
DROP POLICY IF EXISTS despachos_reemplaza ON storage.objects;
DROP POLICY IF EXISTS despachos_borrar    ON storage.objects;

CREATE POLICY despachos_leer ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'despachos');

CREATE POLICY despachos_subir ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'despachos');

CREATE POLICY despachos_reemplaza ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'despachos')
  WITH CHECK (bucket_id = 'despachos');

CREATE POLICY despachos_borrar ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'despachos');

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Las dos tablas y la función existen.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'manumoda'
  AND table_name IN ('despachos', 'despacho_empaques');

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'manumoda' AND routine_name = 'fn_guardar_despacho';

-- 2. El bucket existe, es privado y solo acepta PDF de hasta 10 MB.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'despachos';

-- 3. Prueba de punta a punta: guardar, comprobar y deshacer.
--    Esperado: devuelve 48 (24 + 24); la caja 1 queda con piezas = 24
--    aunque se mande 999, porque manda el detalle por talla.
-- SELECT manumoda.fn_guardar_despacho(
--   1, '2203', CURRENT_DATE + 3, '10:00', 'CEDI PRUEBA',
--   ARRAY['CH','M','G'],
--   '[{"tipo":"Caja","color":"NEGRO","cantidades":{"CH":8,"M":8,"G":8},"piezas":999},
--     {"tipo":"Bulto","color":"BLANCO","cantidades":{},"piezas":24}]'::jsonb,
--   NULL, NULL, NULL, 'prueba');
-- SELECT numero, tipo, color, cantidades, piezas
-- FROM manumoda.despacho_empaques WHERE folio = '2203' ORDER BY numero;
-- DELETE FROM manumoda.despacho_empaques WHERE folio = '2203';
-- DELETE FROM manumoda.despachos WHERE folio = '2203';
-- UPDATE manumoda.ordenes_produccion
-- SET fecha_despacho_cliente = NULL, hora_despacho_cliente = NULL
-- WHERE folio = '2203';

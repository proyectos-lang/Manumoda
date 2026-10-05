-- ============================================================
-- Permisos del bucket `fichas` (fotos de la ficha técnica)
--
-- POR QUÉ HACE FALTA:
--   El bucket se creó desde el panel de Supabase, pero sin políticas:
--   Storage trae RLS activado y, sin una política que lo permita, la
--   subida desde la app falla con "new row violates row-level security
--   policy". Comprobado con la llave de la app (05-oct-2026).
--
-- PÚBLICO, A DIFERENCIA DE `despachos`:
--   La ficha muestra la foto con getPublicUrl y la imprime en el PDF.
--   Es la foto de una prenda, sin datos del cliente; el respaldo de
--   despacho sí los lleva, por eso aquel es privado y este no.
--
-- Las políticas son para `anon` por la misma razón que en el 080: la
-- app usa su propio login y habla con la base con la llave anónima.
-- ============================================================

UPDATE storage.buckets
SET public             = true,
    file_size_limit    = 5242880,   -- 5 MB: una foto de prenda no necesita más
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'fichas';

DROP POLICY IF EXISTS fichas_leer      ON storage.objects;
DROP POLICY IF EXISTS fichas_subir     ON storage.objects;
DROP POLICY IF EXISTS fichas_reemplaza ON storage.objects;
DROP POLICY IF EXISTS fichas_borrar    ON storage.objects;

CREATE POLICY fichas_leer ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'fichas');

CREATE POLICY fichas_subir ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'fichas');

-- La ficha sube con upsert: cambiar la foto reemplaza el archivo, y eso
-- es un UPDATE sobre storage.objects.
CREATE POLICY fichas_reemplaza ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'fichas')
  WITH CHECK (bucket_id = 'fichas');

CREATE POLICY fichas_borrar ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'fichas');

-- Verificación: público, 5 MB, solo imágenes.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'fichas';

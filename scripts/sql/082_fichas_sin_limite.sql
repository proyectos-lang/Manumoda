-- ============================================================
-- Fotos de la ficha técnica sin límite de 5 MB
--
-- El 081 puso 5 MB por bucket, y las fotos del celular lo pasan: se
-- rechazaban. Se quita (operación, 05-oct-2026). NULL = el bucket usa
-- el límite global de Storage del proyecto, que se ajusta en Supabase
-- › Project Settings › Storage (50 MB por omisión).
--
-- Los formatos se mantienen: JPG, PNG y WebP.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = NULL
WHERE id = 'fichas';

-- Verificación: file_size_limit vacío.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'fichas';

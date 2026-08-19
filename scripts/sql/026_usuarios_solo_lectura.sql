-- ============================================================
-- Usuarios de solo lectura
--
-- Un usuario de solo lectura ve los módulos que tenga asignados
-- en permisos_modulo, pero no puede crear, editar ni eliminar
-- nada en ninguno de ellos.
--
-- ADVERTENCIA — esto NO es una frontera de seguridad
-- ---------------------------------------------------
-- La aplicación habla con Supabase usando la anon key desde el
-- navegador y las tablas siguen SIN RLS (ver script 015). El
-- modo de solo lectura se aplica en el cliente: bloquea la UI y
-- las llamadas que hace la app, pero alguien con la consola del
-- navegador todavía puede escribir directo contra la API.
--
-- Para que sea una restricción real hace falta RLS + un rol de
-- base de datos por usuario. Mientras tanto esto sirve para
-- evitar cambios accidentales, no para contener a un usuario
-- malintencionado.
-- ============================================================

ALTER TABLE manumoda.usuarios
  ADD COLUMN IF NOT EXISTS solo_lectura boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN manumoda.usuarios.solo_lectura IS
  'El usuario puede ver sus módulos pero no modificar nada. '
  'Se aplica en el cliente (sin RLS no es una restricción real). '
  'Excluyente con es_admin.';

-- Un administrador nunca es de solo lectura: administra usuarios y catálogos.
UPDATE manumoda.usuarios SET solo_lectura = false WHERE es_admin = true;

ALTER TABLE manumoda.usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_admin_no_solo_lectura;

ALTER TABLE manumoda.usuarios
  ADD CONSTRAINT chk_usuarios_admin_no_solo_lectura
  CHECK (NOT (es_admin AND solo_lectura));

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

SELECT username, nombre, es_admin, solo_lectura, activo
FROM manumoda.usuarios
WHERE idempresa = 1
ORDER BY es_admin DESC, username;

-- ============================================================
-- Composición de tela: el uso que se le da a cada tela
--
-- QUÉ AGREGA:
--   `ficha_materiales.uso`: forro, entretela, tela principal, vista…
--
--   Es texto libre a propósito. Un catálogo cerrado obligaría a pedir
--   una migración cada vez que aparezca un uso nuevo, y operación ya
--   tiene los suyos. La app sugiere los que ya están capturados, así
--   que la lista se arma sola sin encerrar a nadie.
--
-- POR QUÉ NO SE BORRA `color`:
--   La captura deja de pedirlo —la tela ya trae su color desde el
--   catálogo de Inventarios, así que escribirlo otra vez era duplicar
--   el dato— pero la columna se queda.
--
--   Borrar una columna es irreversible y aquí no gana nada: son 0
--   filas con color capturado hoy, y la columna sigue sirviendo a las
--   habilitaciones, que sí la usan.
--
-- PREREQUISITO: script 057 ejecutado.
-- ============================================================

ALTER TABLE manumoda.ficha_materiales
  /**
   * Para qué va esta tela en la prenda: FORRO, ENTRETELA, PRINCIPAL…
   * Texto libre: los usos los define operación, no el esquema.
   */
  ADD COLUMN IF NOT EXISTS uso text;

COMMENT ON COLUMN manumoda.ficha_materiales.uso IS
  'Uso de la tela en la prenda (forro, entretela, principal…). Texto libre: '
  'un catálogo cerrado pediría una migración por cada uso nuevo.';

COMMENT ON COLUMN manumoda.ficha_materiales.color IS
  'Color del material. En telas ya no se captura —viene del catálogo de '
  'Inventarios— pero se conserva para las habilitaciones y para no perder '
  'lo ya registrado.';

-- Índice para sugerir los usos ya capturados sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS ix_ficha_materiales_uso
  ON manumoda.ficha_materiales (idempresa, uso)
  WHERE uso IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La columna existe. Esperado: 1 fila.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ficha_materiales'
  AND column_name = 'uso';

-- 2. Nada se perdió: siguen las filas que había.
SELECT tipo, COUNT(*) AS filas
FROM manumoda.ficha_materiales
WHERE idempresa = 1
GROUP BY tipo;

-- 3. El catálogo de telas está disponible para el buscador. Esperado: 756.
SELECT COUNT(*) AS telas
FROM manumoda.articulos
WHERE idempresa = 1 AND tipo = 'Tela' AND activo;

-- 4. Los usos ya capturados, que la app ofrece como sugerencia.
SELECT uso, COUNT(*) AS veces
FROM manumoda.ficha_materiales
WHERE idempresa = 1 AND uso IS NOT NULL
GROUP BY uso
ORDER BY veces DESC;

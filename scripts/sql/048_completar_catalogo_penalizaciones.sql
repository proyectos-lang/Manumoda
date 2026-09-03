-- ============================================================
-- Completar el catálogo de penalizaciones
--
-- QUÉ PASÓ:
--   Del script 046 se aplicó la vista (sección 3) pero no los
--   cambios al catálogo (secciones 1 y 2). Verificado contra la
--   base: `mas_3_parciales` sigue activa como check, y no existen
--   `sin_muestra_original` ni `parcialidad_excedente`.
--
--   La vista SÍ quedó bien: cuenta parcialidades y las cobra. Como
--   el monto tiene respaldo —COALESCE(pm.monto, 500)— siguió dando
--   $500 por excedente aunque faltara la fila de parámetro. Por eso
--   el cálculo no se rompió y el faltante pasó desapercibido.
--
-- QUÉ CORRIGE:
--   1. `mas_3_parciales` se desactiva: dejó de ser un check manual
--      porque la vista ya la calcula sola. Si sigue activa se cobra
--      DOS VECES — una automática y otra si alguien la palomea.
--   2. Alta de `sin_muestra_original` ($500, manual).
--   3. Alta de `parcialidad_excedente` ($500, inactiva): es el
--      parámetro del monto por excedente, no un check. Inactiva
--      para que no aparezca como casilla en la pantalla del folio.
--
-- No toca la vista: esa ya está correcta.
--
-- PREREQUISITO: scripts 043 a 047 ejecutados.
-- ============================================================

-- 1. Deja de ofrecerse como check: la vista ya la calcula.
UPDATE manumoda.cat_penalizaciones_maquila
SET activo = false
WHERE idempresa = 1 AND clave = 'mas_3_parciales';

-- 2. Concepto manual nuevo.
INSERT INTO manumoda.cat_penalizaciones_maquila (idempresa, clave, nombre, monto, orden)
VALUES (1, 'sin_muestra_original', 'Sin entrega de muestra original', 500.00, 40)
ON CONFLICT (idempresa, clave) DO NOTHING;

-- 3. El monto por parcialidad excedente. Vive en el catálogo para poder
--    ajustarlo desde la app, pero inactivo: es parámetro, no casilla.
INSERT INTO manumoda.cat_penalizaciones_maquila (idempresa, clave, nombre, monto, orden, activo)
VALUES (1, 'parcialidad_excedente',
        'Por cada parcialidad a partir de la cuarta (automática)', 500.00, 35, false)
ON CONFLICT (idempresa, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El catálogo completo. Esperado:
--      activa    Sin entrega de Packing List          500
--      activa    No apartó fecha de entrega           500
--      INACTIVA  Entrega en más de 3 parcialidades    500   (ahora automática)
--      INACTIVA  Por cada parcialidad…                500   (parámetro)
--      activa    Sin entrega de muestra original      500
SELECT clave, nombre, monto, orden, activo
FROM manumoda.cat_penalizaciones_maquila
WHERE idempresa = 1
ORDER BY orden;

-- 2. Los conceptos que se ofrecen como check deben ser exactamente tres.
SELECT COUNT(*) AS checks_activos
FROM manumoda.cat_penalizaciones_maquila
WHERE idempresa = 1 AND activo;

-- 3. Nadie debe tener marcada a mano la de parcialidades: se cobraría dos
--    veces, porque la vista ya la calcula. 0 filas.
SELECT pf.folio, c.nombre, pf.monto_aplicado
FROM manumoda.maquila_penalizaciones_fijas pf
JOIN manumoda.cat_penalizaciones_maquila c ON c.id = pf.idpenalizacion
WHERE pf.idempresa = 1 AND c.clave = 'mas_3_parciales';

-- 4. El monto del parámetro debe coincidir con el que usa la vista.
SELECT DISTINCT monto_parcialidad FROM manumoda.vw_pago_maquilas WHERE idempresa = 1;

-- ============================================================
-- Los tres conceptos manuales valen $500, no $1,000
--
-- El mockup los dibujaba en $1,000 y así se sembraron en el
-- script 043. Operación confirmó que el monto correcto es $500.
--
-- Se corrige el CATÁLOGO, que es lo que se aplica de aquí en
-- adelante. Los folios que ya tuvieran una penalización marcada
-- conservan su `monto_aplicado` congelado —para eso existe esa
-- columna—; hoy no hay ninguno, así que el cambio es total.
--
-- El seed del script 043 también quedó corregido, para que una
-- instalación nueva nazca en $500.
--
-- PREREQUISITO: script 043 ejecutado.
-- ============================================================

UPDATE manumoda.cat_penalizaciones_maquila
SET monto = 500.00
WHERE idempresa = 1
  AND clave IN ('sin_packing_list', 'sin_apartar_fecha', 'mas_3_parciales');

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El catálogo: los tres deben quedar en 500.00.
SELECT clave, nombre, monto, orden, activo
FROM manumoda.cat_penalizaciones_maquila
WHERE idempresa = 1
ORDER BY orden;

-- 2. Folios que ya tenían una penalización marcada con el monto viejo.
--    Conservan lo congelado a propósito: cambiar el catálogo no reescribe
--    hacia atrás lo que ya se le descontó a un maquilero.
SELECT pf.folio, c.nombre, pf.monto_aplicado, c.monto AS monto_vigente
FROM manumoda.maquila_penalizaciones_fijas pf
JOIN manumoda.cat_penalizaciones_maquila c ON c.id = pf.idpenalizacion
WHERE pf.idempresa = 1 AND pf.monto_aplicado <> c.monto;

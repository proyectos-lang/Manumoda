-- ============================================================
-- OPCIONAL — Vincular la prenda en los registros que la tienen suelta
--
-- NO hace falta para que el módulo de diseño deje de tener folios
-- sin horas: los 24 registros con `idprenda` NULL sí tienen horas
-- de plan de diseño, capturadas a mano en su momento.
--
-- LO QUE SÍ ARREGLA:
--   Sin `idprenda` el trigger nunca recalcula el plan de diseño de
--   esas filas —cae en la rama que conserva el valor manual—, así
--   que quedan fuera de cualquier cambio de catálogo para siempre.
--   Las 24 familias existen en `cat_prendas`, así que la vinculación
--   es directa por nombre.
--
-- LO QUE CUESTA:
--   Vincular la prenda dispara el recálculo (idprenda es insumo de
--   la fórmula) y esas 24 filas pasan de su valor manual al que
--   dictan los catálogos vigentes. SUBEN 65.85 h en total. Ejemplos:
--
--     folio 2310  CHAMARRA   NUEVO       3.00 h → 5.45 h
--     folio 2314  CHALECO    NUEVO       2.00 h → 4.45 h
--     folio 2272  JEANS      RESURTIDO   1.00 h → 4.30 h
--
--   Son horas que alimentan bonos. Ejecútalo solo si operación
--   acepta que esos 24 registros se recalculen.
--
-- PREREQUISITO: script 040 ejecutado.
-- ============================================================

-- Antes de correrlo: el detalle completo de lo que va a cambiar.
SELECT
  dp.folio,
  dp.familia,
  dp.tipo,
  dp.horas_plan_diseno                                   AS horas_hoy,
  ROUND((cp.horas_base
         * COALESCE(ct.multiplicador, 1)
         * COALESCE(cd.multiplicador, 1)
         + COALESCE((
             SELECT SUM(ca.horas)
             FROM manumoda.cat_adiciones_diseno ca
             WHERE ca.idempresa = dp.idempresa
               AND ((ca.clave = 'muchas_operaciones'    AND dp.muchas_operaciones    IS TRUE)
                 OR (ca.clave = 'telas_pesadas'         AND dp.telas_pesadas         IS TRUE)
                 OR (ca.clave = 'muchas_habilitaciones' AND dp.muchas_habilitaciones IS TRUE)
                 OR (ca.clave = 'prenda_compleja'       AND dp.prenda_compleja       IS TRUE))
           ), 0)) * 100) / 100                           AS horas_despues
FROM manumoda.diseno_programacion dp
JOIN manumoda.cat_prendas cp
  ON cp.nombre = dp.familia AND cp.idempresa = dp.idempresa
LEFT JOIN manumoda.cat_tipo_diseno ct
  ON ct.nombre = dp.tipo AND ct.idempresa = dp.idempresa
LEFT JOIN manumoda.cat_categoria_demografica cd
  ON cd.nombre = dp.categoria_demografica AND cd.idempresa = dp.idempresa
WHERE dp.idprenda IS NULL
ORDER BY dp.folio;

-- El cambio. El trigger hace el recálculo solo: `idprenda` es insumo
-- de la fórmula, así que no hace falta forzar nada.
UPDATE manumoda.diseno_programacion dp
SET idprenda = cp.id
FROM manumoda.cat_prendas cp
WHERE dp.idprenda IS NULL
  AND cp.nombre = dp.familia
  AND cp.idempresa = dp.idempresa;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Solo deben quedar sin prenda los registros cuya familia no existe en
--    el catálogo (hoy: MAXIVESTIDO y PANTS, si es que llegan a estar).
SELECT dp.folio, dp.familia
FROM manumoda.diseno_programacion dp
WHERE dp.idprenda IS NULL AND dp.idempresa = 1;

-- 2. El plan de diseño después del cambio: ≈ 644.68 h.
SELECT ROUND(SUM(horas_plan_diseno), 2) AS plan_diseno
FROM manumoda.diseno_programacion
WHERE idempresa = 1;

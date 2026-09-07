-- ============================================================
-- El historial de pagos volvía a leer una tabla que ya no existe
--
-- QUÉ ESTABA MAL:
--   `vw_historial_pagos` (script 031) une los pagos de maquila con
--   los de lavandería, pero la segunda rama lee `lavanderia_pagos`
--   —la tabla que el script 032 eliminó y reemplazó por
--   `servicio_pagos`, que además cubre los cinco servicios—.
--
--   La vista sobrevivió porque el 032 la recreó apuntando solo a
--   maquila, así que no falla: simplemente NUNCA muestra un pago de
--   lavandería. Verificado: hay un pago de $6,000 al folio 1804 que
--   el historial no reporta.
--
-- QUÉ CORRIGE:
--   La rama de servicios pasa a leer `servicio_pagos`. El `tipo` deja
--   de ser la constante 'Lavandería' y toma el servicio real, así que
--   el historial cubre también estampado, bordado y corte externo.
--
--   `servicio_pagos` no tiene columna `modelo` ni `cliente`: se toman
--   de la orden, igual que la rama de maquila.
--
-- PREREQUISITO: scripts 031 y 032 ejecutados.
-- ============================================================

CREATE OR REPLACE VIEW manumoda.vw_historial_pagos AS
SELECT
    ('M-' || g.id::text)              AS clave,
    'Maquila'::text                   AS tipo,
    g.idempresa,
    g.folio,
    g.fecha,
    g.monto,
    g.es_adelanto,
    g.referencia,
    g.comentarios,
    g.capturado_por,
    g.created_at,
    o.modelo,
    o.cliente,
    COALESCE(mq.nombre, o.maquilero)  AS beneficiario
FROM manumoda.maquila_pagos g
JOIN manumoda.ordenes_produccion o
  ON o.folio = g.folio AND o.idempresa = g.idempresa
LEFT JOIN manumoda.maquileros mq
  ON mq.id = o.idmaquilero

UNION ALL

-- Los servicios externos. El beneficiario ES el servicio: a la lavandería
-- se le paga como lavandería, no hay catálogo de proveedores todavía.
SELECT
    ('S-' || sp.id::text)             AS clave,
    sp.servicio::text                 AS tipo,
    sp.idempresa,
    sp.folio,
    sp.fecha,
    sp.monto,
    sp.es_adelanto,
    sp.referencia,
    sp.comentarios,
    sp.capturado_por,
    sp.created_at,
    o.modelo,
    o.cliente,
    sp.servicio::text                 AS beneficiario
FROM manumoda.servicio_pagos sp
JOIN manumoda.ordenes_produccion o
  ON o.folio = sp.folio AND o.idempresa = sp.idempresa;

COMMENT ON VIEW manumoda.vw_historial_pagos IS
  'Todos los pagos —maquila y servicios externos— en una sola línea de '
  'tiempo. `tipo` distingue el origen: Maquila, Lavandería, Estampado, '
  'Bordado, Corte Externo u Otro.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Los pagos de servicio ya deben aparecer. Esperado: al menos el de
--    $6,000 del folio 1804.
SELECT clave, tipo, folio, fecha, monto, beneficiario
FROM manumoda.vw_historial_pagos
WHERE idempresa = 1 AND clave LIKE 'S-%'
ORDER BY fecha DESC;

-- 2. Nada se pierde ni se duplica: la vista debe traer exactamente lo que
--    suman las dos tablas. 0 filas.
SELECT
  (SELECT COUNT(*) FROM manumoda.vw_historial_pagos WHERE idempresa = 1) AS en_vista,
  (SELECT COUNT(*) FROM manumoda.maquila_pagos g
     JOIN manumoda.ordenes_produccion o
       ON o.folio = g.folio AND o.idempresa = g.idempresa
   WHERE g.idempresa = 1)                                                AS pagos_maquila,
  (SELECT COUNT(*) FROM manumoda.servicio_pagos sp
     JOIN manumoda.ordenes_produccion o
       ON o.folio = sp.folio AND o.idempresa = sp.idempresa
   WHERE sp.idempresa = 1)                                               AS pagos_servicio
WHERE (SELECT COUNT(*) FROM manumoda.vw_historial_pagos WHERE idempresa = 1)
   <> (SELECT COUNT(*) FROM manumoda.maquila_pagos g
         JOIN manumoda.ordenes_produccion o
           ON o.folio = g.folio AND o.idempresa = g.idempresa
       WHERE g.idempresa = 1)
    + (SELECT COUNT(*) FROM manumoda.servicio_pagos sp
         JOIN manumoda.ordenes_produccion o
           ON o.folio = sp.folio AND o.idempresa = sp.idempresa
       WHERE sp.idempresa = 1);

-- 3. Las claves deben ser únicas: los ids de las dos tablas vienen de
--    secuencias distintas y por eso llevan prefijo. 0 filas.
SELECT clave, COUNT(*)
FROM manumoda.vw_historial_pagos
WHERE idempresa = 1
GROUP BY clave
HAVING COUNT(*) > 1;

-- 4. Reparto por tipo.
SELECT tipo, COUNT(*) AS pagos, ROUND(SUM(monto), 2) AS total
FROM manumoda.vw_historial_pagos
WHERE idempresa = 1
GROUP BY tipo
ORDER BY tipo;

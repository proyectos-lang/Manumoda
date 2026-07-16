-- ============================================================
-- Recalcular horas para todos los registros de diseno_programacion.
--
-- PREREQUISITO: Ejecutar script 006 primero.
--   Este script hace UPDATE en cada fila, lo que dispara el trigger
--   nuevo (006). El trigger recomputa horas_plan_diseno Y también
--   setea horas_diseno_cumplidas automáticamente.
--
-- Solo procesa registros con idprenda; los demás no tienen prenda
-- vinculada y el trigger los maneja por su cuenta al dispararse.
-- ============================================================

WITH computed AS (
  SELECT
    dp.id,
    ROUND(
      (
        cp.horas_base
        * COALESCE(ct.multiplicador, 1)
        * COALESCE(cd.multiplicador, 1)
        + COALESCE((
            SELECT SUM(
              CASE
                WHEN ca.clave = 'muchas_operaciones'    AND dp.muchas_operaciones    IS TRUE THEN ca.horas
                WHEN ca.clave = 'telas_pesadas'         AND dp.telas_pesadas         IS TRUE THEN ca.horas
                WHEN ca.clave = 'muchas_habilitaciones' AND dp.muchas_habilitaciones IS TRUE THEN ca.horas
                WHEN ca.clave = 'prenda_compleja'       AND dp.prenda_compleja       IS TRUE THEN ca.horas
                ELSE 0
              END
            )
            FROM manumoda.cat_adiciones_diseno ca
            WHERE ca.idempresa = dp.idempresa
          ), 0)
      ) * 100
    ) / 100 AS horas_calculadas
  FROM manumoda.diseno_programacion dp
  JOIN  manumoda.cat_prendas cp
    ON  cp.id = dp.idprenda AND cp.idempresa = dp.idempresa
  LEFT JOIN manumoda.cat_tipo_diseno ct
    ON  ct.nombre = dp.tipo AND ct.idempresa = dp.idempresa
  LEFT JOIN manumoda.cat_categoria_demografica cd
    ON  cd.nombre = dp.categoria_demografica AND cd.idempresa = dp.idempresa
)
UPDATE manumoda.diseno_programacion dp
SET
  horas_plan_diseno = c.horas_calculadas
FROM computed c
WHERE dp.id = c.id;

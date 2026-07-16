-- ============================================================
-- Recalcular horas_plan_diseno y horas_diseno_cumplidas
-- para todos los registros existentes en diseno_programacion.
--
-- Fórmula:
--   horas_plan = cat_prendas.horas_base
--              × cat_tipo_diseno.multiplicador
--              × cat_categoria_demografica.multiplicador
--              + Σ adiciones activas
--
-- horas_diseno_cumplidas = horas_plan si cumplimiento_diseno = true,
--                          NULL en caso contrario.
--
-- Solo actualiza registros donde idprenda tiene match en cat_prendas.
-- Los registros sin prenda vinculada conservan su valor actual.
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
    ) / 100 AS horas_calculadas,
    dp.cumplimiento_diseno
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
  horas_plan_diseno      = c.horas_calculadas,
  horas_diseno_cumplidas = CASE
                             WHEN c.cumplimiento_diseno = true THEN c.horas_calculadas
                             ELSE NULL
                           END
FROM computed c
WHERE dp.id = c.id;

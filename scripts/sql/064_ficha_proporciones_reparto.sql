-- ============================================================
-- Reparto por proporción de talla y de color
--
-- EL MODELO:
--   Una ficha define TRES cosas y de ahí sale todo lo demás:
--
--     1. La cantidad total del pedido       (ej. 600 piezas)
--     2. La proporción por TALLA            (ej. CH 1, M 2, G 2, XG 1)
--     3. La proporción por COLOR            (ej. BLANCO 1)
--
--   Y cada celda se deriva:
--
--     piezas(color, talla) = total
--                          × prop_color / suma(prop_color)
--                          × prop_talla / suma(prop_talla)
--
--   Verificado contra dos fichas reales:
--     · modelo 696:  600 × 1 × (1,2,2,1)/6 = 100,200,200,100 = 600 ✔ exacto
--     · modelo 2058: 270 repartido 168:102 da los totales por color
--       exactos; el reparto interno real (46,48,38,36) es desparejo y se
--       ajusta a mano.
--
-- POR QUÉ EL CÁLCULO NO PISA LO CAPTURADO:
--   Decisión de operación: el cálculo llena, pero si alguien ajusta una
--   talla a mano ese número manda. Por eso `cantidades` sigue siendo el
--   dato guardado y las proporciones son insumo para calcularlo, no un
--   sustituto. Un sistema que recalculara siempre no podría representar
--   el folio 2058, que existe y está en producción.
--
-- DÓNDE VIVE CADA PROPORCIÓN:
--   · la de TALLA es del tendido: una sola por bloque, igual para todos
--     los colores. Ya está en `ficha_tallas.proporciones` (script 062).
--   · la de COLOR es de cada renglón. Ya está en `ficha_tallas.proporcion`
--     (script 057), que hasta ahora no se usaba para nada.
--
--   Así que este script NO agrega columnas: documenta el significado que
--   toman y agrega el catálogo de tallas y la cantidad total del pedido.
--
-- PREREQUISITO: scripts 057 y 062 ejecutados.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. El catálogo de tallas estándar
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.cat_tallas (
  id         serial PRIMARY KEY,
  idempresa  integer NOT NULL,
  clave      text    NOT NULL,
  /** El orden en que se muestran: XXS antes que XS, no alfabético. */
  orden      integer NOT NULL,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cat_tallas_empresa_clave
  ON manumoda.cat_tallas (idempresa, upper(trim(clave)));

COMMENT ON TABLE manumoda.cat_tallas IS
  'Las tallas disponibles al capturar una ficha. El orden es el del cuerpo '
  '(XXS→XXL), no el alfabético, porque así se lee el cuadro de tallas.';

INSERT INTO manumoda.cat_tallas (idempresa, clave, orden) VALUES
  (1, 'XXS',  10),
  (1, 'XS',   20),
  (1, 'S',    30),
  (1, 'M',    40),
  (1, 'L',    50),
  (1, 'XL',   60),
  (1, 'XXL',  70)
ON CONFLICT DO NOTHING;

-- Las escalas que ya están en uso en fichas reales. Se agregan para que
-- los folios existentes (0X…3X) sigan teniendo su talla en el catálogo.
INSERT INTO manumoda.cat_tallas (idempresa, clave, orden) VALUES
  (1, '0X',  110),
  (1, '1X',  120),
  (1, '2X',  130),
  (1, '3X',  140),
  (1, 'CH',  210),
  (1, 'G',   230),
  (1, 'XG',  240)
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. La cantidad total del pedido, de la que sale el reparto
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  /**
   * Piezas totales que se van a repartir entre colores y tallas.
   *
   * Separada de `piezas`, que viene del Excel: son dos fuentes y pueden
   * no coincidir. Verlas juntas delata la diferencia en vez de
   * esconderla pisando una con la otra.
   */
  ADD COLUMN IF NOT EXISTS piezas_ficha integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piezas_ficha') THEN
    ALTER TABLE manumoda.ordenes_produccion
      ADD CONSTRAINT chk_piezas_ficha CHECK (piezas_ficha IS NULL OR piezas_ficha >= 0);
  END IF;
END $$;

COMMENT ON COLUMN manumoda.ordenes_produccion.piezas_ficha IS
  'Piezas totales capturadas en la ficha, base del reparto por color y '
  'talla. Distinta de `piezas`, que viene del Excel.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. El significado que toman las dos proporciones
-- ════════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN manumoda.ficha_tallas.proporcion IS
  'PORCENTAJE de este color sobre el total del pedido: 60 = 60%. Los '
  'colores de un bloque deben sumar 100.';

COMMENT ON COLUMN manumoda.ficha_tallas.proporciones IS
  'PORCENTAJE por talla, del tendido: {"S":25,"M":50,"L":25}. Es el mismo '
  'para todos los colores del bloque, por eso se lee del primer renglón. '
  'Debe sumar 100.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. vw_ficha_reparto — lo calculado junto a lo capturado
--
--    No sustituye a `cantidades`: lo pone al lado para poder comparar.
--    Quien captura ve si su ajuste manual se alejó del plan.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_ficha_reparto;

CREATE VIEW manumoda.vw_ficha_reparto AS
WITH base AS (
    SELECT
        ft.id,
        ft.idempresa,
        ft.folio,
        ft.bloque,
        ft.color,
        ft.orden,
        ft.cantidades,
        COALESCE(ft.proporcion, 1)              AS prop_color,
        COALESCE(o.piezas_ficha, o.piezas, 0)   AS total_pedido,
        -- La proporción de talla es del bloque: se toma del primer renglón.
        COALESCE((
          SELECT p.proporciones
          FROM manumoda.ficha_tallas p
          WHERE p.folio = ft.folio AND p.idempresa = ft.idempresa
            AND p.bloque = ft.bloque
          ORDER BY p.orden, p.id
          LIMIT 1
        ), '{}'::jsonb)                         AS prop_tallas,
        -- Suma de las proporciones de color del bloque, para el reparto.
        (
          SELECT SUM(COALESCE(q.proporcion, 1))
          FROM manumoda.ficha_tallas q
          WHERE q.folio = ft.folio AND q.idempresa = ft.idempresa
            AND q.bloque = ft.bloque
        )                                       AS suma_prop_color
    FROM manumoda.ficha_tallas ft
    LEFT JOIN manumoda.ordenes_produccion o
      ON o.folio = ft.folio AND o.idempresa = ft.idempresa
)
SELECT
    b.id,
    b.idempresa,
    b.folio,
    b.bloque,
    b.color,
    b.orden,
    b.cantidades,
    b.prop_color,
    b.prop_tallas,
    b.total_pedido,
    -- Lo que le toca a este color
    CASE WHEN COALESCE(b.suma_prop_color, 0) > 0
         THEN ROUND(b.total_pedido * b.prop_color / b.suma_prop_color)
    END                                         AS piezas_color_calculadas,
    -- Lo capturado, para comparar
    (SELECT COALESCE(SUM((value)::numeric), 0)
     FROM jsonb_each_text(b.cantidades))        AS piezas_color_capturadas,
    -- El reparto por talla: total × prop_color × prop_talla
    (
      SELECT jsonb_object_agg(
               t.key,
               CASE WHEN st.suma > 0 AND COALESCE(b.suma_prop_color, 0) > 0
                    THEN ROUND(
                      b.total_pedido
                      * b.prop_color / b.suma_prop_color
                      * (t.value)::numeric / st.suma
                    )
                    ELSE 0 END
             )
      FROM jsonb_each_text(b.prop_tallas) t
      CROSS JOIN LATERAL (
        SELECT SUM((v.value)::numeric) AS suma
        FROM jsonb_each_text(b.prop_tallas) v
      ) st
    )                                           AS cantidades_calculadas
FROM base b;

COMMENT ON VIEW manumoda.vw_ficha_reparto IS
  'El reparto calculado (total × proporción de color × proporción de talla) '
  'junto al capturado, para poder compararlos. Lo capturado es lo que manda: '
  'el cálculo llena, no pisa.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El catálogo quedó con las 7 estándar más las 7 en uso. Esperado: 14.
SELECT COUNT(*) AS tallas FROM manumoda.cat_tallas WHERE idempresa = 1;

SELECT clave, orden FROM manumoda.cat_tallas
WHERE idempresa = 1 ORDER BY orden;

-- 2. La columna nueva existe.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'ordenes_produccion'
  AND column_name = 'piezas_ficha';

-- 3. La vista responde (vacía mientras no haya tallas capturadas).
SELECT COUNT(*) AS renglones FROM manumoda.vw_ficha_reparto WHERE idempresa = 1;

-- 4. Prueba de la aritmética con los números del modelo 696:
--    600 piezas, un color, proporción de talla 1-2-2-1.
--    Esperado: 100, 200, 200, 100 — suma 600.
SELECT
  ROUND(600 * 1 / 1.0 * 1 / 6.0) AS ch,
  ROUND(600 * 1 / 1.0 * 2 / 6.0) AS m,
  ROUND(600 * 1 / 1.0 * 2 / 6.0) AS g,
  ROUND(600 * 1 / 1.0 * 1 / 6.0) AS xg,
  ROUND(600 * 1 / 1.0 * 1 / 6.0)
    + ROUND(600 * 1 / 1.0 * 2 / 6.0)
    + ROUND(600 * 1 / 1.0 * 2 / 6.0)
    + ROUND(600 * 1 / 1.0 * 1 / 6.0) AS suma;

-- 5. El reparto nunca debe pasarse del total del pedido. 0 filas.
--    (Se compara el calculado, no el capturado: lo capturado puede
--    ajustarse a mano y eso es legítimo.)
SELECT folio, bloque, total_pedido,
       SUM(piezas_color_calculadas) AS repartido
FROM manumoda.vw_ficha_reparto
WHERE idempresa = 1 AND total_pedido > 0
GROUP BY folio, bloque, total_pedido
HAVING SUM(piezas_color_calculadas) > total_pedido + 1;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. vw_ficha_tecnica expone la cantidad total capturada
--
--    La vista es del script 057 y no conocía `piezas_ficha`. Se recrea con
--    su misma definición más esa columna. Sin esto, el formulario no puede
--    releer lo que guardó.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_ficha_tecnica;

CREATE VIEW manumoda.vw_ficha_tecnica AS
SELECT
    o.idempresa,
    o.folio,
    o.razon_social,
    o.marca,
    o.compradora,
    o.cliente,
    o.num_pedido,
    o.modelo,
    o.modelo_cliente,
    o.descripcion_completa,
    o.categoria,
    o.familia,
    o.foto_path,
    o.fecha_confirmacion,
    o.fecha_cancelacion,
    -- Piezas: lo pedido y lo cortado salen de los cuadros de tallas, que es
    -- donde se capturan. `o.piezas` se conserva aparte porque viene del
    -- Excel y puede no coincidir; verlos juntos delata la diferencia.
    o.piezas                          AS piezas_orden,
    -- Nueva: la cantidad capturada en la ficha, base del reparto.
    o.piezas_ficha,
    COALESCE(te.piezas, 0)            AS piezas_totales,
    COALESCE(tc.piezas, 0)            AS piezas_cortadas_ficha,
    o.piezas_cortadas,
    -- Materiales
    COALESCE(mt.importe, 0)           AS costo_tela,
    COALESCE(mh.importe, 0)           AS costo_habilitacion,
    -- Costos unitarios capturados
    o.costo_fijo,
    o.costo_maquila,
    o.costo_lavanderia,
    -- Costo Neto = todo lo que cuesta una pieza. Derivado, no guardado.
    ROUND(
      COALESCE(o.costo_fijo, 0) + COALESCE(o.costo_maquila, 0)
      + COALESCE(o.costo_lavanderia, 0)
      + COALESCE(mt.importe, 0) + COALESCE(mh.importe, 0)
    , 2)                              AS costo_neto,
    o.precio_venta,
    o.precio_publico,
    -- Margen %: cuánto del precio de venta no se fue en costo.
    -- Se protege la división: un precio de venta en 0 o nulo daría error.
    CASE WHEN COALESCE(o.precio_venta, 0) > 0 THEN
      ROUND(100.0 * (o.precio_venta - (
        COALESCE(o.costo_fijo, 0) + COALESCE(o.costo_maquila, 0)
        + COALESCE(o.costo_lavanderia, 0)
        + COALESCE(mt.importe, 0) + COALESCE(mh.importe, 0)
      )) / o.precio_venta, 2)
    END                               AS margen_pct
FROM manumoda.ordenes_produccion o
-- LATERAL y no JOIN: con tres JOIN directos a las tablas hijas, cada una
-- multiplicaría las filas de las otras y los importes saldrían inflados.
LEFT JOIN LATERAL (
    SELECT SUM(v.valor) AS piezas
    FROM manumoda.ficha_tallas ft
    CROSS JOIN LATERAL (
      SELECT SUM((value)::numeric) AS valor
      FROM jsonb_each_text(ft.cantidades)
    ) v
    WHERE ft.folio = o.folio AND ft.idempresa = o.idempresa
      AND ft.bloque = 'Especificacion'
) te ON true
LEFT JOIN LATERAL (
    SELECT SUM(v.valor) AS piezas
    FROM manumoda.ficha_tallas ft
    CROSS JOIN LATERAL (
      SELECT SUM((value)::numeric) AS valor
      FROM jsonb_each_text(ft.cantidades)
    ) v
    WHERE ft.folio = o.folio AND ft.idempresa = o.idempresa
      AND ft.bloque = 'Cortadas'
) tc ON true
LEFT JOIN LATERAL (
    SELECT ROUND(SUM(cantidad * costo), 2) AS importe
    FROM manumoda.ficha_materiales
    WHERE folio = o.folio AND idempresa = o.idempresa AND tipo = 'Tela'
) mt ON true
LEFT JOIN LATERAL (
    SELECT ROUND(SUM(cantidad * costo), 2) AS importe
    FROM manumoda.ficha_materiales
    WHERE folio = o.folio AND idempresa = o.idempresa AND tipo = 'Habilitacion'
) mh ON true;

COMMENT ON VIEW manumoda.vw_ficha_tecnica IS
  'La ficha técnica completa. Costo Neto y Margen se derivan aquí; no se '
  'guardan en ninguna tabla para que no puedan discrepar de sus partes.';

-- 6. La vista expone la cantidad capturada. Esperado: 1 fila.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'manumoda' AND table_name = 'vw_ficha_tecnica'
  AND column_name = 'piezas_ficha';

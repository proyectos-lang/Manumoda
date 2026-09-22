-- ============================================================
-- Crear órdenes desde el sistema, con folio propio
--
-- EL PROBLEMA DEL FOLIO:
--   Hoy los 637 folios vienen del Excel y son todos numéricos, del 1548
--   al 2682. Si el sistema tomara "el siguiente número libre", cada
--   carga del Excel podría traer un folio que el sistema ya asignó, y
--   dos pedidos distintos terminarían con el mismo identificador.
--
--   Por eso los creados aquí llevan PREFIJO: M-0001, M-0002…
--   Ningún folio actual empieza con "M-", así que las dos series no
--   pueden chocar aunque el Excel siga creciendo.
--
--   Decisión de operación (22-sep-2026).
--
-- POR QUÉ UNA SECUENCIA Y NO "MAX + 1":
--   Con `MAX(folio) + 1`, dos personas creando una orden al mismo tiempo
--   leen el mismo máximo y piden el mismo folio: uno de los dos falla, o
--   peor, se duplica. Una secuencia de Postgres entrega números únicos
--   aunque haya diez sesiones a la vez.
--
-- PREREQUISITO: ninguno.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La secuencia de la serie propia
-- ════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS manumoda.seq_folio_sistema START 1;

COMMENT ON SEQUENCE manumoda.seq_folio_sistema IS
  'Consecutivo de los folios creados en el sistema (M-0001, M-0002…). '
  'Separado de la numeración del Excel para que nunca choquen.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. La función que entrega el siguiente folio
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_siguiente_folio(p_idempresa integer)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_folio text;
  v_intentos integer := 0;
BEGIN
  LOOP
    v_folio := 'M-' || LPAD(nextval('manumoda.seq_folio_sistema')::text, 4, '0');

    -- La secuencia ya garantiza unicidad, pero si alguien tecleó a mano
    -- un folio con este formato el número estaría tomado. Se salta y se
    -- pide el siguiente en vez de fallar.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM manumoda.ordenes_produccion
      WHERE idempresa = p_idempresa AND folio = v_folio
    );

    v_intentos := v_intentos + 1;
    IF v_intentos > 100 THEN
      RAISE EXCEPTION 'No se pudo generar un folio libre tras 100 intentos';
    END IF;
  END LOOP;

  RETURN v_folio;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_siguiente_folio(integer) IS
  'El siguiente folio de la serie del sistema. Usa una secuencia, no '
  'MAX+1: dos personas creando a la vez obtendrían el mismo número.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Crear la orden
--
--    Una función y no un INSERT desde la app: así el folio se pide y se
--    usa en la misma transacción. Entre pedirlo y escribirlo desde el
--    navegador cabe que otra sesión tome el mismo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION manumoda.fn_crear_orden(
  p_idempresa      integer,
  p_cliente        text    DEFAULT NULL,
  p_modelo         text    DEFAULT NULL,
  p_familia        text    DEFAULT NULL,
  p_categoria      text    DEFAULT NULL,
  p_piezas         integer DEFAULT NULL,
  p_fecha_pedido   date    DEFAULT NULL,
  p_fecha_cancelacion date DEFAULT NULL,
  p_tipo_pedido    text    DEFAULT NULL,
  p_num_pedido     text    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_folio text;
BEGIN
  v_folio := manumoda.fn_siguiente_folio(p_idempresa);

  INSERT INTO manumoda.ordenes_produccion (
    idempresa, folio, cliente, modelo, familia, categoria,
    piezas, fecha_pedido, fecha_cancelacion, tipo_pedido, num_pedido,
    -- Nace sin programar: es el estado del que parte todo folio nuevo.
    fase_actual
  ) VALUES (
    p_idempresa, v_folio, p_cliente,
    -- Sin modelo, se usa el folio: así nunca queda en blanco en las
    -- listas, que es donde más se busca.
    COALESCE(p_modelo, v_folio),
    p_familia, p_categoria,
    COALESCE(p_piezas, 0),
    COALESCE(p_fecha_pedido, CURRENT_DATE),
    p_fecha_cancelacion, p_tipo_pedido, p_num_pedido,
    'Por Programar'
  );

  RETURN v_folio;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_crear_orden IS
  'Crea una orden con folio de la serie del sistema y devuelve el folio. '
  'El folio se pide y se usa en la misma transacción.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. La secuencia y las dos funciones existen. Esperado: 2 funciones.
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'manumoda'
  AND routine_name IN ('fn_siguiente_folio', 'fn_crear_orden')
ORDER BY routine_name;

-- 2. El formato del folio: M- y cuatro dígitos.
--    OJO: esto CONSUME un número de la secuencia. Es inofensivo —los
--    folios no tienen que ser consecutivos— pero conviene saberlo.
SELECT manumoda.fn_siguiente_folio(1) AS ejemplo_de_folio;

-- 3. Ningún folio existente empieza con "M-": las series no chocan.
--    Esperado: 0.
SELECT COUNT(*) AS folios_con_prefijo_m
FROM manumoda.ordenes_produccion
WHERE idempresa = 1 AND folio LIKE 'M-%';

-- 4. Los 637 del Excel siguen siendo numéricos y en su rango.
SELECT COUNT(*) AS folios,
       MIN(folio::integer) AS minimo,
       MAX(folio::integer) AS maximo
FROM manumoda.ordenes_produccion
WHERE idempresa = 1 AND folio ~ '^\d+$';

-- 5. Prueba de punta a punta: crear, comprobar y borrar.
--    Debe devolver una fila con fase 'Por Programar'.
-- SELECT manumoda.fn_crear_orden(1, 'CLIENTE DE PRUEBA', NULL, NULL, NULL, 100);
-- SELECT folio, cliente, modelo, piezas, fase_actual, fecha_pedido
-- FROM manumoda.ordenes_produccion WHERE folio LIKE 'M-%';
-- DELETE FROM manumoda.ordenes_produccion WHERE folio LIKE 'M-%';

-- ============================================================
-- Los precios se capturan al crear la orden
--
-- POR QUÉ CAMBIAN DE SITIO:
--   Precio de venta y precio público son condición COMERCIAL del
--   pedido, no dato de producción: se acuerdan con el cliente antes de
--   que exista una ficha técnica. Estaban en la ficha y se movieron a
--   la creación de la orden (operación, 24-sep-2026).
--
-- NO SE PIERDE NADA:
--   Las columnas son las mismas —`ordenes_produccion.precio_venta` y
--   `.precio_publico`— y las 368 órdenes que traen precio de venta y
--   las 192 con precio público lo conservan. Solo cambia DÓNDE se
--   teclea.
--
-- EL DE VENTA NO ES INFORMATIVO:
--   Pago Maquilas lo usa para descontar las piezas no entregadas, y la
--   ficha calcula con él el margen y la utilidad. Un precio mal
--   capturado cambia lo que se le paga al maquilero.
--
-- NULL Y NO CERO CUANDO NO SE SABE:
--   Un cero diría "esta prenda se vende gratis" y Pago Maquilas
--   descontaría $0 por pieza no entregada. NULL dice "todavía no se
--   acordó", que es lo que pasa en la mayoría de los pedidos nuevos.
--
-- PREREQUISITO: script 073 ejecutado (esta reemplaza su versión de
--               fn_crear_orden).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Crear la orden, ahora con precios
--
--   OJO — SE BORRA LA VERSIÓN ANTERIOR PRIMERO:
--   `CREATE OR REPLACE` con una lista de parámetros distinta no
--   reemplaza: crea una SOBRECARGA. Quedarían dos `fn_crear_orden` y
--   la llamada con los argumentos comunes sería ambigua (42725,
--   "function is not unique"). Por eso el DROP explícito de la firma
--   de 11 parámetros del script 073.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS manumoda.fn_crear_orden(
  integer, text, text, text, text, integer, date, date, text, text, integer
);

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
  p_num_pedido     text    DEFAULT NULL,
  p_idcliente      integer DEFAULT NULL,
  p_precio_venta   numeric DEFAULT NULL,
  p_precio_publico numeric DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_folio   text;
  v_cliente text;
BEGIN
  v_folio := manumoda.fn_siguiente_folio(p_idempresa);

  -- Con id, el nombre se toma del catálogo: así el texto no puede
  -- contradecir al cliente al que apunta la orden.
  IF p_idcliente IS NOT NULL THEN
    SELECT c.nombre INTO v_cliente
    FROM manumoda.clientes c
    WHERE c.id = p_idcliente AND c.idempresa = p_idempresa;

    IF v_cliente IS NULL THEN
      RAISE EXCEPTION 'El cliente % no existe en la empresa %',
        p_idcliente, p_idempresa;
    END IF;
  ELSE
    v_cliente := p_cliente;
  END IF;

  INSERT INTO manumoda.ordenes_produccion (
    idempresa, folio, cliente, idcliente, modelo, familia, categoria,
    piezas, fecha_pedido, fecha_cancelacion, tipo_pedido, num_pedido,
    precio_venta, precio_publico,
    -- Nace sin programar: es el estado del que parte todo folio nuevo.
    fase_actual
  ) VALUES (
    p_idempresa, v_folio, v_cliente, p_idcliente,
    -- Sin modelo, se usa el folio: así nunca queda en blanco en las
    -- listas, que es donde más se busca.
    COALESCE(p_modelo, v_folio),
    p_familia, p_categoria,
    COALESCE(p_piezas, 0),
    COALESCE(p_fecha_pedido, CURRENT_DATE),
    p_fecha_cancelacion, p_tipo_pedido, p_num_pedido,
    -- Sin COALESCE a propósito: NULL significa "no se acordó todavía",
    -- y un cero diría que la prenda se vende gratis.
    p_precio_venta, p_precio_publico,
    'Por Programar'
  );

  RETURN v_folio;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_crear_orden IS
  'Crea una orden con folio de la serie del sistema y devuelve el folio. '
  'Con p_idcliente, el nombre se toma del catálogo para que las dos '
  'columnas no se contradigan. Los precios son opcionales: NULL = no '
  'acordado, distinto de cero.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Hay UNA sola fn_crear_orden. Esperado: 1 fila, 13 parámetros.
SELECT p.oid::regprocedure AS firma,
       pronargs AS parametros
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'manumoda' AND p.proname = 'fn_crear_orden';

-- 2. Los precios se guardan. Crear, comprobar y borrar.
--    Esperado: precio_venta 120.50, precio_publico 299.00.
-- SELECT manumoda.fn_crear_orden(
--   1, NULL, 'PRUEBA PRECIOS', NULL, NULL, 10,
--   CURRENT_DATE, NULL, NULL, NULL,
--   (SELECT id FROM manumoda.clientes WHERE idempresa = 1 ORDER BY id LIMIT 1),
--   120.50, 299.00
-- );
-- SELECT folio, cliente, precio_venta, precio_publico, fase_actual
-- FROM manumoda.ordenes_produccion WHERE modelo = 'PRUEBA PRECIOS';
-- DELETE FROM manumoda.ordenes_produccion WHERE modelo = 'PRUEBA PRECIOS';

-- 3. Sin precios, quedan en NULL y no en cero. Esperado: dos NULL.
-- SELECT manumoda.fn_crear_orden(1, NULL, 'PRUEBA SIN PRECIO', NULL, NULL, 5);
-- SELECT folio, precio_venta, precio_publico
-- FROM manumoda.ordenes_produccion WHERE modelo = 'PRUEBA SIN PRECIO';
-- DELETE FROM manumoda.ordenes_produccion WHERE modelo = 'PRUEBA SIN PRECIO';

-- 4. Lo que ya existe no se tocó. Esperado: 368 con venta, 192 con público.
SELECT COUNT(*) FILTER (WHERE precio_venta IS NOT NULL)   AS con_precio_venta,
       COUNT(*) FILTER (WHERE precio_publico IS NOT NULL) AS con_precio_publico,
       COUNT(*)                                            AS ordenes
FROM manumoda.ordenes_produccion
WHERE idempresa = 1;

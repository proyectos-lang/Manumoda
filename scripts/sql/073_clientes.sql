-- ============================================================
-- Catálogo de clientes
--
-- HOY EL CLIENTE ES TEXTO LIBRE:
--   `ordenes_produccion.cliente` guarda el nombre escrito a mano. Son
--   solo 8 nombres distintos en 637 órdenes, así que el desorden es
--   pequeño —pero ya existe: SERVICIOS SHASA y SERVICIOS SHASA SR DE CV
--   son la misma empresa partida en dos por una diferencia de captura.
--
-- QUÉ CAMBIA Y QUÉ NO:
--   Se crea la tabla `clientes` y las órdenes ganan `idcliente`. La
--   columna `cliente` SE QUEDA, con el nombre copiado: así ninguna
--   consulta, vista o reporte existente deja de funcionar, y un cliente
--   renombrado no reescribe la historia de folios viejos.
--
--   El módulo escribe las dos: el id manda, el texto acompaña.
--
-- POR QUÉ NO SE BORRA UN CLIENTE CON ÓRDENES:
--   Borrarlo dejaría 185 folios apuntando a nada. Por eso hay `activo`:
--   un cliente que ya no opera se INACTIVA —deja de ofrecerse al crear
--   pedidos— pero sus folios siguen completos. El borrado real queda
--   para los creados por error, sin una sola orden.
--
-- DOCUMENTO, CORREO Y TELÉFONO SON OPCIONALES:
--   Los 8 clientes actuales no traen ninguno; exigirlos impediría
--   migrarlos. El documento es único cuando existe, para atajar el
--   alta duplicada del mismo cliente.
--
-- PREREQUISITO: ninguno.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. La tabla
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.clientes (
  id          serial PRIMARY KEY,
  idempresa   integer NOT NULL DEFAULT 1,
  nombre      text    NOT NULL,
  -- RFC o el identificador fiscal que corresponda. Opcional: los 8
  -- clientes que ya existen no lo traen.
  documento   text,
  correo      text,
  telefono    text,
  -- Un cliente que ya no opera se inactiva, no se borra: sus folios
  -- tienen que seguir teniendo a quién apuntar.
  activo      boolean NOT NULL DEFAULT true,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clientes_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

COMMENT ON TABLE manumoda.clientes IS
  'Los clientes que hacen pedidos. Antes eran texto libre en '
  'ordenes_produccion.cliente, que se conserva como respaldo.';

COMMENT ON COLUMN manumoda.clientes.activo IS
  'Falso = no se ofrece al crear pedidos. No se borra el cliente porque '
  'sus órdenes quedarían sin referencia.';

-- Dos clientes no pueden llamarse igual. Sobre el nombre normalizado,
-- porque "Mystika" y "MYSTIKA " son el mismo y así se detecta al alta.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_nombre_unico
  ON manumoda.clientes (idempresa, upper(btrim(nombre)));

-- El documento también es único, pero solo cuando existe: los NULL no
-- chocan entre sí, que es justo lo que hace falta con 8 sin documento.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_documento_unico
  ON manumoda.clientes (idempresa, upper(btrim(documento)))
  WHERE documento IS NOT NULL AND btrim(documento) <> '';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Las órdenes apuntan al cliente
--
--    ON DELETE RESTRICT y no CASCADE: borrar un cliente JAMÁS debe
--    llevarse sus órdenes por delante. La app inactiva en vez de
--    borrar, pero la base tiene que impedirlo aunque alguien lo
--    intente por SQL.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE manumoda.ordenes_produccion
  ADD COLUMN IF NOT EXISTS idcliente integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ordenes_produccion_idcliente_fkey'
  ) THEN
    ALTER TABLE manumoda.ordenes_produccion
      ADD CONSTRAINT ordenes_produccion_idcliente_fkey
      FOREIGN KEY (idcliente) REFERENCES manumoda.clientes(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ordenes_produccion_idcliente_idx
  ON manumoda.ordenes_produccion (idempresa, idcliente);

COMMENT ON COLUMN manumoda.ordenes_produccion.idcliente IS
  'El cliente del catálogo. La columna `cliente` conserva el nombre '
  'copiado: renombrar un cliente no debe reescribir folios viejos.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Migrar los 8 nombres que ya existen
--
--    SERVICIOS SHASA y SERVICIOS SHASA SR DE CV son la misma empresa:
--    se unifican bajo "SERVICIOS SHASA", el nombre con más folios (41
--    contra 15). Decisión de operación (24-sep-2026).
-- ════════════════════════════════════════════════════════════════════════════

-- Los nombres distintos que hay hoy, ya unificados.
INSERT INTO manumoda.clientes (idempresa, nombre)
SELECT DISTINCT
  o.idempresa,
  CASE
    WHEN upper(btrim(o.cliente)) LIKE 'SERVICIOS SHASA%' THEN 'SERVICIOS SHASA'
    ELSE btrim(o.cliente)
  END
FROM manumoda.ordenes_produccion o
WHERE o.cliente IS NOT NULL
  AND btrim(o.cliente) <> ''
ON CONFLICT DO NOTHING;

-- Y se enlazan las órdenes. El mismo CASE, para que las 15 de
-- "SR DE CV" caigan en el cliente unificado.
UPDATE manumoda.ordenes_produccion o
SET idcliente = c.id
FROM manumoda.clientes c
WHERE o.idcliente IS NULL
  AND c.idempresa = o.idempresa
  AND upper(btrim(c.nombre)) = upper(
        CASE
          WHEN upper(btrim(o.cliente)) LIKE 'SERVICIOS SHASA%' THEN 'SERVICIOS SHASA'
          ELSE btrim(o.cliente)
        END
      );

-- El texto se normaliza al nombre oficial, para que las dos columnas
-- no se contradigan. Solo las 15 de SHASA cambian.
UPDATE manumoda.ordenes_produccion o
SET cliente = c.nombre
FROM manumoda.clientes c
WHERE o.idcliente = c.id
  AND o.cliente IS DISTINCT FROM c.nombre;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Las 12 familias que se usan pero no están en el catálogo
--
--    `cat_familias_corte` tiene 17 familias y Corte calcula horas con
--    su `grupo` y `horas_base`. Pero 82 folios usan familias que no
--    están ahí, así que el combobox no podría ofrecerlas.
--
--    El grupo de cada una se asigna por PARECIDO con las que ya
--    existen —un JOGGER se corta como un PANTALON, grupo C— y las
--    horas_base se copian del grupo. Es una estimación de arranque:
--    revísalas en Corte › Variables si alguna no corresponde.
-- ════════════════════════════════════════════════════════════════════════════

--    OJO: `cat_familias_corte` NO tiene índice único sobre el nombre
--    —se comprobó contra la base—, así que `ON CONFLICT DO NOTHING`
--    fallaría con 42P10. De ahí el NOT EXISTS: hace el script
--    repetible sin depender de una restricción que no existe.

INSERT INTO manumoda.cat_familias_corte (idempresa, nombre, grupo, horas_base)
SELECT v.idempresa, v.nombre, v.grupo, v.horas_base
FROM (VALUES
  -- Grupo A (2.00 h): prendas simples, como PLAYERA y TOP
  (1, 'LEGGIN',      'A', 2.00),
  -- Grupo B (2.15 h): como FALDA, SHORT y BLUSA
  (1, 'MINIFALDA',   'B', 2.15),
  (1, 'BERMUDA',     'B', 2.15),
  (1, 'CAPRI',       'B', 2.15),
  (1, 'PANTS',       'B', 2.15),
  -- Grupo C (2.30 h): como PANTALON, JEANS y VESTIDO
  (1, 'JOGGER',      'C', 2.30),
  (1, 'PALAZZO',     'C', 2.30),
  (1, 'MAXIVESTIDO', 'C', 2.30),
  (1, 'SUDADERA',    'C', 2.30),
  -- Grupo D (2.45 h): las de más trabajo, como CHAMARRA y JUMPSUIT
  (1, 'SACO',        'D', 2.45),
  (1, 'CONJUNTO',    'D', 2.45),
  (1, 'JUMPER',      'D', 2.45)
) AS v(idempresa, nombre, grupo, horas_base)
WHERE NOT EXISTS (
  SELECT 1 FROM manumoda.cat_familias_corte f
  WHERE f.idempresa = v.idempresa
    AND upper(btrim(f.nombre)) = v.nombre
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. La vista del módulo: cada cliente con lo que se le ha pedido
--
--    LATERAL y no JOIN + GROUP BY: así la cuenta de órdenes no depende
--    de agrupar toda la tabla, y agregar columnas después no obliga a
--    tocar el GROUP BY.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW manumoda.vw_clientes AS
SELECT
  c.id,
  c.idempresa,
  c.nombre,
  c.documento,
  c.correo,
  c.telefono,
  c.activo,
  c.notas,
  c.created_at,
  COALESCE(o.ordenes, 0)   AS ordenes,
  COALESCE(o.piezas, 0)    AS piezas,
  o.ultimo_pedido,
  -- Si tiene órdenes no se puede borrar, solo inactivar. Se calcula
  -- aquí para que la pantalla no tenga que adivinarlo.
  (COALESCE(o.ordenes, 0) = 0) AS se_puede_borrar
FROM manumoda.clientes c
LEFT JOIN LATERAL (
  SELECT COUNT(*)              AS ordenes,
         SUM(COALESCE(op.piezas, 0)) AS piezas,
         MAX(op.fecha_pedido)  AS ultimo_pedido
  FROM manumoda.ordenes_produccion op
  WHERE op.idcliente = c.id AND op.idempresa = c.idempresa
) o ON true;

COMMENT ON VIEW manumoda.vw_clientes IS
  'Los clientes con cuántas órdenes y piezas se les han producido. '
  'se_puede_borrar es falso en cuanto tienen una orden: entonces se '
  'inactivan, no se borran.';

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Crear la orden ya con el cliente del catálogo
--
--    `fn_crear_orden` (script 071) recibía el cliente como texto. Ahora
--    recibe además el id, y guarda LAS DOS COSAS: el id manda y el
--    texto conserva el nombre de ese momento.
--
--    El parámetro va AL FINAL y con DEFAULT NULL para no romper a quien
--    llame la función con los argumentos de antes.
--
--    OJO — SE BORRA LA VERSIÓN ANTERIOR PRIMERO:
--    `CREATE OR REPLACE` con una lista de parámetros distinta no
--    reemplaza: crea una SOBRECARGA. Quedarían dos `fn_crear_orden`, y
--    al llamarla con los argumentos comunes Postgres no sabría cuál
--    quiere (error 42725, "function is not unique"). Por eso el DROP
--    explícito de la firma de 10 parámetros del script 071.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS manumoda.fn_crear_orden(
  integer, text, text, text, text, integer, date, date, text, text
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
  p_idcliente      integer DEFAULT NULL
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
    'Por Programar'
  );

  RETURN v_folio;
END;
$$;

COMMENT ON FUNCTION manumoda.fn_crear_orden IS
  'Crea una orden con folio de la serie del sistema y devuelve el folio. '
  'Con p_idcliente, el nombre se toma del catálogo para que las dos '
  'columnas no se contradigan.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Los clientes migrados. Esperado: 7 —los 8 nombres menos el
--    duplicado de SHASA, que se unificó.
SELECT id, nombre, activo FROM manumoda.clientes
WHERE idempresa = 1 ORDER BY nombre;

-- 2. NINGUNA orden quedó sin cliente. Esperado: 0.
SELECT COUNT(*) AS ordenes_sin_cliente
FROM manumoda.ordenes_produccion
WHERE idempresa = 1
  AND idcliente IS NULL
  AND cliente IS NOT NULL AND btrim(cliente) <> '';

-- 3. El reparto de folios. SERVICIOS SHASA debe tener 56 = 41 + 15.
SELECT nombre, ordenes, piezas, ultimo_pedido, se_puede_borrar
FROM manumoda.vw_clientes
WHERE idempresa = 1 ORDER BY ordenes DESC;

-- 4. El texto y el catálogo no se contradicen. Esperado: 0.
SELECT COUNT(*) AS desalineadas
FROM manumoda.ordenes_produccion o
JOIN manumoda.clientes c ON c.id = o.idcliente
WHERE o.cliente IS DISTINCT FROM c.nombre;

-- 5. El catálogo de familias cubre ahora todo lo usado. Esperado: 0.
SELECT DISTINCT o.familia
FROM manumoda.ordenes_produccion o
WHERE o.idempresa = 1
  AND btrim(COALESCE(o.familia, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM manumoda.cat_familias_corte f
    WHERE f.idempresa = o.idempresa
      AND upper(btrim(f.nombre)) = upper(btrim(o.familia))
  );

-- 6. La llave impide borrar un cliente con órdenes.
--    Debe fallar con 23503 (foreign_key_violation).
-- DELETE FROM manumoda.clientes WHERE nombre = 'MYSTIKA';

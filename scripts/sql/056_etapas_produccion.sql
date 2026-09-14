-- ============================================================
-- Las nueve etapas del proceso de producción
--
-- QUÉ MODELA:
--   El flujo completo que definió operación, no solo las tres que el
--   sistema ya gestiona:
--
--     1  Pre orden                      (nueva)
--     2  Diseño                         YA EXISTE · diseno_programacion
--     3  Ficha de producción            (nueva)
--     4  Habilitaciones complejas       (nueva)
--     5  Graduación                     (nueva)
--     6  Trazo                          (nueva)
--     7  Corte                          YA EXISTE · corte_programacion
--     8  Adquisición habilitación simple(nueva)
--     9  Entrega a maquilero S1         YA EXISTE · fase_actual
--
-- POR QUÉ UNA TABLA GENÉRICA Y NO COLUMNAS:
--   Meter cada etapa como columnas en `ordenes_produccion` llevaría
--   la tabla a 60+ campos y cada etapa nueva sería una migración. Con
--   `orden_etapas` —una fila por folio y etapa— agregar la etapa 10
--   es insertar un renglón en el catálogo.
--
--   El catálogo `cat_etapas_produccion` guarda el orden y el nombre,
--   así que operación puede renombrar o reordenar sin tocar código.
--
-- LAS TRES QUE YA EXISTEN NO SE MIGRAN:
--   Diseño, Corte y Maquila siguen viviendo donde viven y se
--   gestionan en sus módulos. La vista `vw_orden_etapas` las LEE de
--   su fuente real y las presenta junto a las nuevas, para que el
--   tablero muestre las nueve sin duplicar la verdad en dos lugares.
--
--   `gestion_externa` marca esas tres: la interfaz sabe que su botón
--   lleva a otro módulo en vez de abrir el formulario genérico.
--
-- LA FICHA TÉCNICA (etapa 1) QUEDA PREPARADA, NO DEFINIDA:
--   Operación todavía va a entregar el esquema de campos. Por eso
--   los datos propios de cada etapa viven en `datos jsonb`: cuando
--   llegue el esquema se llena sin migrar, y si mañana cambia, los
--   folios ya capturados no se rompen.
--
-- PREREQUISITO: ninguno.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Catálogo de etapas
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manumoda.cat_etapas_produccion (
  id              serial PRIMARY KEY,
  idempresa       integer NOT NULL,
  numero          integer NOT NULL,
  clave           text    NOT NULL,
  nombre          text    NOT NULL,
  descripcion     text,
  /** true = se gestiona en su propio módulo, no en el formulario genérico. */
  gestion_externa boolean NOT NULL DEFAULT false,
  /** A qué módulo lleva su botón cuando la gestión es externa. */
  modulo          text,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_etapa_numero CHECK (numero > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cat_etapas_empresa_numero
  ON manumoda.cat_etapas_produccion (idempresa, numero);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cat_etapas_empresa_clave
  ON manumoda.cat_etapas_produccion (idempresa, clave);

COMMENT ON TABLE manumoda.cat_etapas_produccion IS
  'Las etapas del proceso, en orden. Agregar una etapa es insertar aquí: no '
  'hace falta migrar el esquema.';

INSERT INTO manumoda.cat_etapas_produccion
  (idempresa, numero, clave, nombre, descripcion, gestion_externa, modulo)
VALUES
  (1, 1, 'pre_orden',      'Pre orden',
   'Ficha técnica con la información general del pedido', false, NULL),
  (1, 2, 'diseno',         'Diseño',
   'Confirmación de la compradora', true, 'diseno'),
  (1, 3, 'ficha_produccion','Ficha de producción',
   'Se indica manualmente', false, NULL),
  (1, 4, 'hab_complejas',  'Habilitaciones complejas',
   'Habilitaciones ya compradas, se indican en la ficha técnica', false, NULL),
  (1, 5, 'graduacion',     'Graduación',
   'Se indica el plan de corte de tela en la ficha técnica', false, NULL),
  (1, 6, 'trazo',          'Trazo',
   'Se indica la tela a utilizar', false, NULL),
  (1, 7, 'corte',          'Corte',
   'Resultado del corte', true, 'corte'),
  (1, 8, 'hab_simples',    'Adquisición habilitación simple',
   'Habilitaciones simples; van después de las complejas', false, NULL),
  (1, 9, 'entrega_s1',     'Entrega a maquilero (S1)',
   'Especificaciones del maquilero que produce', true, 'seguimiento')
ON CONFLICT (idempresa, clave) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. El avance de cada folio en cada etapa
-- ════════════════════════════════════════════════════════════════════════════

-- El filtro por esquema es necesario: sin él, un tipo con el mismo nombre en
-- otro esquema haría que el dominio nunca se creara y la tabla fallara
-- después con un error que no señala la causa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'estado_etapa' AND n.nspname = 'manumoda'
  ) THEN
    CREATE DOMAIN manumoda.estado_etapa AS text
      CHECK (VALUE IN ('Pendiente', 'En proceso', 'Completada', 'No aplica'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS manumoda.orden_etapas (
  id              serial PRIMARY KEY,
  idempresa       integer NOT NULL,
  folio           text    NOT NULL,
  idetapa         integer NOT NULL REFERENCES manumoda.cat_etapas_produccion(id),
  estado          manumoda.estado_etapa NOT NULL DEFAULT 'Pendiente',
  fecha_inicio    date,
  fecha_completada date,
  responsable     text,
  notas           text,
  /**
   * Los campos propios de la etapa. jsonb y no columnas porque cada una
   * captura cosas distintas y el esquema de la ficha técnica todavía se
   * está definiendo: así se llena sin migrar y un cambio de formato no
   * rompe lo ya capturado.
   */
  datos           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  capturado_por   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Una sola fila por folio y etapa
CREATE UNIQUE INDEX IF NOT EXISTS ux_orden_etapas_folio_etapa
  ON manumoda.orden_etapas (idempresa, folio, idetapa);

CREATE INDEX IF NOT EXISTS ix_orden_etapas_empresa_folio
  ON manumoda.orden_etapas (idempresa, folio);

CREATE INDEX IF NOT EXISTS ix_orden_etapas_estado
  ON manumoda.orden_etapas (idempresa, estado);

COMMENT ON TABLE manumoda.orden_etapas IS
  'Avance de un folio en una etapa. Solo se guardan las etapas que alguien '
  'tocó: la ausencia de fila significa Pendiente.';

COMMENT ON COLUMN manumoda.orden_etapas.datos IS
  'Campos propios de la etapa, en jsonb. El esquema de cada una se define '
  'en la app, no en la base: agregar un campo no es una migración.';

-- `updated_at` se mantiene solo: si se deja a la app, tarde o temprano
-- alguien guarda sin actualizarlo y el dato deja de significar nada.
CREATE OR REPLACE FUNCTION manumoda.fn_touch_orden_etapas()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_orden_etapas ON manumoda.orden_etapas;
CREATE TRIGGER trg_touch_orden_etapas
  BEFORE UPDATE ON manumoda.orden_etapas
  FOR EACH ROW EXECUTE FUNCTION manumoda.fn_touch_orden_etapas();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vw_orden_etapas — las nueve etapas de cada folio
--
--    Producto cartesiano de órdenes × etapas, con el estado de cada una.
--    Las tres que ya existen se LEEN de su fuente real; las demás, de
--    `orden_etapas`. Así el tablero muestra las nueve sin que la verdad
--    viva en dos lugares.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_orden_etapas;

CREATE VIEW manumoda.vw_orden_etapas AS
SELECT
    o.idempresa,
    o.folio,
    o.modelo,
    o.cliente,
    o.fase_actual,
    e.id                       AS idetapa,
    e.numero,
    e.clave,
    e.nombre                   AS etapa,
    e.gestion_externa,
    e.modulo,
    -- El estado: para las tres existentes sale de su propia fuente.
    --
    -- OJO CON EL ORDEN: "Completada" va ANTES que "No aplica", igual que en
    -- StageActionButton (orders-table.tsx). Si quedó constancia de que la
    -- etapa ocurrió, la etapa se hizo, aunque la orden esté marcada como que
    -- no la requería. No es un caso raro: hoy son 101 folios con
    -- `no_requiere_diseno` y fecha de aprobación al mismo tiempo. Invertir
    -- estas dos ramas haría que Panel General y este tablero dieran
    -- respuestas distintas sobre el mismo folio.
    CASE e.clave
      WHEN 'diseno' THEN
        CASE
          WHEN o.fecha_aprobacion_diseno IS NOT NULL THEN 'Completada'
          WHEN o.no_requiere_diseno            THEN 'No aplica'
          WHEN o.diseno_programado             THEN 'En proceso'
          ELSE 'Pendiente'
        END
      WHEN 'corte' THEN
        CASE
          WHEN cp.cumplido                     THEN 'Completada'
          WHEN o.no_requiere_corte             THEN 'No aplica'
          WHEN o.corte_programado              THEN 'En proceso'
          ELSE 'Pendiente'
        END
      WHEN 'entrega_s1' THEN
        CASE
          WHEN o.fecha_s1 IS NOT NULL          THEN 'Completada'
          WHEN o.maquilero IS NOT NULL         THEN 'En proceso'
          ELSE 'Pendiente'
        END
      -- El cast a text es deliberado: sin él, esta rama devuelve el dominio
      -- y las otras literales sin tipo, y el tipo de la columna queda a
      -- merced de la resolución implícita de Postgres.
      ELSE COALESCE(oe.estado::text, 'Pendiente')
    END                        AS estado,
    -- La fecha en que se completó, de donde corresponda
    CASE e.clave
      WHEN 'diseno'     THEN o.fecha_aprobacion_diseno
      WHEN 'corte'      THEN cp.fecha_corte
      WHEN 'entrega_s1' THEN o.fecha_s1
      ELSE oe.fecha_completada
    END                        AS fecha_completada,
    oe.fecha_inicio,
    oe.responsable,
    oe.notas,
    COALESCE(oe.datos, '{}'::jsonb) AS datos,
    oe.capturado_por,
    oe.updated_at,
    (oe.id IS NOT NULL)        AS tiene_registro
FROM manumoda.ordenes_produccion o
CROSS JOIN manumoda.cat_etapas_produccion e
LEFT JOIN manumoda.orden_etapas oe
  ON oe.folio = o.folio
 AND oe.idempresa = o.idempresa
 AND oe.idetapa = e.id
LEFT JOIN LATERAL (
    SELECT bool_or(cumplimiento_corte = 'Si') AS cumplido,
           MAX(fecha) FILTER (WHERE cumplimiento_corte = 'Si') AS fecha_corte
    FROM manumoda.corte_programacion
    WHERE folio = o.folio AND idempresa = o.idempresa
) cp ON true
WHERE e.idempresa = o.idempresa
  AND e.activo;

COMMENT ON VIEW manumoda.vw_orden_etapas IS
  'Las nueve etapas de cada folio con su estado. Diseño, Corte y Entrega S1 '
  'se leen de su fuente real; el resto, de orden_etapas.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. vw_orden_avance — resumen por folio, para el tablero
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS manumoda.vw_orden_avance;

CREATE VIEW manumoda.vw_orden_avance AS
SELECT
    idempresa,
    folio,
    COUNT(*)                                              AS etapas,
    COUNT(*) FILTER (WHERE estado = 'Completada')         AS completadas,
    COUNT(*) FILTER (WHERE estado = 'En proceso')         AS en_proceso,
    COUNT(*) FILTER (WHERE estado = 'Pendiente')          AS pendientes,
    COUNT(*) FILTER (WHERE estado = 'No aplica')          AS no_aplican,
    -- Las que no aplican no cuentan contra el avance: la orden no pasa por ahí
    CASE WHEN COUNT(*) FILTER (WHERE estado <> 'No aplica') > 0
         THEN ROUND(
           100.0 * COUNT(*) FILTER (WHERE estado = 'Completada')
           / COUNT(*) FILTER (WHERE estado <> 'No aplica'), 1)
         ELSE 0
    END                                                   AS avance_pct,
    -- La primera etapa que falta: es donde está parada la orden
    MIN(numero) FILTER (WHERE estado IN ('Pendiente', 'En proceso')) AS etapa_actual,
    -- El estado de las nueve, en orden, para pintar el indicador de la fila
    -- sin traer 5,535 renglones a Panel General. Con esto la tabla carga
    -- una fila por folio en vez de nueve.
    jsonb_agg(
      jsonb_build_object('numero', numero, 'etapa', etapa, 'estado', estado)
      ORDER BY numero
    ) AS etapas_detalle
FROM manumoda.vw_orden_etapas
GROUP BY idempresa, folio;

COMMENT ON VIEW manumoda.vw_orden_avance IS
  'Cuántas etapas lleva cada folio y en cuál está parado. Las etapas que no '
  'aplican no cuentan contra el porcentaje. `etapas_detalle` trae el estado '
  'de las nueve para pintar el indicador sin cargar la vista de etapas.';

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- 1. El catálogo: 9 etapas, 3 de gestión externa.
SELECT numero, clave, nombre, gestion_externa, modulo
FROM manumoda.cat_etapas_produccion
WHERE idempresa = 1
ORDER BY numero;

-- 2. Cada folio debe tener exactamente 9 filas en la vista de etapas.
--    0 filas.
SELECT folio, COUNT(*) AS etapas
FROM manumoda.vw_orden_etapas
WHERE idempresa = 1
GROUP BY folio
HAVING COUNT(*) <> (SELECT COUNT(*) FROM manumoda.cat_etapas_produccion
                    WHERE idempresa = 1 AND activo);

-- 3. Las tres existentes deben reflejar su fuente real, no 'Pendiente'
--    en todos lados. Esperado: números > 0 en diseño y corte.
SELECT etapa, estado, COUNT(*) AS folios
FROM manumoda.vw_orden_etapas
WHERE idempresa = 1 AND clave IN ('diseno', 'corte', 'entrega_s1')
GROUP BY etapa, estado
ORDER BY etapa, estado;

-- 3b. Los 101 folios marcados "no requiere diseño" que SÍ tienen fecha de
--     aprobación deben salir como 'Completada', nunca 'No aplica': es lo que
--     muestra Panel General. Esperado: 0 filas.
SELECT v.folio, v.estado
FROM manumoda.vw_orden_etapas v
JOIN manumoda.ordenes_produccion o
  ON o.folio = v.folio AND o.idempresa = v.idempresa
WHERE v.idempresa = 1
  AND v.clave = 'diseno'
  AND o.no_requiere_diseno
  AND o.fecha_aprobacion_diseno IS NOT NULL
  AND v.estado <> 'Completada';

-- 4. El avance no puede pasar de 100 ni bajar de 0. 0 filas.
SELECT folio, avance_pct
FROM manumoda.vw_orden_avance
WHERE idempresa = 1 AND (avance_pct < 0 OR avance_pct > 100);

-- 5. Distribución del avance, para ver dónde está parada la producción.
--
--    EN LA PRIMERA EJECUCIÓN todos los folios salen entre 0% y 25%, y
--    `sin_empezar` cerca de 528. No es un error: las seis etapas nuevas
--    todavía no tienen captura, así que solo suman las tres que ya
--    existían. El avance empieza a moverse conforme se capturen.
SELECT
  COUNT(*)                                   AS folios,
  ROUND(AVG(avance_pct), 1)                  AS avance_promedio,
  COUNT(*) FILTER (WHERE avance_pct = 100)   AS terminados,
  COUNT(*) FILTER (WHERE avance_pct = 0)     AS sin_empezar
FROM manumoda.vw_orden_avance
WHERE idempresa = 1;

-- 6. Comparación contra las cifras verificadas antes de crear la vista.
--    Esperado exactamente: diseño 110 completadas / 8 no aplica;
--    corte 6 / 102; entrega_s1 187 completadas / 19 en proceso.
--    Una diferencia aquí significa que la vista no está leyendo la misma
--    fuente que Panel General.
SELECT clave, estado, COUNT(*) AS folios
FROM manumoda.vw_orden_etapas
WHERE idempresa = 1 AND clave IN ('diseno', 'corte', 'entrega_s1')
GROUP BY clave, estado
ORDER BY clave, estado;

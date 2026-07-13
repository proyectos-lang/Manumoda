-- ============================================================
-- Tablas de multiplicadores del módulo de Diseño
--
-- cat_tipo_diseno          → multiplica las horas base según tipo de orden
-- cat_categoria_demografica → multiplica según categoría demográfica
-- cat_adiciones_diseno     → suma horas planas por condición especial
--
-- Fórmula:
--   horas_plan = horas_base × tipo × categoria + Σ adiciones
-- ============================================================

-- ── Tipo de orden ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manumoda.cat_tipo_diseno (
    id            SERIAL PRIMARY KEY,
    idempresa     INTEGER      NOT NULL DEFAULT 1,
    nombre        TEXT         NOT NULL,
    multiplicador NUMERIC(6,2) NOT NULL DEFAULT 1.00
);

-- ── Categoría demográfica ────────────────────────────────────
CREATE TABLE IF NOT EXISTS manumoda.cat_categoria_demografica (
    id            SERIAL PRIMARY KEY,
    idempresa     INTEGER      NOT NULL DEFAULT 1,
    nombre        TEXT         NOT NULL,
    multiplicador NUMERIC(6,2) NOT NULL DEFAULT 1.00
);

-- ── Adiciones al proceso (suman horas) ──────────────────────
CREATE TABLE IF NOT EXISTS manumoda.cat_adiciones_diseno (
    id        SERIAL PRIMARY KEY,
    idempresa INTEGER     NOT NULL DEFAULT 1,
    clave     TEXT        NOT NULL,
    nombre    TEXT        NOT NULL,
    horas     NUMERIC(5,2) NOT NULL DEFAULT 1.00,
    CONSTRAINT uq_cat_adiciones_diseno_clave UNIQUE (idempresa, clave)
);

-- ── Datos iniciales: tipos de orden ─────────────────────────
-- Ajusta nombres y multiplicadores según tu operación
INSERT INTO manumoda.cat_tipo_diseno (idempresa, nombre, multiplicador)
VALUES
    (1, 'NORMAL',      1.00),
    (1, 'EXPORTACION', 1.20),
    (1, 'MUESTRA',     0.80)
ON CONFLICT DO NOTHING;

-- ── Datos iniciales: categorías demográficas ─────────────────
INSERT INTO manumoda.cat_categoria_demografica (idempresa, nombre, multiplicador)
VALUES
    (1, 'Dama',    1.00),
    (1, 'Caball',  1.10),
    (1, 'Niño',    0.90),
    (1, 'Niña',    0.90)
ON CONFLICT DO NOTHING;

-- ── Datos iniciales: 4 adiciones base ───────────────────────
-- Estas 4 claves persisten en el historial de diseno_programacion
-- (columnas muchas_operaciones, telas_pesadas, muchas_habilitaciones, prenda_compleja)
-- Ajusta las horas desde el módulo Diseño → Multiplicadores → Adiciones
INSERT INTO manumoda.cat_adiciones_diseno (idempresa, clave, nombre, horas)
VALUES
    (1, 'muchas_operaciones',    'Muchas operaciones',    1.0),
    (1, 'telas_pesadas',         'Telas pesadas',         1.0),
    (1, 'muchas_habilitaciones', 'Muchas habilitaciones', 1.0),
    (1, 'prenda_compleja',       'Prenda compleja',       1.0)
ON CONFLICT DO NOTHING;

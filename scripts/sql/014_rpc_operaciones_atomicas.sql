-- ============================================================
-- Funciones RPC para operaciones que antes se hacían en varios
-- pasos desde el cliente (con riesgo de fallo parcial).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. fn_anular_programacion
-- ════════════════════════════════════════════════════════════════════════════
-- Antes: el cliente borraba las filas de programación y LUEGO
-- actualizaba el flag de la orden en otra llamada. Si la segunda
-- fallaba, quedaban órdenes con diseno_programado=true sin filas.
-- Ahora: todo en una transacción — o pasa completo o no pasa nada.

CREATE OR REPLACE FUNCTION manumoda.fn_anular_programacion(
  p_folio     text,
  p_idempresa bigint,
  p_tipo      text  -- 'diseno' | 'corte'
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_filas integer;
BEGIN
  IF p_tipo NOT IN ('diseno', 'corte') THEN
    RAISE EXCEPTION 'p_tipo debe ser ''diseno'' o ''corte'', recibido: %', p_tipo;
  END IF;

  IF p_tipo = 'diseno' THEN
    DELETE FROM manumoda.diseno_programacion
    WHERE folio = p_folio AND idempresa = p_idempresa;
    GET DIAGNOSTICS v_filas = ROW_COUNT;

    UPDATE manumoda.ordenes_produccion
    SET diseno_programado = false
    WHERE folio = p_folio AND idempresa = p_idempresa;
  ELSE
    DELETE FROM manumoda.corte_programacion
    WHERE folio = p_folio AND idempresa = p_idempresa;
    GET DIAGNOSTICS v_filas = ROW_COUNT;

    UPDATE manumoda.ordenes_produccion
    SET corte_programado = false
    WHERE folio = p_folio AND idempresa = p_idempresa;
  END IF;

  RETURN v_filas;  -- filas de programación eliminadas
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. fn_recalcular_horas_diseno
-- ════════════════════════════════════════════════════════════════════════════
-- Antes: el cliente hacía un UPDATE por fila (N+1) calculando las
-- horas en JavaScript — valores que el trigger igual sobreescribía.
-- Ahora: un solo UPDATE set-based. El trigger (script 012) hace el
-- recálculo real por fila. Solo toca registros NO evaluados,
-- consistente con la política de horas congeladas.

CREATE OR REPLACE FUNCTION manumoda.fn_recalcular_horas_diseno(
  p_idempresa bigint
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_filas integer;
BEGIN
  -- El SET es un no-op deliberado: basta con disparar el trigger
  -- BEFORE UPDATE, que recomputa horas con los catálogos vigentes.
  UPDATE manumoda.diseno_programacion
  SET id = id
  WHERE idempresa = p_idempresa
    AND cumplimiento_diseno IS NOT TRUE
    AND idprenda IS NOT NULL;

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Verificación
-- ════════════════════════════════════════════════════════════════════════════

-- Recalcular (devuelve cuántas filas no evaluadas se tocaron):
--   SELECT manumoda.fn_recalcular_horas_diseno(1);

-- Anular (probar con un folio de prueba):
--   SELECT manumoda.fn_anular_programacion('FOLIO-PRUEBA', 1, 'diseno');

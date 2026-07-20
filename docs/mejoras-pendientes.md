# Roadmap de mejoras pendientes — Sistema de Producción Manumoda

Resultado de la auditoría de julio 2026. Lo que ya se corrigió en esa sesión
(previsualización de Excel, horas congeladas, unicidad de folio, RPCs
transaccionales, alertas de vencimiento) NO aparece aquí — esto es lo que
queda, en orden de prioridad.

---

## 1. Seguridad: RLS + migración de acceso a datos 🔴 CRÍTICO

**Riesgo actual:** la app opera solo con la clave anónima de Supabase (que
viaja al navegador) y ninguna tabla tiene Row Level Security. Cualquiera que
copie la clave desde las herramientas de desarrollador puede leer/escribir
todas las tablas — incluida `usuarios` (credenciales y permisos).

**Camino recomendado** (detallado en `scripts/sql/015_rls_preparacion.sql`):
mover las operaciones de datos a API routes del servidor con la
`service_role` key, y poner políticas `USING (false)` para anon en todas las
tablas. Menos invasivo que migrar a Supabase Auth.

**Esfuerzo:** sesión dedicada completa + pruebas módulo por módulo.

---

## 2. Auditoría de cambios (¿quién cambió qué y cuándo?) 🟠

Hoy es imposible saber quién modificó una calidad, una fase o un cliente.
No existe `updated_at`, `updated_by` ni tabla de historial.

Propuesta mínima:
- Columnas `updated_at` (trigger genérico `moddatetime`) en las tablas de
  captura: `ordenes_produccion`, `diseno_programacion`, `corte_programacion`.
- Tabla `historial_cambios (tabla, registro_id, campo, valor_anterior,
  valor_nuevo, usuario, fecha)` poblada por trigger en los campos sensibles:
  `calidad`, `fase_actual`, `fecha_cancelacion`, `cumplimiento_*`.
- El `usuario` requiere que el frontend lo envíe (p. ej. un `SET LOCAL` vía
  RPC) — se simplifica mucho si primero se hace el punto 1.

---

## 3. Snapshot de bonos liquidados 🟠

Los bonos se calculan en vivo desde `vw_bonos_diseno` / `vw_bonos_corte`.
Aunque las horas ya se congelan tras evaluación, el **monto pagado** no queda
registrado en ninguna parte: si un catálogo o una regla cambia después, no hay
forma de demostrar cuánto se pagó y por qué.

Propuesta: tabla `bonos_liquidados (idcolaborador, anio, semana, horas_cumplidas,
eficiencia, monto, fecha_liquidacion, liquidado_por)` + botón "Liquidar semana"
que copie el snapshot de la vista. Las vistas seguirían siendo la fuente para
semanas abiertas; las liquidadas se leen de la tabla.

---

## 4. Alta y corrección manual de órdenes 🟡

Hoy la ÚNICA forma de crear una orden es subir un Excel. Para corregir un
campo que la carga no cubre hay que editar celdas sueltas o re-subir el
archivo. Un formulario "Nueva orden" / "Editar orden" en el Panel General
eliminaría esa fricción y reduciría las cargas repetidas.

---

## 5. Versionar `vw_bonos_corte` y unificar nomenclatura 🟡

La definición de `vw_bonos_corte` no está en `scripts/sql/` — es imposible
auditar sus cambios. Además su nomenclatura difiere de `vw_bonos_diseno`
(`registro` vs `idcolaborador`, `porcentaje_eficiencia` vs `eficiencia_pct`),
lo que impide compartir código de frontend entre ambos tabs de bonos.

Extraerla con `SELECT pg_get_viewdef('manumoda.vw_bonos_corte'::regclass, true);`
y guardarla como script numerado. Al hacerlo, alinear nombres de columnas
(agregar alias nuevos al final para no romper el frontend actual).

---

## 6. Undo / soft-delete 🟡

Eliminar un folio, anular una programación o editar una celda inline son
acciones inmediatas e irreversibles. Opciones en orden de esfuerzo:
1. `deleted_at` (soft-delete) en las tablas principales + filtro en vistas.
2. Toast con botón "Deshacer" (5 s) para ediciones inline.

Depende del punto 2 (historial) para ser realmente útil.

---

## 7. Detalles menores acumulados 🟢

- **Formato de fecha en Excel:** el parser asume `dd/mm/yyyy`; un archivo con
  formato estadounidense (`mm/dd`) transpone día y mes sin aviso. Considerar
  detectar ambigüedad (día > 12) y avisar en la previsualización.
- **Costura sin catálogo propio:** las horas de costura siguen usando
  `complejidad_familias`; migrarlas al esquema de catálogos como diseño
  unificaría el mantenimiento (y el trigger).
- **`vw_bonos_diseno` y filtros de año:** los subselects filtran por
  `EXTRACT(year FROM fecha)` sin índice — si el volumen crece, agregar un
  índice funcional o una columna `anio` materializada.
- **Semana ISO vs semana "de negocio":** el frontend usa `getISOWeek`; validar
  que coincide con la semana que usa la operación (la ISO puede diferir de la
  semana calendario local en los cortes de año).

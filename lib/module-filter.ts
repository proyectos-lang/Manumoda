/**
 * Filtro que un módulo debe aplicar al abrirse desde otra pantalla.
 *
 * Lo emiten las tarjetas de "Atención hoy" del inicio: al hacer clic,
 * el módulo destino se abre ya filtrado a los pedidos de esa tarjeta,
 * en vez de mostrar todo y obligar a filtrar a mano.
 */
export type ModuleFilter =
  /** Seguimiento de Ordenes — solo vencidos */
  | "vencidos"
  /** Seguimiento de Ordenes — en riesgo o a destiempo */
  | "por-vencer"
  /** Panel General — órdenes en fase "Por Programar" */
  | "sin-programar"
  /** Diseño — programadas sin evaluar */
  | "diseno-pendiente"
  /** Corte — programados sin marcar cumplimiento */
  | "corte-pendiente"
  /** Maquila — en producción sin revisión hace más de 7 días */
  | "sin-revision"
  /** Seguimiento de Ordenes — diseño fuera de su plazo (14 días antes de S1) */
  | "diseno-atrasado"
  /** Seguimiento de Ordenes — corte fuera de su plazo (7 días antes de S1) */
  | "corte-atrasado"

/** Etiqueta legible del filtro, para mostrarlo como chip removible. */
export const MODULE_FILTER_LABEL: Record<ModuleFilter, string> = {
  vencidos: "Solo vencidos",
  "por-vencer": "Solo próximos a vencer",
  "sin-programar": "Solo sin programar",
  "diseno-pendiente": "Solo pendientes de evaluar",
  "corte-pendiente": "Solo sin cumplimiento",
  "sin-revision": "Sin revisión hace +7 días",
  "diseno-atrasado": "Solo diseño a destiempo",
  "corte-atrasado": "Solo corte a destiempo",
}

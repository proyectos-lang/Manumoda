/**
 * Plazos de entrega de las etapas previas a maquila.
 *
 * Ambas metas se miden hacia atrás desde el arranque de maquila (S1),
 * de forma acumulada:
 *
 *      Diseño              Corte          S1
 *   ─────┬───────────────────┬─────────────┬─────►
 *        │◄──── 14 días ────►│◄─ 7 días ──►│
 *        │◄────────── 21 días ────────────►│
 *
 * Es decir: Corte debe estar listo 7 días antes de S1, y Diseño 21
 * (los 7 de Corte más 14 propios).
 */

import { PHASE_PACE, parseLocalDate } from "./risk"

/** Días antes de S1 en que cada etapa debe estar terminada. */
export const LEAD_DIAS = {
  diseno: 21,
  corte: 7,
} as const

export type Etapa = keyof typeof LEAD_DIAS

export type Puntualidad =
  /** Se completó dentro del plazo. */
  | "a-tiempo"
  /** Se completó tarde, o sigue pendiente y el plazo ya venció. */
  | "a-destiempo"
  /** Aún no se completa pero el plazo no ha vencido. */
  | "pendiente"
  /** La orden no pasa por esta etapa. */
  | "na"
  /** No hay S1 real ni fecha de entrega para proyectarlo. */
  | "sin-referencia"

/** Campos que necesita la evaluación (los expone vw_seguimiento_integrado). */
export type LeadTimeRow = {
  fase_actual?: string | null
  fecha_s1?: string | null
  fecha_cancelacion?: string | null
  fecha_diseno?: string | null
  cumplimiento_diseno?: boolean | null
  /** Aprobación del cliente: marca el fin de Diseño y el paso a Corte. */
  fecha_aprobacion_diseno?: string | null
  no_requiere_diseno?: boolean | null
  fecha_corte?: string | null
  cumplimiento_corte?: string | null
  no_requiere_corte?: boolean | null
}

/** Etapas del flujo. Una orden está en exactamente una a la vez. */
export type EtapaPipeline =
  | "sin-produccion"
  | "diseno"
  | "corte"
  /** Terminó su etapa y todavía no entra a la siguiente. */
  | "entre-etapas"
  | "maquila"

const FASES_MAQUILA = new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7"])

export const ETAPA_LABEL: Record<EtapaPipeline, string> = {
  "sin-produccion": "Sin Producción",
  diseno: "Diseño",
  corte: "Corte",
  "entre-etapas": "Entre etapas",
  maquila: "Maquila",
}

/**
 * Etapa en la que la orden **se está trabajando ahora mismo**.
 *
 * Una etapa se ocupa desde que la orden entra a su plan semanal y hasta
 * que se califica como completada:
 *
 * · Sin Producción → todavía no entra al plan de diseño.
 * · Diseño         → en el plan de diseño, sin completar.
 * · Corte          → en el plan de corte, sin completar.
 * · Entre etapas   → terminó una etapa y aún no entra a la siguiente:
 *   diseño listo sin semana de corte, o corte listo sin arranque de
 *   maquila. No se está trabajando en ninguna parte.
 * · Maquila        → ya arrancó (fase S1…S7).
 *
 * El plan marca la ENTRADA y la calificación marca la SALIDA. Usar solo
 * el plan dejaba en Diseño a 88 folios ya terminados, y la columna decía
 * 108 donde en realidad se estaban trabajando 20.
 */
export function etapaActual(row: LeadTimeRow): EtapaPipeline {
  if (row.fase_actual && FASES_MAQUILA.has(row.fase_actual)) return "maquila"
  if (enPlanDeCorte(row)) return corteCompletado(row) ? "entre-etapas" : "corte"
  if (enPlanDeDiseno(row)) return disenoCompletado(row) ? "entre-etapas" : "diseno"
  // Aprobó el cliente pero nunca pasó por el plan de diseño: salió de
  // diseño de todos modos, así que tampoco está "sin producción".
  if (row.fecha_aprobacion_diseno) return "entre-etapas"
  return "sin-produccion"
}

/**
 * ¿La orden está en el plan de diseño?
 *
 * `fecha_diseno` es la fecha del registro en `diseno_programacion`, así
 * que tenerla equivale a estar en el plan.
 */
export function enPlanDeDiseno(row: LeadTimeRow): boolean {
  return row.fecha_diseno != null
}

/** ¿La orden está en el plan de corte? Mismo criterio, sobre corte_programacion. */
export function enPlanDeCorte(row: LeadTimeRow): boolean {
  return row.fecha_corte != null
}

/**
 * ¿Diseño terminó con esta orden?
 *
 * Cuenta tanto el cumplimiento interno —la diseñadora acabó sus horas—
 * como la aprobación del cliente. Cualquiera de las dos la saca de la
 * etapa: ya no hay nada que trabajar ahí.
 */
export function disenoCompletado(row: LeadTimeRow): boolean {
  return row.cumplimiento_diseno === true || row.fecha_aprobacion_diseno != null
}

/** ¿El corte ya se calificó como cumplido? */
export function corteCompletado(row: LeadTimeRow): boolean {
  return row.cumplimiento_corte === "Si"
}

/**
 * Fecha de referencia de S1.
 *
 * Si la orden ya llegó a S1 se usa esa fecha real. Si no, se proyecta
 * restando a la fecha de entrega el ritmo estándar de S1 (54 días),
 * la misma tabla que usa el semáforo de riesgo — así una orden que aún
 * no entra a maquila también se puede evaluar.
 */
export function referenciaS1(row: LeadTimeRow): { fecha: Date; proyectada: boolean } | null {
  const real = parseLocalDate(row.fecha_s1)
  if (real) return { fecha: real, proyectada: false }

  const entrega = parseLocalDate(row.fecha_cancelacion)
  if (!entrega) return null
  const proyectada = new Date(entrega)
  proyectada.setDate(proyectada.getDate() - PHASE_PACE.S1)
  return { fecha: proyectada, proyectada: true }
}

export type EvaluacionEtapa = {
  estado: Puntualidad
  /** Fecha límite en que la etapa debía estar lista. */
  limite: Date | null
  /** Si la referencia de S1 fue estimada y no real. */
  referenciaProyectada: boolean
  /**
   * Días de desfase respecto al límite.
   * Negativo = con holgura · positivo = de retraso · null = sin evaluar.
   */
  diasDesfase: number | null
}

function diffDias(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/**
 * Evalúa la puntualidad de una etapa (diseño o corte).
 *
 * Modelo "antes de S1": una etapa es "a tiempo" si quedó lista en o antes
 * de que arrancara maquila (S1); "a destiempo" solo si se registró después
 * de S1. Los plazos de LEAD_DIAS (21/7 días) son la META de referencia
 * (se muestran en el badge), pero no definen el pase/falla — el dato de
 * fecha de la etapa es la fecha de programación, no de cierre real, así
 * que exigir 7/21 días de anticipación marcaba casi todo a destiempo.
 */
export function evaluarEtapa(row: LeadTimeRow, etapa: Etapa): EvaluacionEtapa {
  const vacio: EvaluacionEtapa = {
    estado: "sin-referencia",
    limite: null,
    referenciaProyectada: false,
    diasDesfase: null,
  }

  const noRequiere = etapa === "diseno" ? row.no_requiere_diseno : row.no_requiere_corte
  if (noRequiere) return { ...vacio, estado: "na" }

  const ref = referenciaS1(row)
  if (!ref) return vacio

  // Meta informativa (para el badge/tooltip): S1 − 21/7 días.
  const limite = new Date(ref.fecha)
  limite.setDate(limite.getDate() - LEAD_DIAS[etapa])

  const completada =
    etapa === "diseno" ? row.cumplimiento_diseno === true : row.cumplimiento_corte === "Si"
  const fechaEtapa = parseLocalDate(etapa === "diseno" ? row.fecha_diseno : row.fecha_corte)

  // Completada: a tiempo si se registró en o antes de S1; a destiempo si después.
  if (completada && fechaEtapa) {
    const desfase = diffDias(fechaEtapa, ref.fecha) // fechaEtapa − S1
    return {
      estado: desfase <= 0 ? "a-tiempo" : "a-destiempo",
      limite,
      referenciaProyectada: ref.proyectada,
      diasDesfase: desfase,
    }
  }

  // Pendiente: solo es "a destiempo" si maquila ya arrancó (S1 real ya pasó)
  // y la etapa sigue sin cerrarse. Con S1 futuro o proyectado → "en plazo".
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const desfaseVsS1 = diffDias(hoy, ref.fecha)
  const aDestiempo = desfaseVsS1 > 0 && !ref.proyectada
  return {
    estado: aDestiempo ? "a-destiempo" : "pendiente",
    limite,
    referenciaProyectada: ref.proyectada,
    diasDesfase: desfaseVsS1,
  }
}

/**
 * Puntualidad de la orden **en la etapa donde está parada ahora**.
 *
 * Es la lectura que pidió operación: cada orden se cuenta una sola vez,
 * en su etapa actual, y se compara contra la meta de esa etapa
 * (Diseño: S1 − 21 días · Corte: S1 − 7 días).
 *
 * Se diferencia de `evaluarEtapa`, que califica una etapa concreta sin
 * mirar dónde está la orden: ahí una orden que ni siquiera empezó diseño
 * también salía evaluada —y reprobada— en corte.
 */
export function evaluarEtapaActual(row: LeadTimeRow): {
  etapa: EtapaPipeline
  estado: Puntualidad
  limite: Date | null
  diasDesfase: number | null
} {
  const etapa = etapaActual(row)

  // Fuera de diseño/corte no hay meta previa a S1 que medir
  if (etapa !== "diseno" && etapa !== "corte") {
    return { etapa, estado: "na", limite: null, diasDesfase: null }
  }

  const ref = referenciaS1(row)
  if (!ref) return { etapa, estado: "sin-referencia", limite: null, diasDesfase: null }

  const limite = new Date(ref.fecha)
  limite.setDate(limite.getDate() - LEAD_DIAS[etapa])

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const diasDesfase = diffDias(hoy, limite)

  return {
    estado: diasDesfase > 0 ? "a-destiempo" : "a-tiempo",
    etapa,
    limite,
    diasDesfase,
  }
}

/**
 * ¿Esta etapa está atrasada y requiere atención?
 *
 * Solo cuenta si la orden **está** en esa etapa: una orden todavía en
 * diseño no es "corte atrasado".
 */
export function etapaAtrasada(row: LeadTimeRow, etapa: Etapa): boolean {
  if (etapaActual(row) !== etapa) return false
  return evaluarEtapaActual(row).estado === "a-destiempo"
}

export const PUNTUALIDAD_LABEL: Record<Puntualidad, string> = {
  "a-tiempo": "A tiempo",
  "a-destiempo": "A destiempo",
  pendiente: "En plazo",
  na: "No aplica",
  "sin-referencia": "Sin fecha de referencia",
}

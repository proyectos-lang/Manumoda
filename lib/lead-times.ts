/**
 * Plazos de entrega de las etapas previas a maquila.
 *
 * Ambas metas se miden hacia atrás desde el arranque de maquila (S1),
 * de forma acumulada:
 *
 *      Diseño          Corte              S1
 *   ─────┬───────────────┬────────────────┬─────►
 *        │◄── 7 días ───►│◄─── 7 días ───►│
 *        │◄────────── 14 días ───────────►│
 *
 * Es decir: Corte debe estar listo 7 días antes de S1, y Diseño 14
 * (los 7 de Corte más 7 propios).
 */

import { PHASE_PACE, parseLocalDate } from "./risk"

/** Días antes de S1 en que cada etapa debe estar terminada. */
export const LEAD_DIAS = {
  diseno: 14,
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
  fecha_s1?: string | null
  fecha_cancelacion?: string | null
  fecha_diseno?: string | null
  cumplimiento_diseno?: boolean | null
  no_requiere_diseno?: boolean | null
  fecha_corte?: string | null
  cumplimiento_corte?: string | null
  no_requiere_corte?: boolean | null
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

/** Evalúa la puntualidad de una etapa (diseño o corte) contra su plazo. */
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

  const limite = new Date(ref.fecha)
  limite.setDate(limite.getDate() - LEAD_DIAS[etapa])

  const completada =
    etapa === "diseno" ? row.cumplimiento_diseno === true : row.cumplimiento_corte === "Si"
  const fechaEtapa = parseLocalDate(etapa === "diseno" ? row.fecha_diseno : row.fecha_corte)

  // Completada: se compara la fecha real de la etapa contra el límite
  if (completada && fechaEtapa) {
    const desfase = diffDias(fechaEtapa, limite)
    return {
      estado: desfase <= 0 ? "a-tiempo" : "a-destiempo",
      limite,
      referenciaProyectada: ref.proyectada,
      diasDesfase: desfase,
    }
  }

  // Pendiente: se compara HOY contra el límite
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const desfase = diffDias(hoy, limite)
  return {
    estado: desfase > 0 ? "a-destiempo" : "pendiente",
    limite,
    referenciaProyectada: ref.proyectada,
    diasDesfase: desfase,
  }
}

/** ¿Esta etapa está atrasada y requiere atención? */
export function etapaAtrasada(row: LeadTimeRow, etapa: Etapa): boolean {
  return evaluarEtapa(row, etapa).estado === "a-destiempo"
}

export const PUNTUALIDAD_LABEL: Record<Puntualidad, string> = {
  "a-tiempo": "A tiempo",
  "a-destiempo": "A destiempo",
  pendiente: "En plazo",
  na: "No aplica",
  "sin-referencia": "Sin fecha de referencia",
}

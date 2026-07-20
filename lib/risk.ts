/**
 * Cálculo de riesgo de entrega y avance de fases.
 *
 * Espeja la lógica de `riesgo_entrega` en vw_resumen_operacion /
 * vw_seguimiento_integrado para que cliente y servidor coincidan.
 */

export type Risk = "vencido" | "riesgo" | "a-tiempo" | "sin-fecha"

/** Campos de fase que marcan avance en maquila. */
export const PHASE_FIELDS = [
  "fecha_s1",
  "fecha_s2",
  "fecha_s3",
  "fecha_s4",
  "fecha_s5",
  "fecha_s6",
  "fecha_s7",
] as const

export type PhaseDateFields = Partial<Record<(typeof PHASE_FIELDS)[number], string | null>>

/**
 * Parsea una fecha `YYYY-MM-DD` como medianoche **local**.
 *
 * `new Date("2026-07-19")` la interpreta como medianoche UTC, lo que en
 * offsets negativos (México) corre el día en uno al comparar contra fechas
 * locales. Añadir `T00:00:00` fuerza la interpretación local.
 */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Días entre hoy (medianoche local) y la fecha dada. Negativo = ya pasó. */
export function daysUntil(value: string | null | undefined): number | null {
  const deadline = parseLocalDate(value)
  if (!deadline) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const ms = deadline.getTime() - today.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

export function computeProgress(
  o: PhaseDateFields & { fase_actual?: string | null },
): { progress: number; count: number } {
  if ((o.fase_actual || "").toLowerCase() === "por programar") {
    return { progress: 0, count: 0 }
  }
  let count = 0
  for (const f of PHASE_FIELDS) {
    if (o[f]) count++
  }
  return { progress: Math.round((count / PHASE_FIELDS.length) * 100), count }
}

/**
 * Días de trabajo restantes esperados según la fase actual.
 * Misma tabla que el CASE de `riesgo_entrega` en las vistas SQL
 * (vw_resumen_operacion / vw_seguimiento_integrado) — si cambia
 * aquí, cambiar allá y viceversa.
 */
export const PHASE_PACE: Record<string, number> = {
  S1: 54,
  S2: 46,
  S3: 40,
  S4: 32,
  S5: 25,
  S6: 20,
  S7: 14,
}

/**
 * Clasifica el riesgo de entrega de una orden.
 *
 * - `progress >= 100` → siempre "a-tiempo" (la orden terminó; este atajo es
 *   deliberadamente distinto del SQL, que no conoce el avance del cliente).
 * - Con `faseActual`, aplica además la regla de ritmo por fase ("A Destiempo"
 *   en las vistas SQL): si hoy + días-esperados-de-la-fase rebasa la fecha de
 *   entrega, la orden va atrasada aunque falten más de 7 días → "riesgo".
 * - Sin `faseActual` (Diseño/Corte no la conocen), solo aplica el umbral
 *   simple de días.
 */
export function computeRisk(
  fechaCancel: string | null | undefined,
  progress: number,
  faseActual?: string | null,
): { risk: Risk; days: number | null } {
  if (progress >= 100) return { risk: "a-tiempo", days: 0 }
  const days = daysUntil(fechaCancel)
  if (days === null) return { risk: "sin-fecha", days: null }
  if (days < 0) return { risk: "vencido", days }
  const pace = faseActual ? PHASE_PACE[faseActual] : undefined
  if (pace !== undefined && pace > days) return { risk: "riesgo", days }
  if (days <= 7) return { risk: "riesgo", days }
  return { risk: "a-tiempo", days }
}

/**
 * Traduce el `riesgo_entrega` que calculan las vistas SQL al tipo `Risk`.
 * "A Destiempo" (la orden no alcanza el ritmo esperado para su fase) se
 * agrupa con "riesgo" para efectos de alertas.
 */
export function riskFromServer(riesgoEntrega: string | null | undefined): Risk {
  switch (riesgoEntrega) {
    case "Vencido":
      return "vencido"
    case "En Riesgo":
    case "A Destiempo":
      return "riesgo"
    case "A Tiempo":
      return "a-tiempo"
    default:
      return "sin-fecha"
  }
}

/** ¿Este riesgo amerita una alerta al usuario? */
export function needsAttention(risk: Risk): boolean {
  return risk === "vencido" || risk === "riesgo"
}

/**
 * Fecha proyectada de terminación al ritmo estándar de la fase actual
 * (hoy + días esperados de PHASE_PACE). Null si la fase no está en la tabla.
 */
export function projectedFinish(faseActual: string | null | undefined): Date | null {
  const pace = faseActual ? PHASE_PACE[faseActual] : undefined
  if (pace === undefined) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + pace)
  return d
}

/**
 * "hace 3 días" / "hoy" / "en 5 días" — para acompañar fechas absolutas.
 */
export function relativeDays(value: string | null | undefined): string | null {
  const days = daysUntil(value)
  if (days === null) return null
  if (days === 0) return "hoy"
  if (days < 0) return `hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`
  return `en ${days} día${days === 1 ? "" : "s"}`
}

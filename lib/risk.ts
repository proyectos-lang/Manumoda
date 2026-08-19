/**
 * Cálculo de riesgo de entrega y avance de fases.
 *
 * Espeja la lógica de `riesgo_entrega` en vw_resumen_operacion /
 * vw_seguimiento_integrado para que cliente y servidor coincidan.
 */

/**
 * Estados del semáforo de entrega, en el mismo vocabulario que el
 * `riesgo_entrega` de las vistas SQL.
 *
 * Los tres estados de la convención son **A Tiempo, A Destiempo y
 * Vencido**; `entregado` y `sin-fecha` no son grados de riesgo sino
 * casos en que la orden sale de la evaluación.
 *
 * · `entregado`   — facturada; cierra el ciclo y no genera alertas.
 * · `vencido`     — la fecha de entrega ya pasó.
 * · `a-destiempo` — no alcanza el ritmo esperado para su etapa actual.
 * · `a-tiempo`    — con margen suficiente.
 * · `sin-fecha`   — no tiene fecha de entrega registrada.
 */
export type Risk =
  | "entregado"
  | "vencido"
  | "a-destiempo"
  | "a-tiempo"
  | "sin-fecha"

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
 * Ritmo de una orden que aún no entra a maquila ("Por Programar",
 * "Programada" o sin fase): necesita el ciclo completo.
 *
 * 75 = 54 días de S1 a la entrega + 21 del plazo de diseño previo a S1.
 * Se escribe literal a propósito: `lead-times.ts` (donde vive LEAD_DIAS)
 * importa de este archivo, así que importarlo de vuelta sería circular.
 */
export const PACE_SIN_FASE = 75

/**
 * Clasifica el riesgo de entrega de una orden.
 *
 * Jerarquía (la misma del CASE en las vistas SQL):
 * `entregado` → `vencido` → `a-destiempo` (no alcanza el ritmo de su
 * etapa) → `a-tiempo`.
 *
 * - `progress >= 100` → siempre "a-tiempo" (la orden terminó; este atajo es
 *   deliberadamente distinto del SQL, que no conoce el avance del cliente).
 * - Una orden fuera de maquila usa `PACE_SIN_FASE` (el ciclo completo).
 * - Sin `faseActual` (Diseño/Corte no la conocen) solo aplica el umbral
 *   simple de días.
 */
export function computeRisk(
  fechaCancel: string | null | undefined,
  progress: number,
  faseActual?: string | null,
  /** Fecha de facturación: si existe, la orden está entregada y cierra el ciclo. */
  fechaFacturacion?: string | null,
): { risk: Risk; days: number | null } {
  if (fechaFacturacion) return { risk: "entregado", days: null }
  if (progress >= 100) return { risk: "a-tiempo", days: 0 }
  const days = daysUntil(fechaCancel)
  if (days === null) return { risk: "sin-fecha", days: null }
  if (days < 0) return { risk: "vencido", days }
  // Una fase conocida usa su ritmo; una orden que aún no entra a maquila
  // necesita el ciclo completo. Sin fase declarada no se aplica ritmo.
  const pace = faseActual ? (PHASE_PACE[faseActual] ?? PACE_SIN_FASE) : undefined
  if (pace !== undefined && pace > days) return { risk: "a-destiempo", days }
  return { risk: "a-tiempo", days }
}

/** Traduce el `riesgo_entrega` que calculan las vistas SQL al tipo `Risk`. */
export function riskFromServer(riesgoEntrega: string | null | undefined): Risk {
  switch (riesgoEntrega) {
    case "Entregado":
      return "entregado"
    case "Vencido":
      return "vencido"
    case "A Destiempo":
      return "a-destiempo"
    // "En Riesgo" desapareció del semáforo; se mapea al estado vigente más
    // cercano por si alguna vista o dato quedara sin migrar.
    case "En Riesgo":
      return "a-destiempo"
    case "A Tiempo":
      return "a-tiempo"
    default:
      return "sin-fecha"
  }
}

/** ¿Este riesgo amerita una alerta al usuario? */
export function needsAttention(risk: Risk): boolean {
  return risk === "vencido" || risk === "a-destiempo"
}

/** Umbral de "entrega encima" para las tarjetas de atención. */
export const DIAS_POR_VENCER = 7

/**
 * ¿La entrega está encima (o ya pasó)?
 *
 * Es una alerta operativa, no un estado del semáforo: Diseño y Corte no
 * conocen la fase de maquila, así que no pueden aplicar la regla de ritmo
 * y se guían solo por la cercanía de la fecha.
 */
export function esProximoAVencer(
  fechaCancel: string | null | undefined,
  dias: number = DIAS_POR_VENCER,
): boolean {
  const d = daysUntil(fechaCancel)
  return d !== null && d <= dias
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

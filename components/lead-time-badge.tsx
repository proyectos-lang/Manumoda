"use client"

/**
 * Indicador de puntualidad de Diseño / Corte contra su plazo previo a S1.
 */

import { format } from "date-fns"
import { es } from "date-fns/locale"

import {
  LEAD_DIAS,
  PUNTUALIDAD_LABEL,
  evaluarEtapa,
  type Etapa,
  type LeadTimeRow,
} from "@/lib/lead-times"
import { cn } from "@/lib/utils"

const TONE: Record<string, string> = {
  "a-tiempo": "border-emerald-300 bg-emerald-50 text-emerald-700",
  "a-destiempo": "border-rose-300 bg-rose-50 text-rose-700",
  pendiente: "border-slate-200 bg-slate-50 text-slate-500",
}

export function LeadTimeBadge({
  row,
  etapa,
  className,
}: {
  row: LeadTimeRow
  etapa: Etapa
  className?: string
}) {
  const ev = evaluarEtapa(row, etapa)
  if (ev.estado === "na" || ev.estado === "sin-referencia") return null

  const nombre = etapa === "diseno" ? "Diseño" : "Corte"
  const limiteTxt = ev.limite ? format(ev.limite, "dd MMM", { locale: es }) : "—"
  const d = ev.diasDesfase

  // Texto compacto: "-3d" con holgura, "+5d" de retraso
  const desfaseTxt =
    d === null ? "" : d === 0 ? "justo" : d > 0 ? `+${d}d` : `${d}d`

  const detalle =
    ev.estado === "a-destiempo"
      ? `${nombre} debía estar listo el ${limiteTxt} (${LEAD_DIAS[etapa]} días antes de S1)` +
        (d !== null && d > 0 ? ` — ${d} día(s) de retraso` : "")
      : ev.estado === "a-tiempo"
        ? `${nombre} se completó dentro del plazo (límite ${limiteTxt})`
        : `Plazo de ${nombre}: ${limiteTxt}` +
          (d !== null ? ` — quedan ${Math.abs(d)} día(s)` : "")

  return (
    <span
      title={
        detalle + (ev.referenciaProyectada ? " · S1 estimado desde la fecha de entrega" : "")
      }
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        TONE[ev.estado],
        ev.referenciaProyectada && "border-dashed",
        className,
      )}
    >
      {PUNTUALIDAD_LABEL[ev.estado]}
      {desfaseTxt && <span className="font-normal opacity-70">{desfaseTxt}</span>}
    </span>
  )
}

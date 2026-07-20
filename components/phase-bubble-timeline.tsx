"use client"

import { format } from "date-fns"
import { es } from "date-fns/locale"

import { PHASE_FIELDS, type PhaseDateFields, parseLocalDate } from "@/lib/risk"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function fmt(iso: string | null | undefined): string | null {
  const d = parseLocalDate(iso)
  if (!d) return null
  try {
    return format(d, "dd MMM yyyy", { locale: es })
  } catch {
    return null
  }
}

/**
 * Avance S1 → S7 como burbujas. Verde = fase alcanzada, gris = pendiente.
 * Acepta cualquier fila que tenga los campos `fecha_s1` … `fecha_s7`.
 */
export function PhaseBubbleTimeline({ row }: { row: PhaseDateFields }) {
  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex items-center gap-1.5">
        {PHASE_FIELDS.map((key, i) => {
          const label = `S${i + 1}`
          const date = row[key] ?? null
          const filled = Boolean(date)
          const shown = date ? (fmt(date) ?? "Pendiente") : "Pendiente"
          return (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <span
                  aria-label={`${label}: ${shown}`}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[9px] font-semibold transition-transform hover:scale-110",
                    filled
                      ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                      : "border border-slate-300 bg-slate-50 text-slate-400",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="font-medium">
                  {label}: {shown}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

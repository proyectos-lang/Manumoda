"use client"

import type React from "react"

import { cn } from "@/lib/utils"

/** Formatea horas con un decimal y sufijo "h" — el default histórico. */
export const formatHours = (v: number) => `${v.toFixed(1)} h`

/** Formatea un conteo entero. */
export const formatCount = (v: number) => String(v)

export function KpiCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  valueColor,
  format = formatCount,
  hint,
}: {
  label: string
  value: number
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  valueColor: string
  /** Cómo renderizar el valor. Por defecto, conteo entero. */
  format?: (v: number) => string
  /** Línea secundaria opcional bajo el valor. */
  hint?: string
}) {
  const texto = format(value)

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1",
            iconBg,
            iconColor,
          )}
        >
          {icon}
        </div>
      </div>
      <div>
        <p
          title={texto}
          className={cn("font-bold tabular-nums leading-tight", tamanoValor(texto), valueColor)}
        >
          {texto}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

/**
 * Escala el número según lo que ocupe.
 *
 * Las tarjetas van en rejillas de hasta cinco columnas, así que un importe
 * como "$13,499,041.00" se desbordaba del contenedor a tamaño fijo. En vez
 * de recortar el número —que en dinero es peor que verlo chico— se reduce
 * el tipo por tramos.
 */
function tamanoValor(texto: string): string {
  if (texto.length <= 8) return "text-2xl"
  if (texto.length <= 11) return "text-xl"
  if (texto.length <= 15) return "text-lg"
  return "text-base"
}

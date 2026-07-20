"use client"

/**
 * Tendencia de eficiencia promedio por semana.
 * Responde la pregunta que la vista semana-por-semana no puede:
 * ¿estamos mejorando o empeorando?
 */

import { useMemo } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { TrendingDown, TrendingUp, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

export type TrendPoint = {
  anio: number | null
  semana: number | null
  eficiencia: number | null
}

export function EficienciaTrend({
  rows,
  umbralBono = 80,
  className,
}: {
  /** Filas crudas de la vista de bonos (todas las semanas, todas las personas). */
  rows: TrendPoint[]
  /** Línea de referencia del bono (eficiencia mínima en %). */
  umbralBono?: number
  className?: string
}) {
  const data = useMemo(() => {
    // Promedio de eficiencia por (año, semana)
    const map = new Map<string, { sum: number; n: number; anio: number; semana: number }>()
    for (const r of rows) {
      if (r.anio == null || r.semana == null || r.eficiencia == null) continue
      const k = `${r.anio}-${r.semana}`
      const e = map.get(k) ?? { sum: 0, n: 0, anio: r.anio, semana: r.semana }
      e.sum += Number(r.eficiencia)
      e.n++
      map.set(k, e)
    }
    return [...map.values()]
      .sort((a, b) => (a.anio - b.anio) || (a.semana - b.semana))
      .slice(-12) // últimas 12 semanas
      .map((e) => ({
        label: `S${e.semana}`,
        eficiencia: Math.round((e.sum / e.n) * 10) / 10,
      }))
  }, [rows])

  if (data.length < 2) return null

  const primera = data[0].eficiencia
  const ultima = data[data.length - 1].eficiencia
  const delta = Math.round((ultima - primera) * 10) / 10
  const TrendIcon = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus
  const trendCls = delta > 1 ? "text-emerald-600" : delta < -1 ? "text-rose-600" : "text-muted-foreground"

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Tendencia de eficiencia</p>
          <p className="text-[11px] text-muted-foreground">
            Promedio del equipo · últimas {data.length} semanas
          </p>
        </div>
        <span className={cn("flex items-center gap-1 text-sm font-bold tabular-nums", trendCls)}>
          <TrendIcon className="size-4" />
          {delta > 0 ? "+" : ""}{delta} pts
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            domain={[0, 120]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number) => [`${v}%`, "Eficiencia promedio"]}
          />
          <ReferenceLine
            y={umbralBono}
            stroke="oklch(0.65 0.15 85)"
            strokeDasharray="4 4"
            label={{ value: `Bono ${umbralBono}%`, fontSize: 9, fill: "var(--muted-foreground)", position: "insideTopRight" }}
          />
          <Line
            type="monotone"
            dataKey="eficiencia"
            stroke="oklch(0.55 0.2 285)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

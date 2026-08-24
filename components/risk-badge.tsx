"use client"

import { AlertTriangle, CheckCircle2, Circle, PackageCheck, TrendingDown } from "lucide-react"

import type { Risk } from "@/lib/risk"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export function RiskBadge({
  risk,
  days,
  className,
}: {
  risk: Risk
  days: number | null
  className?: string
}) {
  const config: Record<Risk, { label: string; className: string; icon: typeof AlertTriangle }> = {
    entregado: {
      label: "Entregado",
      className: "border-violet-300 bg-violet-50 text-violet-700",
      icon: PackageCheck,
    },
    vencido: {
      label: days !== null ? `Vencido · ${Math.abs(days)}d` : "Vencido",
      className: "border-rose-300 bg-rose-50 text-rose-700",
      icon: AlertTriangle,
    },
    "a-destiempo": {
      label: days !== null ? `A Destiempo · ${days}d` : "A Destiempo",
      className: "border-orange-300 bg-orange-50 text-orange-700",
      icon: TrendingDown,
    },
    "a-tiempo": {
      label: days !== null ? `A Tiempo · ${days}d` : "A Tiempo",
      className: "border-emerald-300 bg-emerald-50 text-emerald-700",
      icon: CheckCircle2,
    },
    "sin-fecha": {
      label: "Sin Fecha",
      className: "border-slate-300 bg-slate-100 text-slate-600",
      icon: Circle,
    },
  }
  const c = config[risk]
  const Icon = c.icon
  // `max-w-full` + truncado: la insignia base trae `w-fit whitespace-nowrap`,
  // así que en contenedores angostos —las tarjetas del Kanban, con diez
  // columnas— crecía más que su tarjeta y el texto se desbordaba. El título
  // conserva la etiqueta completa para cuando se recorta.
  return (
    <Badge
      variant="outline"
      title={c.label}
      className={cn("max-w-full gap-1.5 font-medium", c.className, className)}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{c.label}</span>
    </Badge>
  )
}

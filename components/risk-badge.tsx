"use client"

import { AlertTriangle, CheckCircle2, Circle, Clock } from "lucide-react"

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
    vencido: {
      label: days !== null ? `Vencido · ${Math.abs(days)}d` : "Vencido",
      className: "border-rose-300 bg-rose-50 text-rose-700",
      icon: AlertTriangle,
    },
    riesgo: {
      label: days !== null ? `En Riesgo · ${days}d` : "En Riesgo",
      className: "border-amber-300 bg-amber-50 text-amber-800",
      icon: Clock,
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
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", c.className, className)}>
      <Icon className="size-3" />
      {c.label}
    </Badge>
  )
}

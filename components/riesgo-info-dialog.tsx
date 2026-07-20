"use client"

/**
 * Explica el semáforo de riesgo de entrega — misma regla que las
 * vistas SQL (vw_resumen_operacion / vw_seguimiento_integrado) y
 * que computeRisk en lib/risk.ts.
 */

import { HelpCircle } from "lucide-react"

import { PHASE_PACE } from "@/lib/risk"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function RiesgoInfoDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
          <HelpCircle className="size-3.5" />
          ¿Cómo se calcula el riesgo?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Semáforo de riesgo de entrega</DialogTitle>
          <DialogDescription>
            Cada orden se clasifica comparando su fecha de entrega con hoy y con el ritmo
            esperado de su fase.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-2">
            <Rule color="bg-rose-500" label="Vencido">
              La fecha de entrega ya pasó.
            </Rule>
            <Rule color="bg-amber-500" label="En Riesgo">
              Faltan 7 días o menos para la entrega, <em>o</em> la orden va{" "}
              <strong>a destiempo</strong>: al ritmo estándar de su fase no alcanza a terminar
              antes de la fecha de entrega.
            </Rule>
            <Rule color="bg-emerald-500" label="A Tiempo">
              Hay margen suficiente según la fase actual.
            </Rule>
            <Rule color="bg-slate-400" label="Sin Fecha">
              La orden no tiene fecha de entrega registrada.
            </Rule>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-2 text-xs font-semibold text-foreground">
              Días estándar restantes por fase
            </p>
            <div className="grid grid-cols-7 gap-1 text-center">
              {Object.entries(PHASE_PACE).map(([fase, dias]) => (
                <div key={fase} className="rounded-md bg-white px-1 py-1.5 ring-1 ring-border">
                  <p className="text-[10px] font-semibold text-muted-foreground">{fase}</p>
                  <p className="text-xs font-bold tabular-nums text-foreground">{dias}d</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Ejemplo: una orden en S4 necesita ~32 días para terminar. Si su entrega es en 20
              días, va <strong>a destiempo</strong> aunque la fecha aún no llegue.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Rule({
  color,
  label,
  children,
}: {
  color: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1 size-2.5 shrink-0 rounded-full ${color}`} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">{label}:</strong> {children}
      </p>
    </div>
  )
}

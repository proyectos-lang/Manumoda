"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Clock } from "lucide-react"

import { computeRisk, daysUntil, needsAttention, type Risk } from "@/lib/risk"
import { cn } from "@/lib/utils"

export type DeadlineItem = {
  folio: string | null
  fecha_cancelacion: string | null | undefined
  /** Riesgo ya calculado (p. ej. desde la vista SQL). Si se omite, se calcula. */
  risk?: Risk
  /** Etiqueta secundaria opcional: modelo, cliente, etc. */
  detalle?: string | null
}

/**
 * Banner de pedidos vencidos o próximos a vencer.
 * No renderiza nada si no hay ninguno que requiera atención.
 */
export function DeadlineAlertBanner({
  items,
  className,
}: {
  items: DeadlineItem[]
  className?: string
}) {
  const [open, setOpen] = useState(false)

  const { vencidos, enRiesgo } = useMemo(() => {
    // Un folio puede llegar varias veces: diseno_programacion admite
    // reprogramaciones y corte_programacion tiene un registro por semana.
    // Sin deduplicar, el mismo pedido aparecería repetido y los conteos
    // contarían registros en vez de pedidos.
    const seen = new Set<string>()
    const v: (DeadlineItem & { days: number | null })[] = []
    const r: (DeadlineItem & { days: number | null })[] = []

    for (const it of items) {
      const key = it.folio ?? ""
      if (key && seen.has(key)) continue
      const risk = it.risk ?? computeRisk(it.fecha_cancelacion, 0).risk
      if (!needsAttention(risk)) continue
      if (key) seen.add(key)
      const days = daysUntil(it.fecha_cancelacion)
      if (risk === "vencido") v.push({ ...it, days })
      else r.push({ ...it, days })
    }

    // Los más urgentes primero
    v.sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    r.sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    return { vencidos: v, enRiesgo: r }
  }, [items])

  const total = vencidos.length + enRiesgo.length
  if (total === 0) return null

  const hayVencidos = vencidos.length > 0
  const listado = [...vencidos, ...enRiesgo]

  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm",
        hayVencidos
          ? "border-rose-300 bg-rose-50/70"
          : "border-amber-300 bg-amber-50/70",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
            hayVencidos
              ? "bg-rose-100 text-rose-600 ring-rose-200"
              : "bg-amber-100 text-amber-600 ring-amber-200",
          )}
        >
          {hayVencidos ? <AlertTriangle className="size-4" /> : <Clock className="size-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-semibold",
              hayVencidos ? "text-rose-900" : "text-amber-900",
            )}
          >
            {hayVencidos && (
              <>
                {vencidos.length} {vencidos.length === 1 ? "pedido vencido" : "pedidos vencidos"}
              </>
            )}
            {hayVencidos && enRiesgo.length > 0 && " · "}
            {enRiesgo.length > 0 && (
              <>
                {enRiesgo.length} {enRiesgo.length === 1 ? "próximo a vencer" : "próximos a vencer"}
              </>
            )}
          </p>
          <p
            className={cn(
              "text-xs",
              hayVencidos ? "text-rose-700/80" : "text-amber-700/80",
            )}
          >
            {open ? "Ocultar folios" : "Ver folios afectados"}
          </p>
        </div>

        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-inherit px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {listado.map((it, i) => {
              const vencido = (it.days ?? 0) < 0
              return (
                <span
                  key={`${it.folio ?? "s/f"}-${i}`}
                  title={it.detalle ?? undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]",
                    vencido
                      ? "border-rose-300 bg-white text-rose-700"
                      : "border-amber-300 bg-white text-amber-800",
                  )}
                >
                  {it.folio ?? "sin folio"}
                  <span className="font-sans font-semibold tabular-nums">
                    {it.days === null
                      ? "—"
                      : vencido
                        ? `${Math.abs(it.days)}d tarde`
                        : `${it.days}d`}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

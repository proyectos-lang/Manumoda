"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CalendarIcon,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Circle,
  Clock,
  History,
  LayoutGrid,
  List,
  Search,
  Users,
  X,
} from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

function formatDeliveryDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return "—"
  return format(d, "dd MMM yyyy", { locale: es })
}

type Risk = "vencido" | "riesgo" | "a-tiempo" | "sin-fecha"

type EnrichedOrder = OrdenProduccion & {
  __progress: number
  __completedPhases: number
  __risk: Risk
  __daysToDeadline: number | null
}

const PHASE_FIELDS: (keyof OrdenProduccion)[] = [
  "fecha_s1",
  "fecha_s2",
  "fecha_s3",
  "fecha_s4",
  "fecha_s5",
  "fecha_s6",
  "fecha_s7",
]

function computeProgress(o: OrdenProduccion): { progress: number; count: number } {
  if ((o.fase_actual || "").toLowerCase() === "por programar") {
    return { progress: 0, count: 0 }
  }
  let count = 0
  for (const f of PHASE_FIELDS) {
    if (o[f]) count++
  }
  return { progress: Math.round((count / 7) * 100), count }
}

function computeRisk(fechaCancel: string | null | undefined): {
  risk: Risk
  days: number | null
} {
  if (!fechaCancel) return { risk: "sin-fecha", days: null }
  const deadline = new Date(fechaCancel)
  if (Number.isNaN(deadline.getTime())) return { risk: "sin-fecha", days: null }
  const now = new Date()
  const ms = deadline.getTime() - now.setHours(0, 0, 0, 0)
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days < 0) return { risk: "vencido", days }
  if (days <= 7) return { risk: "riesgo", days }
  return { risk: "a-tiempo", days }
}

function RiskBadge({ risk, days }: { risk: Risk; days: number | null }) {
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
    <Badge variant="outline" className={cn("gap-1.5 font-medium", c.className)}>
      <Icon className="size-3" />
      {c.label}
    </Badge>
  )
}

function ProgressBar({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-emerald-500"
      : value >= 40
        ? "bg-amber-500"
        : value > 0
          ? "bg-rose-500"
          : "bg-slate-300"
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={cn("h-full transition-all duration-500 ease-out", color)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

const PHASE_BADGE_CLASS: Record<string, string> = {
  "Por Programar": "border-slate-300 bg-slate-100 text-slate-700",
  Programada: "border-violet-300 bg-violet-100 text-violet-700",
  S1: "border-cyan-300 bg-cyan-50 text-cyan-700",
  S2: "border-sky-300 bg-sky-50 text-sky-700",
  S3: "border-blue-300 bg-blue-50 text-blue-700",
  S4: "border-indigo-300 bg-indigo-50 text-indigo-700",
  S5: "border-violet-300 bg-violet-50 text-violet-700",
  S6: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700",
  S7: "border-emerald-300 bg-emerald-50 text-emerald-700",
}

function PhaseBadge({ phase }: { phase: string | null | undefined }) {
  const p = phase || "—"
  const cls = PHASE_BADGE_CLASS[p] || "border-slate-300 bg-slate-100 text-slate-600"
  return (
    <Badge variant="outline" className={cn("font-medium", cls)}>
      {p}
    </Badge>
  )
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  try {
    return format(new Date(d), "dd MMM yyyy", { locale: es })
  } catch {
    return "—"
  }
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—"
  try {
    return format(new Date(d), "dd MMM yyyy · HH:mm", { locale: es })
  } catch {
    return "—"
  }
}

export function AnalyticsDashboard({ configMissing }: { configMissing: boolean }) {
  const [orders, setOrders] = useState<OrdenProduccion[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [selectedClientes, setSelectedClientes] = useState<string[]>([])
  const [fechaPedido, setFechaPedido] = useState<Date | undefined>()
  const [fechaCancel, setFechaCancel] = useState<Date | undefined>()
  const [view, setView] = useState<"cards" | "list">("cards")

  const [historyOrder, setHistoryOrder] = useState<EnrichedOrder | null>(null)

  useEffect(() => {
    if (configMissing) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }
      try {
        const ordersRes = await supabase
          .from("ordenes_produccion")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("id", { ascending: false })
        if (cancelled) return
        if (ordersRes.error) throw ordersRes.error
        setOrders((ordersRes.data || []) as OrdenProduccion[])
      } catch (err) {
        if (!cancelled) {
          console.log("[v0] Analytics load error:", err)
          toast.error("Error al cargar datos", {
            description: err instanceof Error ? err.message : "Verifica tu conexión a Supabase.",
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [configMissing])

  const enriched: EnrichedOrder[] = useMemo(() => {
    return orders.map((o) => {
      const { progress, count } = computeProgress(o)
      const { risk, days } = computeRisk(o.fecha_cancelacion)
      return {
        ...o,
        __progress: progress,
        __completedPhases: count,
        __risk: risk,
        __daysToDeadline: days,
      }
    })
  }, [orders])

  // Distinct cliente values (the "compradora") sourced directly from orders
  const clienteOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      const c = (o.cliente || "").trim()
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"))
  }, [orders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fp = fechaPedido ? format(fechaPedido, "yyyy-MM-dd") : null
    const fc = fechaCancel ? format(fechaCancel, "yyyy-MM-dd") : null
    const clienteSet = new Set(selectedClientes)
    return enriched.filter((o) => {
      if (q) {
        const hay = `${o.folio || ""} ${o.modelo || ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (clienteSet.size > 0) {
        const c = (o.cliente || "").trim()
        if (!clienteSet.has(c)) return false
      }
      if (fp) {
        const op = o.fecha_pedido ? String(o.fecha_pedido).slice(0, 10) : null
        if (op !== fp) return false
      }
      if (fc) {
        const oc = o.fecha_cancelacion ? String(o.fecha_cancelacion).slice(0, 10) : null
        if (oc !== fc) return false
      }
      return true
    })
  }, [enriched, search, selectedClientes, fechaPedido, fechaCancel])

  const summary = useMemo(() => {
    const total = filtered.length
    const counts = { vencido: 0, riesgo: 0, "a-tiempo": 0, "sin-fecha": 0 } as Record<Risk, number>
    let progressSum = 0
    for (const o of filtered) {
      counts[o.__risk]++
      progressSum += o.__progress
    }
    return {
      total,
      vencido: counts.vencido,
      riesgo: counts.riesgo,
      aTiempo: counts["a-tiempo"],
      sinFecha: counts["sin-fecha"],
      avgProgress: total > 0 ? Math.round(progressSum / total) : 0,
    }
  }, [filtered])

  const clearFilters = () => {
    setSearch("")
    setSelectedClientes([])
    setFechaPedido(undefined)
    setFechaCancel(undefined)
  }

  const hasFilters =
    search.length > 0 ||
    selectedClientes.length > 0 ||
    fechaPedido !== undefined ||
    fechaCancel !== undefined

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="Total" value={summary.total} accent="violet" />
        <SummaryCard
          label="Avance Promedio"
          value={`${summary.avgProgress}%`}
          accent="cyan"
        />
        <SummaryCard label="A Tiempo" value={summary.aTiempo} accent="emerald" />
        <SummaryCard label="En Riesgo" value={summary.riesgo} accent="amber" />
        <SummaryCard label="Vencidos" value={summary.vencido} accent="rose" />
      </div>

      {/* Sticky Control Panel */}
      <div className="sticky top-16 z-20 -mx-2 rounded-2xl border border-border/60 bg-white/85 px-4 py-4 shadow-lg shadow-black/5 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por Folio o Modelo..."
              className="h-9 border-border/60 bg-white pl-9 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Cliente (multi-select) */}
          <ClienteMultiSelect
            options={clienteOptions}
            selected={selectedClientes}
            onChange={setSelectedClientes}
          />

          {/* Fecha de Pedido */}
          <DateFilterPopover
            value={fechaPedido}
            onChange={setFechaPedido}
            placeholder="Fecha Pedido"
          />

          {/* Fecha de Cancelación */}
          <DateFilterPopover
            value={fechaCancel}
            onChange={setFechaCancel}
            placeholder="Fecha Límite"
          />

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-9 text-muted-foreground hover:text-foreground"
            >
              <X className="mr-1 size-3.5" />
              Limpiar
            </Button>
          )}

          {/* View Toggle */}
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-border/60 bg-white">
            <button
              type="button"
              onClick={() => setView("cards")}
              className={cn(
                "flex h-9 items-center gap-1.5 px-3 text-sm font-medium transition-colors",
                view === "cards"
                  ? "bg-violet-100 text-violet-700"
                  : "text-muted-foreground hover:bg-slate-50 hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-4" />
              <span className="hidden sm:inline">Tarjetas</span>
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "flex h-9 items-center gap-1.5 border-l border-border/60 px-3 text-sm font-medium transition-colors",
                view === "list"
                  ? "bg-violet-100 text-violet-700"
                  : "text-muted-foreground hover:bg-slate-50 hover:text-foreground",
              )}
            >
              <List className="size-4" />
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-border/60 bg-white/60"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((o) => (
            <OrderCard key={String(o.id)} order={o} onHistory={() => setHistoryOrder(o)} />
          ))}
        </div>
      ) : (
        <OrdersListView orders={filtered} onHistory={(o) => setHistoryOrder(o)} />
      )}

      {/* History Sheet */}
      <Sheet open={historyOrder !== null} onOpenChange={(o) => !o && setHistoryOrder(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-foreground">
              <History className="size-5 text-violet-600" />
              Historial de Órden
            </SheetTitle>
            <SheetDescription>
              Línea de tiempo completa con métricas de producción.
            </SheetDescription>
          </SheetHeader>

          {historyOrder && <HistoryContent order={historyOrder} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent: "violet" | "cyan" | "emerald" | "amber" | "rose"
}) {
  const accentMap = {
    violet: "from-violet-500/15 to-violet-500/0 text-violet-700 ring-violet-200",
    cyan: "from-cyan-500/15 to-cyan-500/0 text-cyan-700 ring-cyan-200",
    emerald: "from-emerald-500/15 to-emerald-500/0 text-emerald-700 ring-emerald-200",
    amber: "from-amber-500/15 to-amber-500/0 text-amber-700 ring-amber-200",
    rose: "from-rose-500/15 to-rose-500/0 text-rose-700 ring-rose-200",
  } as const
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-gradient-to-br p-4 shadow-sm ring-1 ring-inset",
        accentMap[accent],
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function ClienteMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const label =
    selected.length === 0
      ? "Cliente"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} clientes`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 w-[210px] justify-between gap-2 border-border/60 bg-white text-sm font-normal",
            selected.length === 0 && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {selected.length > 0 && (
              <Badge
                variant="secondary"
                className="h-5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
              >
                {selected.length}
              </Badge>
            )}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar cliente..." className="h-9" />
          <CommandList>
            <CommandEmpty>Sin clientes.</CommandEmpty>
            {selected.length > 0 && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => onChange([])}
                  className="justify-center text-xs text-muted-foreground"
                >
                  <X className="mr-1.5 size-3.5" />
                  Limpiar selección ({selected.length})
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((opt) => {
                const checked = selectedSet.has(opt)
                return (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                    <div
                      className={cn(
                        "mr-2 flex size-4 items-center justify-center rounded border",
                        checked
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-slate-300",
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </div>
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DateFilterPopover({
  value,
  onChange,
  placeholder,
}: {
  value: Date | undefined
  onChange: (d: Date | undefined) => void
  placeholder: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 border-border/60 bg-white text-sm font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-3.5" />
          {value ? format(value, "dd MMM yyyy", { locale: es }) : placeholder}
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onChange(undefined)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation()
                  onChange(undefined)
                }
              }}
              className="ml-1 rounded p-0.5 hover:bg-slate-100"
              aria-label="Limpiar fecha"
            >
              <X className="size-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={onChange} locale={es} initialFocus />
      </PopoverContent>
    </Popover>
  )
}

function OrderCard({ order, onHistory }: { order: EnrichedOrder; onHistory: () => void }) {
  return (
    <Card className="group relative overflow-hidden border-border/60 bg-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/10">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Folio
            </p>
            <p className="truncate font-mono text-base font-bold text-foreground">{order.folio}</p>
          </div>
          <RiskBadge risk={order.__risk} days={order.__daysToDeadline} />
        </div>

        <div className="space-y-1">
          <p className="line-clamp-1 text-sm font-semibold text-foreground">
            {order.modelo || "—"}
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">{order.cliente || "—"}</p>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
          <CalendarIcon className="size-3.5 shrink-0 text-violet-600" />
          <span className="text-muted-foreground">Entrega:</span>
          <span className="font-semibold text-foreground">
            {formatDeliveryDate(order.fecha_cancelacion)}
          </span>
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Avance</span>
            <span className="font-bold tabular-nums text-foreground">{order.__progress}%</span>
          </div>
          <ProgressBar value={order.__progress} />
          <div className="flex items-center justify-between gap-2 pt-1">
            <PhaseBadge phase={order.fase_actual} />
            <Button
              size="sm"
              variant="ghost"
              onClick={onHistory}
              className="h-7 gap-1.5 px-2 text-xs text-violet-700 hover:bg-violet-50 hover:text-violet-800"
            >
              <History className="size-3.5" />
              Historial
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OrdersListView({
  orders,
  onHistory,
}: {
  orders: EnrichedOrder[]
  onHistory: (o: EnrichedOrder) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Folio</th>
              <th className="px-4 py-3 text-left font-semibold">Modelo</th>
              <th className="px-4 py-3 text-left font-semibold">Compradora</th>
              <th className="px-4 py-3 text-left font-semibold">Fecha de Entrega</th>
              <th className="px-4 py-3 text-left font-semibold">Avance</th>
              <th className="px-4 py-3 text-left font-semibold">Riesgo</th>
              <th className="px-4 py-3 text-left font-semibold">Fase</th>
              <th className="px-4 py-3 text-right font-semibold">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {orders.map((o) => {
              return (
                <tr key={String(o.id)} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono font-semibold text-foreground">{o.folio}</td>
                  <td className="px-4 py-3 text-foreground">{o.modelo || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.cliente || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{formatDeliveryDate(o.fecha_cancelacion)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={o.__progress} />
                      <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-foreground">
                        {o.__progress}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RiskBadge risk={o.__risk} days={o.__daysToDeadline} />
                  </td>
                  <td className="px-4 py-3">
                    <PhaseBadge phase={o.fase_actual} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onHistory(o)}
                      className="h-7 gap-1.5 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
                    >
                      <History className="size-3.5" />
                      Historial
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HistoryContent({ order }: { order: EnrichedOrder }) {
  const phases: { label: string; date: string | null | undefined; key: string }[] = [
    {
      label: "Programada",
      date: order.fecha_pedido,
      key: "programada",
    },
    { label: "S1", date: order.fecha_s1, key: "s1" },
    { label: "S2", date: order.fecha_s2, key: "s2" },
    { label: "S3", date: order.fecha_s3, key: "s3" },
    { label: "S4", date: order.fecha_s4, key: "s4" },
    { label: "S5", date: order.fecha_s5, key: "s5" },
    { label: "S6", date: order.fecha_s6, key: "s6" },
    { label: "S7", date: order.fecha_s7, key: "s7" },
  ]

  return (
    <div className="mt-6 space-y-6">
      {/* Header card */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-violet-50 to-white p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Folio
            </p>
            <p className="font-mono text-lg font-bold text-foreground">{order.folio}</p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {order.modelo || "—"}
            </p>
            <p className="text-xs text-muted-foreground">{order.cliente || "—"}</p>
          </div>
          <RiskBadge risk={order.__risk} days={order.__daysToDeadline} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Avance global</span>
            <span className="font-bold tabular-nums text-foreground">{order.__progress}%</span>
          </div>
          <ProgressBar value={order.__progress} />
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Línea de tiempo</h3>
        <ol className="relative space-y-4 border-l border-border/60 pl-6">
          {phases.map((p) => {
            const completed = Boolean(p.date)
            return (
              <li key={p.key} className="relative">
                <span
                  className={cn(
                    "absolute -left-[31px] top-0 flex size-6 items-center justify-center rounded-full ring-4 ring-white",
                    completed
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200 text-slate-400",
                  )}
                >
                  {completed ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <Circle className="size-3" />
                  )}
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      completed ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {p.label}
                  </p>
                  <p
                    className={cn(
                      "text-xs tabular-nums",
                      completed ? "text-foreground" : "text-muted-foreground/60",
                    )}
                  >
                    {completed ? fmtDate(p.date) : "Pendiente"}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Read-only summary */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Resumen de calidad</h3>
        <div className="grid grid-cols-2 gap-3">
          <SummaryField
            label="Calidad"
            value={order.calidad !== null && order.calidad !== undefined ? `${order.calidad} / 10` : "—"}
          />
          <SummaryField label="Tipo de Revisión" value={order.tipo_revision || "—"} />
          <SummaryField
            label="Habilitaciones e Insumos"
            value={order.habilitaciones_insumos || "—"}
          />
          <SummaryField
            label="Última Revisión"
            value={fmtDateTime(order.fecha_ultima_revision)}
          />
        </div>
        <div className="mt-3">
          <SummaryField
            label="Comentarios Generales"
            value={order.comentarios_generales || "—"}
            full
          />
        </div>
      </div>
    </div>
  )
}

function SummaryField({
  label,
  value,
  full,
}: {
  label: string
  value: string
  full?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-slate-50/60 p-3",
        full && "col-span-full",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{value}</p>
    </div>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-white/60 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-violet-100 ring-1 ring-violet-200">
        <Search className="size-6 text-violet-600" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">
        {hasFilters ? "No se encontraron órdenes con estos filtros" : "Sin órdenes registradas"}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasFilters
          ? "Ajusta o limpia los filtros para ver más resultados."
          : "Comienza cargando un archivo de pedidos en el módulo de Cargar Folios."}
      </p>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CalendarIcon,
  Camera,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Circle,
  Download,
  History,
  LayoutGrid,
  List,
  Search,
  Users,
  X,
} from "lucide-react"
import * as XLSX from "xlsx"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { SeguimientoRow } from "@/lib/types"
import {
  computeProgress,
  computeRisk,
  daysUntil,
  riskFromServer,
  type Risk,
} from "@/lib/risk"
import { RiskBadge } from "@/components/risk-badge"
import { PhaseBubbleTimeline } from "@/components/phase-bubble-timeline"
import { DeadlineAlertBanner } from "@/components/deadline-alert-banner"
import { FolioLink } from "@/components/folio-detail-drawer"
import { EntregadoBadge, FacturarButton } from "@/components/facturar-button"
import { LeadTimeBadge } from "@/components/lead-time-badge"
import { etapaAtrasada, evaluarEtapa, PUNTUALIDAD_LABEL } from "@/lib/lead-times"
import { RiesgoInfoDialog } from "@/components/riesgo-info-dialog"
import { IncomingFilterChip } from "@/components/incoming-filter-chip"
import type { ModuleFilter } from "@/lib/module-filter"
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
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EvidenciaFotos } from "@/components/evidencia-fotos"

function formatDeliveryDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return "—"
  return format(d, "dd MMM yyyy", { locale: es })
}

/** Fila de la vista integrada, enriquecida con los derivados de riesgo/avance. */
type EnrichedOrder = SeguimientoRow & {
  __progress: number
  __completedPhases: number
  __risk: Risk
  __daysToDeadline: number | null
}

/** Estado de una etapa del pipeline (Diseño / Corte). */
type StageState = "hecho" | "programado" | "pendiente" | "na"

function StageCell({ state, fecha }: { state: StageState; fecha: string | null }) {
  if (state === "na") {
    return <span className="text-xs italic text-muted-foreground/50">N/A</span>
  }
  if (state === "pendiente") {
    return <span className="text-xs text-muted-foreground/60">—</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-xs tabular-nums">
      {state === "hecho" ? (
        <CheckCircle2 className="size-3 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="size-3 shrink-0 text-slate-400" />
      )}
      {formatDeliveryDate(fecha)}
    </span>
  )
}

/** Píldora compacta de etapa, para la vista de tarjetas. */
function StagePill({ label, state }: { label: string; state: StageState }) {
  const cls: Record<StageState, string> = {
    hecho: "border-emerald-300 bg-emerald-50 text-emerald-700",
    programado: "border-sky-300 bg-sky-50 text-sky-700",
    pendiente: "border-slate-200 bg-slate-50 text-slate-400",
    na: "border-slate-200 bg-slate-50 text-slate-400 line-through",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium",
        cls[state],
      )}
    >
      {state === "hecho" && <Check className="size-2.5" />}
      {label}
    </span>
  )
}

function disenoState(o: SeguimientoRow): StageState {
  if (o.no_requiere_diseno) return "na"
  if (o.cumplimiento_diseno) return "hecho"
  if (o.fecha_diseno) return "programado"
  return "pendiente"
}

function corteState(o: SeguimientoRow): StageState {
  if (o.no_requiere_corte) return "na"
  if (o.cumplimiento_corte === "Si") return "hecho"
  if (o.fecha_corte) return "programado"
  return "pendiente"
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

export function AnalyticsDashboard({
  configMissing,
  initialFilter = null,
}: {
  configMissing: boolean
  initialFilter?: ModuleFilter | null
}) {
  const [orders, setOrders] = useState<SeguimientoRow[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [selectedClientes, setSelectedClientes] = useState<string[]>([])
  const [fechaPedido, setFechaPedido] = useState<Date | undefined>()
  const [fechaCancel, setFechaCancel] = useState<Date | undefined>()
  const [view, setView] = useState<"cards" | "list">("cards")

  /** Filtro heredado del inicio (tarjetas de "Atención hoy"). */
  const [incomingFilter, setIncomingFilter] = useState<ModuleFilter | null>(initialFilter)
  useEffect(() => { setIncomingFilter(initialFilter) }, [initialFilter])

  const [historyOrder, setHistoryOrder] = useState<EnrichedOrder | null>(null)
  const [fotoOrder, setFotoOrder] = useState<EnrichedOrder | null>(null)
  const [fotoEtapa, setFotoEtapa] = useState<string>("S1")

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
          .from("vw_seguimiento_integrado")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("fecha_cancelacion", { ascending: true, nullsFirst: false })
        if (cancelled) return
        if (ordersRes.error) throw ordersRes.error
        setOrders((ordersRes.data || []) as SeguimientoRow[])
      } catch (err) {
        if (!cancelled) {
          console.log("Analytics load error:", err)
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
      // La vista ya calcula riesgo_entrega con la regla por fase; si viene
      // vacío (orden sin fase reconocida) se cae al cálculo por días.
      const risk = o.riesgo_entrega
        ? riskFromServer(o.riesgo_entrega)
        : computeRisk(o.fecha_cancelacion, progress).risk
      return {
        ...o,
        __progress: progress,
        __completedPhases: count,
        __risk: risk,
        __daysToDeadline: o.dias_restantes ?? daysUntil(o.fecha_cancelacion),
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
      // Filtro heredado del inicio. Excluye S7 (ya terminadas) para que el
      // resultado coincida con el número que muestra la tarjeta del inicio:
      // una orden entregada no es un vencimiento accionable.
      if (incomingFilter === "vencidos") {
        if (o.__risk !== "vencido" || o.fase_actual === "S7") return false
      }
      if (incomingFilter === "por-vencer") {
        if (o.__risk !== "riesgo" || o.fase_actual === "S7") return false
      }
      if (incomingFilter === "diseno-atrasado" && !etapaAtrasada(o, "diseno")) return false
      if (incomingFilter === "corte-atrasado" && !etapaAtrasada(o, "corte")) return false
      return true
    })
  }, [enriched, search, selectedClientes, fechaPedido, fechaCancel, incomingFilter])

  const summary = useMemo(() => {
    const total = filtered.length
    const counts = { entregado: 0, vencido: 0, riesgo: 0, "a-tiempo": 0, "sin-fecha": 0 } as Record<Risk, number>
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
    setIncomingFilter(null)
  }

  /** Refleja la facturación sin recargar toda la vista. */
  const handleFacturado = (id: number | string, fecha: string | null) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, fecha_facturacion: fecha } : o)))
  }

  /** Exporta las órdenes filtradas (con el pipeline completo) a Excel. */
  const exportToExcel = () => {
    const RISK_LABEL: Record<Risk, string> = {
      entregado: "Entregado",
      vencido: "Vencido",
      riesgo: "En Riesgo",
      "a-tiempo": "A Tiempo",
      "sin-fecha": "Sin Fecha",
    }
    const rows = filtered.map((o) => ({
      Folio: o.folio,
      Modelo: o.modelo ?? "",
      Compradora: o.cliente ?? "",
      Familia: o.familia ?? "",
      Piezas: o.piezas ?? "",
      "Fecha Entrega": o.fecha_cancelacion ?? "",
      Riesgo: RISK_LABEL[o.__risk],
      "Días Restantes": o.__daysToDeadline ?? "",
      "Diseño Fecha": o.fecha_diseno ?? "",
      "Diseñadora": o.nombre_disenador ?? "",
      "Diseño Cumplido": o.no_requiere_diseno ? "N/A" : o.cumplimiento_diseno ? "Sí" : "No",
      "Corte Fecha": o.fecha_corte ?? "",
      Cortador: o.nombre_cortador ?? "",
      "Corte Cumplido": o.no_requiere_corte ? "N/A" : o.cumplimiento_corte === "Si" ? "Sí" : "No",
      Fase: o.fase_actual,
      "Avance %": o.__progress,
      S1: o.fecha_s1 ?? "", S2: o.fecha_s2 ?? "", S3: o.fecha_s3 ?? "",
      S4: o.fecha_s4 ?? "", S5: o.fecha_s5 ?? "", S6: o.fecha_s6 ?? "", S7: o.fecha_s7 ?? "",
      Maquilero: o.maquilero_nombre ?? "",
      Calidad: o.calidad ?? "",
      Facturado: o.fecha_facturacion ?? "",
      "Plazo Diseño": PUNTUALIDAD_LABEL[evaluarEtapa(o, "diseno").estado],
      "Plazo Corte": PUNTUALIDAD_LABEL[evaluarEtapa(o, "corte").estado],
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Seguimiento")
    XLSX.writeFile(wb, `seguimiento_ordenes_${format(new Date(), "yyyy-MM-dd")}.xlsx`)
    toast.success(`${rows.length} órdenes exportadas`)
  }

  const hasFilters =
    search.length > 0 ||
    selectedClientes.length > 0 ||
    fechaPedido !== undefined ||
    fechaCancel !== undefined ||
    incomingFilter !== null

  return (
    <div className="space-y-6">
      {/* Alerta de pedidos vencidos o próximos a vencer */}
      <DeadlineAlertBanner
        items={filtered.map((o) => ({
          folio: o.folio,
          fecha_cancelacion: o.fecha_cancelacion,
          risk: o.__risk,
          detalle: o.modelo,
        }))}
      />

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

          <Button
            variant="outline"
            size="sm"
            onClick={exportToExcel}
            disabled={filtered.length === 0}
            className="h-9 gap-1.5 bg-white"
            title="Exportar las órdenes filtradas a Excel"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>

          <RiesgoInfoDialog />
        </div>

        {/* Filtro heredado del inicio */}
        {incomingFilter && (
          <div className="mt-3">
            <IncomingFilterChip filter={incomingFilter} onClear={() => setIncomingFilter(null)} />
          </div>
        )}
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
            <OrderCard
              key={String(o.id)}
              order={o}
              onHistory={() => setHistoryOrder(o)}
              onFotos={() => { setFotoOrder(o); setFotoEtapa("S1") }}
              onFacturado={handleFacturado}
            />
          ))}
        </div>
      ) : (
        <OrdersListView
          orders={filtered}
          onHistory={(o) => setHistoryOrder(o)}
          onFotos={(o) => { setFotoOrder(o); setFotoEtapa("S1") }}
          onFacturado={handleFacturado}
        />
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

      {/* ── Dialog Fotos ── */}
      <Dialog open={!!fotoOrder} onOpenChange={(o) => !o && setFotoOrder(null)}>
        <DialogContent className="sm:max-w-lg overflow-hidden p-0">
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-violet-700 to-violet-600 px-6 py-4">
            <Camera className="size-4 text-violet-100" />
            <span className="text-sm font-semibold text-white">Evidencias Fotográficas</span>
            <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white/90">
              {fotoOrder?.folio}
            </span>
          </div>
          <div className="px-6 pt-4">
            <Select value={fotoEtapa} onValueChange={setFotoEtapa}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["S1", "S2", "S3", "S4", "S5", "S6", "S7"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="px-6 py-5">
            {fotoOrder && (
              <EvidenciaFotos folio={fotoOrder.folio} etapa={fotoEtapa} readOnly />
            )}
          </div>
        </DialogContent>
      </Dialog>
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

function OrderCard({
  order,
  onHistory,
  onFotos,
  onFacturado,
}: {
  order: EnrichedOrder
  onHistory: () => void
  onFotos: () => void
  onFacturado: (id: number | string, fecha: string | null) => void
}) {
  return (
    <Card className="group relative overflow-hidden border-border/60 bg-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/10">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Folio
            </p>
            <FolioLink folio={order.folio} className="truncate text-base" />
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

        {/* Flujo Diseño → Corte → Maquila */}
        <div className="flex items-center gap-1 text-[11px]">
          <StagePill label="Diseño" state={disenoState(order)} />
          <span className="text-muted-foreground/40">›</span>
          <StagePill label="Corte" state={corteState(order)} />
          <span className="text-muted-foreground/40">›</span>
          <StagePill
            label="Maquila"
            state={
              order.fecha_s7 ? "hecho" : order.fecha_s1 ? "programado" : "pendiente"
            }
          />
        </div>

        {/* Cumplimiento de plazos previos a S1 */}
        {(etapaAtrasada(order, "diseno") || etapaAtrasada(order, "corte")) && (
          <div className="flex flex-wrap items-center gap-1">
            <LeadTimeBadge row={order} etapa="diseno" />
            <LeadTimeBadge row={order} etapa="corte" />
          </div>
        )}

        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Avance</span>
            <span className="font-bold tabular-nums text-foreground">{order.__progress}%</span>
          </div>
          <ProgressBar value={order.__progress} />
          <FacturarButton
            folio={order.folio}
            ordenId={order.id}
            faseActual={order.fase_actual}
            fechaFacturacion={order.fecha_facturacion}
            onDone={(fecha) => onFacturado(order.id, fecha)}
            size="xs"
            className="w-full justify-center"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            {order.fecha_facturacion ? (
              <EntregadoBadge fechaFacturacion={order.fecha_facturacion} />
            ) : (
              <PhaseBadge phase={order.fase_actual} />
            )}
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={onFotos}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-slate-50"
              >
                <Camera className="size-3.5" />
              </Button>
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
        </div>
      </CardContent>
    </Card>
  )
}

function OrdersListView({
  orders,
  onHistory,
  onFotos,
  onFacturado,
}: {
  orders: EnrichedOrder[]
  onHistory: (o: EnrichedOrder) => void
  onFotos: (o: EnrichedOrder) => void
  onFacturado: (id: number | string, fecha: string | null) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted-foreground">
            {/* Fila de grupos: marca las tres etapas del flujo */}
            <tr className="border-b border-border/40">
              <th colSpan={5} className="px-4 pt-3 pb-1 text-left" />
              <th
                colSpan={2}
                className="border-l border-border/60 px-4 pt-3 pb-1 text-left text-[10px] font-bold text-sky-700"
              >
                1 · Diseño
              </th>
              <th
                colSpan={2}
                className="border-l border-border/60 px-4 pt-3 pb-1 text-left text-[10px] font-bold text-amber-700"
              >
                2 · Corte
              </th>
              <th
                colSpan={2}
                className="border-l border-border/60 px-4 pt-3 pb-1 text-left text-[10px] font-bold text-violet-700"
              >
                3 · Maquila
              </th>
              <th className="px-4 pt-3 pb-1" />
            </tr>
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Folio</th>
              <th className="px-4 py-3 text-left font-semibold">Modelo</th>
              <th className="px-4 py-3 text-left font-semibold">Compradora</th>
              <th className="px-4 py-3 text-left font-semibold">Entrega</th>
              <th className="px-4 py-3 text-left font-semibold">Riesgo</th>
              <th className="border-l border-border/60 px-4 py-3 text-left font-semibold">Fecha</th>
              <th className="px-4 py-3 text-left font-semibold">Diseñador</th>
              <th className="border-l border-border/60 px-4 py-3 text-left font-semibold">Fecha</th>
              <th className="px-4 py-3 text-left font-semibold">Cortador</th>
              <th className="border-l border-border/60 px-4 py-3 text-left font-semibold">Fase</th>
              <th className="px-4 py-3 text-left font-semibold">Avance S1 → S7</th>
              <th className="px-4 py-3 text-right font-semibold">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {orders.map((o) => {
              const dis = disenoState(o)
              const cor = corteState(o)
              return (
                <tr key={String(o.id)} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-4 py-3"><FolioLink folio={o.folio} /></td>
                  <td className="px-4 py-3 text-foreground">{o.modelo || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.cliente || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{formatDeliveryDate(o.fecha_cancelacion)}</td>
                  <td className="px-4 py-3">
                    <RiskBadge risk={o.__risk} days={o.__daysToDeadline} />
                  </td>

                  {/* 1 · Diseño */}
                  <td className="border-l border-border/60 px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StageCell state={dis} fecha={o.fecha_diseno} />
                      <LeadTimeBadge row={o} etapa="diseno" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {dis === "na" ? "—" : o.nombre_disenador || "Sin asignar"}
                  </td>

                  {/* 2 · Corte */}
                  <td className="border-l border-border/60 px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StageCell state={cor} fecha={o.fecha_corte} />
                      <LeadTimeBadge row={o} etapa="corte" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {cor === "na" ? "—" : o.nombre_cortador || "Sin asignar"}
                  </td>

                  {/* 3 · Maquila */}
                  <td className="border-l border-border/60 px-4 py-3">
                    {o.fecha_facturacion ? (
                      <EntregadoBadge fechaFacturacion={o.fecha_facturacion} />
                    ) : (
                      <PhaseBadge phase={o.fase_actual} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PhaseBubbleTimeline row={o} />
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <FacturarButton
                        folio={o.folio}
                        ordenId={o.id}
                        faseActual={o.fase_actual}
                        fechaFacturacion={o.fecha_facturacion}
                        onDone={(fecha) => onFacturado(o.id, fecha)}
                        size="xs"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onFotos(o)}
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-slate-50"
                      >
                        <Camera className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onHistory(o)}
                        className="h-7 gap-1.5 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
                      >
                        <History className="size-3.5" />
                        Historial
                      </Button>
                    </div>
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

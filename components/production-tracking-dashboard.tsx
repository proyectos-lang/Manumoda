"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  AlertTriangle,
  CalendarIcon,
  Camera,
  ClipboardPen,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import { computeProgress, computeRisk, daysUntil, relativeDays, type Risk } from "@/lib/risk"
import type { ModuleFilter } from "@/lib/module-filter"
import { cn } from "@/lib/utils"

import { DeadlineAlertBanner } from "@/components/deadline-alert-banner"
import { EntregadoBadge, FacturarButton } from "@/components/facturar-button"
import { FolioLink } from "@/components/folio-detail-drawer"
import { IncomingFilterChip } from "@/components/incoming-filter-chip"
import { KpiCard } from "@/components/kpi-card"
import { RiesgoInfoDialog } from "@/components/riesgo-info-dialog"
import { RiskBadge } from "@/components/risk-badge"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { EvidenciaFotos } from "@/components/evidencia-fotos"

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASES = ["Programada", "S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const
type Phase = (typeof PHASES)[number]

const PHASE_BADGE: Record<string, string> = {
  Programada: "bg-slate-100 text-slate-700 border-slate-200",
  S1: "bg-blue-100 text-blue-700 border-blue-200",
  S2: "bg-cyan-100 text-cyan-700 border-cyan-200",
  S3: "bg-teal-100 text-teal-700 border-teal-200",
  S4: "bg-amber-100 text-amber-700 border-amber-200",
  S5: "bg-orange-100 text-orange-700 border-orange-200",
  S6: "bg-rose-100 text-rose-700 border-rose-200",
  S7: "bg-emerald-100 text-emerald-700 border-emerald-200",
}

const INSUMOS_BADGE: Record<string, string> = {
  COMPLETO: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PARCIAL: "bg-amber-100 text-amber-700 border-amber-200",
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FormState = {
  fecha_s1: Date | null
  fecha_s2: Date | null
  fecha_s3: Date | null
  fecha_s4: Date | null
  fecha_s5: Date | null
  fecha_s6: Date | null
  fecha_s7: Date | null
  calidad: string
  tipo_revision: string
  habilitaciones_insumos: string
  comentarios_generales: string
  fecha_limite_confirmacion: Date | null
  fecha_contra_muestra: Date | null
}

const EMPTY_FORM: FormState = {
  fecha_s1: null,
  fecha_s2: null,
  fecha_s3: null,
  fecha_s4: null,
  fecha_s5: null,
  fecha_s6: null,
  fecha_s7: null,
  calidad: "",
  tipo_revision: "",
  habilitaciones_insumos: "",
  comentarios_generales: "",
  fecha_limite_confirmacion: null,
  fecha_contra_muestra: null,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function toISODate(d: Date | null): string | null {
  if (!d) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtShort(d: string | null | undefined): string {
  const p = parseDate(d)
  return p ? format(p, "dd MMM", { locale: es }) : "—"
}

function fmtDateTime(d: string | null | undefined): string {
  const p = parseDate(d)
  if (!p) return "—"
  return format(p, "dd MMM yy, HH:mm", { locale: es })
}

function detectPhase(form: FormState): Phase {
  const pairs: [keyof FormState, Phase][] = [
    ["fecha_s7", "S7"],
    ["fecha_s6", "S6"],
    ["fecha_s5", "S5"],
    ["fecha_s4", "S4"],
    ["fecha_s3", "S3"],
    ["fecha_s2", "S2"],
    ["fecha_s1", "S1"],
  ]
  for (const [key, phase] of pairs) {
    if (form[key]) return phase
  }
  return "Programada"
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProductionTrackingDashboard({
  configMissing,
  refreshKey,
  initialFilter = null,
}: {
  configMissing: boolean
  refreshKey?: number
  /** Filtro heredado del inicio (tarjetas de "Atención hoy"). */
  initialFilter?: ModuleFilter | null
}) {
  const [orders, setOrders] = useState<OrdenProduccion[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<OrdenProduccion | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [search, setSearch] = useState("")

  const [incomingFilter, setIncomingFilter] = useState<ModuleFilter | null>(initialFilter)
  useEffect(() => { setIncomingFilter(initialFilter) }, [initialFilter])

  const fetchOrders = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase
      .from("ordenes_produccion")
      .select(
        "id, idempresa, folio, num_pedido, modelo, familia, cliente, maquilero, piezas, fase_actual, fecha_cancelacion, fecha_s1, fecha_s2, fecha_s3, fecha_s4, fecha_s5, fecha_s6, fecha_s7, calidad, tipo_revision, habilitaciones_insumos, comentarios_generales, fecha_ultima_revision, fecha_limite_confirmacion, fecha_contra_muestra, fecha_facturacion",
      )
      .eq("idempresa", IDEMPRESA)
      .neq("fase_actual", "Por Programar")
      .order("fecha_cancelacion", { ascending: true, nullsFirst: false })

    setLoading(false)

    if (error) {
      toast.error("No se pudieron cargar las órdenes", { description: error.message })
      return
    }
    setOrders((data as OrdenProduccion[]) ?? [])
  }, [configMissing])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders, refreshKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = orders
    if (q) {
      list = list.filter(
        (o) =>
          o.folio.toLowerCase().includes(q) ||
          (o.cliente ?? "").toLowerCase().includes(q) ||
          (o.modelo ?? "").toLowerCase().includes(q),
      )
    }
    // Filtro heredado del inicio: en producción y sin revisión hace +7 días
    // (o nunca revisada). Misma regla que el contador del inicio.
    if (incomingFilter === "sin-revision") {
      const EN_PRODUCCION = new Set(["S1", "S2", "S3", "S4", "S5", "S6"])
      list = list.filter((o) => {
        if (!EN_PRODUCCION.has(o.fase_actual)) return false
        const dias = daysUntil(o.fecha_ultima_revision)
        return dias === null || dias <= -7
      })
    }
    return list
  }, [orders, search, incomingFilter])

  /** Riesgo de entrega por orden, calculado una sola vez. */
  const riskByOrder = useMemo(() => {
    const map = new Map<string, { risk: Risk; days: number | null }>()
    for (const o of filtered) {
      const { progress } = computeProgress(o)
      // fase_actual activa la regla de ritmo por fase (paridad con el
      // "A Destiempo" de las vistas SQL); fecha_facturacion cierra el ciclo
      map.set(
        o.folio,
        computeRisk(o.fecha_cancelacion, progress, o.fase_actual, o.fecha_facturacion),
      )
    }
    return map
  }, [filtered])

  const riskSummary = useMemo(() => {
    let vencidos = 0
    let enRiesgo = 0
    let sinFecha = 0
    for (const { risk } of riskByOrder.values()) {
      if (risk === "vencido") vencidos++
      else if (risk === "riesgo") enRiesgo++
      else if (risk === "sin-fecha") sinFecha++
    }
    return { vencidos, enRiesgo, sinFecha }
  }, [riskByOrder])

  const grouped = useMemo(() => {
    const map: Record<Phase, OrdenProduccion[]> = {
      Programada: [],
      S1: [],
      S2: [],
      S3: [],
      S4: [],
      S5: [],
      S6: [],
      S7: [],
    }
    for (const o of filtered) {
      const phase = (o.fase_actual as Phase) ?? "Programada"
      if (map[phase]) map[phase].push(o)
      else map.Programada.push(o)
    }
    return map
  }, [filtered])

  const handleOpen = (o: OrdenProduccion) => {
    setSelected(o)
    setSheetOpen(true)
  }

  /** Refleja la facturación en la tabla sin recargar todo. */
  const handleFacturado = (id: number | string | undefined, fecha: string | null) => {
    if (id == null) return
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, fecha_facturacion: fecha } : o)))
  }

  if (configMissing) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
        <AlertDescription>
          Configura <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> para visualizar
          el tablero.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filtro heredado del inicio */}
      {incomingFilter && (
        <IncomingFilterChip filter={incomingFilter} onClear={() => setIncomingFilter(null)} />
      )}

      {/* Alerta de pedidos vencidos o próximos a vencer */}
      <DeadlineAlertBanner
        items={filtered.map((o) => ({
          folio: o.folio,
          fecha_cancelacion: o.fecha_cancelacion,
          risk: riskByOrder.get(o.folio)?.risk,
          detalle: o.modelo,
        }))}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Órdenes activas"
          value={filtered.length}
          icon={<ClipboardPen className="size-3.5" />}
          iconBg="bg-violet-50 ring-violet-200"
          iconColor="text-violet-600"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Vencidos"
          value={riskSummary.vencidos}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-rose-50 ring-rose-200"
          iconColor="text-rose-600"
          valueColor={riskSummary.vencidos > 0 ? "text-rose-600" : "text-foreground"}
        />
        <KpiCard
          label="Próximos a vencer"
          value={riskSummary.enRiesgo}
          icon={<Clock className="size-3.5" />}
          iconBg="bg-amber-50 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={riskSummary.enRiesgo > 0 ? "text-amber-600" : "text-foreground"}
          hint="Entrega en 7 días o menos"
        />
        <KpiCard
          label="Sin fecha de entrega"
          value={riskSummary.sinFecha}
          icon={<CalendarIcon className="size-3.5" />}
          iconBg="bg-slate-50 ring-slate-200"
          iconColor="text-slate-500"
          valueColor="text-foreground"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por folio, cliente o modelo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filtered.length}{" "}
            {filtered.length === 1 ? "orden" : "órdenes"}
            {search && orders.length !== filtered.length && (
              <span className="ml-1 text-muted-foreground/60">de {orders.length}</span>
            )}
          </span>
          <RiesgoInfoDialog />
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOrders}
            disabled={loading}
            className="gap-1.5 bg-transparent"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Actualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="tabla" className="w-full">
        <TabsList>
          <TabsTrigger value="tabla">Vista Tabla</TabsTrigger>
          <TabsTrigger value="kanban">Vista Kanban</TabsTrigger>
        </TabsList>

        <TabsContent value="tabla" className="mt-4">
          <TableView
            orders={filtered}
            loading={loading}
            onUpdate={handleOpen}
            riskByOrder={riskByOrder}
            onFacturado={handleFacturado}
          />
        </TabsContent>

        <TabsContent value="kanban" className="mt-4">
          <KanbanView grouped={grouped} loading={loading} onCardClick={handleOpen} />
        </TabsContent>
      </Tabs>

      <UpdateProgressSheet
        order={selected}
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o)
          if (!o) setSelected(null)
        }}
        onSaved={fetchOrders}
      />
    </div>
  )
}

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({
  orders,
  loading,
  onUpdate,
  riskByOrder,
  onFacturado,
}: {
  orders: OrdenProduccion[]
  loading: boolean
  onUpdate: (o: OrdenProduccion) => void
  riskByOrder: Map<string, { risk: Risk; days: number | null }>
  onFacturado: (id: number | string | undefined, fecha: string | null) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="hidden font-semibold xl:table-cell">#ID</TableHead>
            <TableHead className="font-semibold">Folio</TableHead>
            <TableHead className="font-semibold">F. Entrega</TableHead>
            <TableHead className="font-semibold">Riesgo</TableHead>
            <TableHead className="hidden font-semibold xl:table-cell">Contra Muestra</TableHead>
            <TableHead className="font-semibold">Maquilero</TableHead>
            <TableHead className="hidden font-semibold lg:table-cell">Cliente</TableHead>
            <TableHead className="font-semibold">Modelo</TableHead>
            <TableHead className="text-right font-semibold">Piezas</TableHead>
            <TableHead className="font-semibold">Fase Actual</TableHead>
            <TableHead className="font-semibold">Última Revisión</TableHead>
            <TableHead className="hidden font-semibold lg:table-cell">Insumos</TableHead>
            <TableHead className="text-center font-semibold">Calidad</TableHead>
            <TableHead className="text-right font-semibold">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && orders.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 14 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={14}
                className="h-28 text-center text-sm text-muted-foreground"
              >
                No hay órdenes en seguimiento.
              </TableCell>
            </TableRow>
          ) : (
            orders.map((o) => (
              <TableRow key={String(o.id)} className="group text-sm">
                <TableCell className="hidden font-mono text-xs text-muted-foreground tabular-nums xl:table-cell">
                  {o.id ?? "—"}
                </TableCell>
                <TableCell>
                  <FolioLink folio={o.folio} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmtShort(o.fecha_cancelacion)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {(() => {
                    const r = riskByOrder.get(o.folio)
                    return r ? <RiskBadge risk={r.risk} days={r.days} /> : null
                  })()}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                  {fmtShort(o.fecha_contra_muestra)}
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {o.maquilero ?? "—"}
                </TableCell>
                <TableCell className="hidden max-w-[180px] truncate text-muted-foreground lg:table-cell">
                  {o.cliente ?? "—"}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-muted-foreground">
                  {o.modelo ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.piezas ?? 0}</TableCell>
                <TableCell>
                  {o.fecha_facturacion ? (
                    <EntregadoBadge fechaFacturacion={o.fecha_facturacion} />
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn("font-medium", PHASE_BADGE[o.fase_actual] ?? "")}
                    >
                      {o.fase_actual}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmtDateTime(o.fecha_ultima_revision)}
                  {o.fecha_ultima_revision && (
                    <span
                      className={cn(
                        "ml-1.5 font-medium",
                        (daysUntil(o.fecha_ultima_revision) ?? 0) <= -7
                          ? "text-amber-600"
                          : "text-muted-foreground/60",
                      )}
                    >
                      · {relativeDays(o.fecha_ultima_revision)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {o.habilitaciones_insumos ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs font-medium",
                        INSUMOS_BADGE[o.habilitaciones_insumos] ?? "",
                      )}
                    >
                      {o.habilitaciones_insumos}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {o.calidad != null ? (
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                        o.calidad >= 8
                          ? "bg-emerald-100 text-emerald-700"
                          : o.calidad >= 5
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700",
                      )}
                    >
                      {o.calidad}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <FacturarButton
                      folio={o.folio}
                      ordenId={o.id}
                      faseActual={o.fase_actual}
                      fechaFacturacion={o.fecha_facturacion}
                      onDone={(fecha) => onFacturado(o.id, fecha)}
                    />
                    <Button
                      size="sm"
                      onClick={() => onUpdate(o)}
                      className="gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
                    >
                      <ClipboardPen className="size-3.5" />
                      Registrar Avance
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Kanban View ──────────────────────────────────────────────────────────────

function KanbanView({
  grouped,
  loading,
  onCardClick,
}: {
  grouped: Record<Phase, OrdenProduccion[]>
  loading: boolean
  onCardClick: (o: OrdenProduccion) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
      {PHASES.map((phase) => {
        const items = grouped[phase] ?? []
        return (
          <div
            key={phase}
            // Altura acotada: la columna no crece con el número de órdenes,
            // el scroll ocurre dentro de cada lista.
            className="flex h-[min(70vh,640px)] min-h-[360px] flex-col rounded-xl border border-border bg-white/70"
          >
            <div className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-border bg-white/80 px-3 py-2 backdrop-blur-sm">
              <span className="text-xs font-semibold text-foreground">{phase}</span>
              <Badge
                variant="outline"
                className={cn("h-5 px-1.5 text-[10px] font-semibold", PHASE_BADGE[phase])}
              >
                {items.length}
              </Badge>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {loading && items.length === 0 ? (
                <>
                  <Skeleton className="h-[72px] w-full rounded-lg" />
                  <Skeleton className="h-[72px] w-full rounded-lg" />
                </>
              ) : items.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/50">
                  Sin órdenes
                </div>
              ) : (
                items.map((o) => (
                  <Card
                    key={String(o.id)}
                    role="button"
                    tabIndex={0}
                    onClick={() => onCardClick(o)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onCardClick(o)
                      }
                    }}
                    className="cursor-pointer border-border bg-white/80 shadow-none transition-all hover:border-violet-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {o.folio}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {o.piezas ?? 0} pz
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs font-medium text-foreground">
                        {o.modelo ?? "—"}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {o.cliente ?? "—"}
                      </p>
                      {o.maquilero && (
                        <p className="mt-0.5 truncate text-[10px] font-medium text-violet-600">
                          {o.maquilero}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Update Progress Sheet ────────────────────────────────────────────────────

function UpdateProgressSheet({
  order,
  open,
  onOpenChange,
  onSaved,
}: {
  order: OrdenProduccion | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [fotoEtapa, setFotoEtapa] = useState<string | null>(null)
  const [fotoCounts, setFotoCounts] = useState<Record<string, number>>({})

  // Clear foto dialog when sheet closes
  useEffect(() => {
    if (!open) setFotoEtapa(null)
  }, [open])

  // Fetch foto counts per stage whenever this sheet opens for a new order
  useEffect(() => {
    if (!open || !order?.folio) {
      setFotoCounts({})
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    supabase
      .from("ordenes_fotos")
      .select("etapa")
      .eq("idempresa", IDEMPRESA)
      .eq("folio", order.folio)
      .then(({ data, error }) => {
        if (error) {
          // No bloquea el sheet: solo faltarán los contadores de fotos
          toast.warning("No se pudo cargar el conteo de fotos", { description: error.message })
          return
        }
        if (!data) return
        const counts: Record<string, number> = {}
        ;(data as { etapa: string }[]).forEach((r) => {
          counts[r.etapa] = (counts[r.etapa] ?? 0) + 1
        })
        setFotoCounts(counts)
      })
  }, [open, order?.folio])

  useEffect(() => {
    if (!order) {
      setForm(EMPTY_FORM)
      return
    }
    setForm({
      fecha_s1: parseDate(order.fecha_s1),
      fecha_s2: parseDate(order.fecha_s2),
      fecha_s3: parseDate(order.fecha_s3),
      fecha_s4: parseDate(order.fecha_s4),
      fecha_s5: parseDate(order.fecha_s5),
      fecha_s6: parseDate(order.fecha_s6),
      fecha_s7: parseDate(order.fecha_s7),
      calidad: order.calidad != null ? String(order.calidad) : "",
      tipo_revision: order.tipo_revision ?? "",
      habilitaciones_insumos: order.habilitaciones_insumos ?? "",
      comentarios_generales: order.comentarios_generales ?? "",
      fecha_limite_confirmacion: parseDate(order.fecha_limite_confirmacion),
      fecha_contra_muestra: parseDate(order.fecha_contra_muestra),
    })
  }, [order])

  const detectedPhase = useMemo(() => detectPhase(form), [form])

  // ¿La fase detectada retrocede respecto a la fase actual de la orden?
  // (pasa cuando se limpia una fecha intermedia)
  const PHASE_ORDER = ["Programada", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]
  const phaseRegressed = useMemo(() => {
    const current = order?.fase_actual
    if (!current) return false
    const currentIdx = PHASE_ORDER.indexOf(current)
    const detectedIdx = PHASE_ORDER.indexOf(detectedPhase)
    return currentIdx >= 0 && detectedIdx >= 0 && detectedIdx < currentIdx
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.fase_actual, detectedPhase])

  const STAGE_KEYS = [
    "fecha_s1",
    "fecha_s2",
    "fecha_s3",
    "fecha_s4",
    "fecha_s5",
    "fecha_s6",
    "fecha_s7",
  ] as const

  /** ¿El formulario difiere del snapshot cargado de la orden? */
  const isDirty = useMemo(() => {
    if (!order) return false
    const norm = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null)
    for (const k of STAGE_KEYS) {
      if (toISODate(form[k]) !== norm(order[k])) return true
    }
    return (
      (form.calidad.trim() === "" ? null : Number(form.calidad)) !== (order.calidad ?? null) ||
      (form.tipo_revision || null) !== (order.tipo_revision ?? null) ||
      (form.habilitaciones_insumos || null) !== (order.habilitaciones_insumos ?? null) ||
      (form.comentarios_generales || null) !== (order.comentarios_generales ?? null) ||
      toISODate(form.fecha_limite_confirmacion) !== norm(order.fecha_limite_confirmacion) ||
      toISODate(form.fecha_contra_muestra) !== norm(order.fecha_contra_muestra)
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, order])

  const handleSubmit = async () => {
    if (!order?.id) return

    // Sin cambios reales: cerrar sin escribir para no pisar
    // fecha_ultima_revision con una revisión que no ocurrió
    if (!isDirty) {
      toast.info("Sin cambios que guardar.")
      onOpenChange(false)
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      toast.error("Supabase no configurado")
      return
    }

    let calidadNum: number | null = null
    if (form.calidad.trim() !== "") {
      const n = Number(form.calidad)
      if (Number.isNaN(n) || n < 1 || n > 10) {
        toast.error("Calidad debe ser un número entre 1 y 10")
        return
      }
      calidadNum = n
    }

    setSaving(true)
    const payload = {
      fecha_s1: toISODate(form.fecha_s1),
      fecha_s2: toISODate(form.fecha_s2),
      fecha_s3: toISODate(form.fecha_s3),
      fecha_s4: toISODate(form.fecha_s4),
      fecha_s5: toISODate(form.fecha_s5),
      fecha_s6: toISODate(form.fecha_s6),
      fecha_s7: toISODate(form.fecha_s7),
      calidad: calidadNum,
      tipo_revision: form.tipo_revision || null,
      habilitaciones_insumos: form.habilitaciones_insumos || null,
      comentarios_generales: form.comentarios_generales || null,
      fecha_ultima_revision: new Date().toISOString(),
      fase_actual: detectedPhase,
      fecha_limite_confirmacion: toISODate(form.fecha_limite_confirmacion),
      fecha_contra_muestra: toISODate(form.fecha_contra_muestra),
    }

    const { error } = await supabase
      .from("ordenes_produccion")
      .update(payload)
      .eq("id", order.id)
      .eq("idempresa", IDEMPRESA)

    setSaving(false)

    if (error) {
      toast.error("No se pudo actualizar la orden", { description: error.message })
      return
    }

    toast.success("Avance registrado", {
      description: `Folio ${order.folio} · Fase detectada: ${detectedPhase}`,
    })
    onOpenChange(false)
    onSaved()
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {/* Header */}
        <SheetHeader className="border-b border-border bg-violet-50/80 px-6 py-4">
          <div className="flex items-center gap-2">
            <ClipboardPen className="size-4 text-violet-600" />
            <SheetTitle className="text-base text-foreground">Registrar Avance</SheetTitle>
          </div>
          <SheetDescription asChild>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">Folio: </span>
                <span className="font-mono font-semibold text-foreground">
                  {order?.folio ?? "—"}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Cliente: </span>
                <span className="font-medium text-foreground">{order?.cliente ?? "—"}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Modelo: </span>
                <span className="font-medium text-foreground">{order?.modelo ?? "—"}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Piezas: </span>
                <span className="font-medium text-foreground">{order?.piezas ?? 0}</span>
              </span>
            </div>
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {order ? (
            <div className="space-y-6">

              {/* Auto-detected phase indicator */}
              <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Fase que se guardará:</span>
                <Badge
                  variant="outline"
                  className={cn("font-semibold", PHASE_BADGE[detectedPhase] ?? "")}
                >
                  {detectedPhase}
                </Badge>
                <span className="ml-auto text-[11px] text-muted-foreground/70">
                  Calculada automáticamente
                </span>
              </div>

              {/* Aviso de regresión de fase */}
              {phaseRegressed && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-800">
                    <strong>La fase retrocederá de {order?.fase_actual} a {detectedPhase}</strong>{" "}
                    porque se limpió una fecha de etapa. Verifica que sea intencional antes de guardar.
                  </p>
                </div>
              )}

              {/* Section A: Fechas de Etapas */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                    A
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">Fechas de Etapas</h3>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {STAGE_KEYS.map((key, idx) => {
                    const label = `${idx + 1} - S${idx + 1}`
                    const etapaKey = `S${idx + 1}`
                    const value = form[key] as Date | null
                    const count = fotoCounts[etapaKey] ?? 0
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {label}
                        </Label>
                        <div className="flex gap-1.5">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "flex-1 justify-start text-left text-xs font-normal h-9",
                                !value && "text-muted-foreground",
                              )}
                            >
                              <CalendarIcon className="mr-2 size-3.5 shrink-0" />
                              <span className="truncate">
                                {value ? format(value, "dd MMM yyyy", { locale: es }) : "Sin fecha"}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={value ?? undefined}
                              onSelect={(d) => setForm((f) => ({ ...f, [key]: d ?? null }))}
                              locale={es}
                              initialFocus
                            />
                            {value && (
                              <div className="flex justify-end border-t border-border p-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs text-muted-foreground"
                                  onClick={() => setForm((f) => ({ ...f, [key]: null }))}
                                >
                                  Limpiar fecha
                                </Button>
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                        {/* Camera button — same height as datepicker */}
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setFotoEtapa(etapaKey)}
                          title={`Evidencias fotográficas de ${etapaKey}`}
                          className={cn(
                            "relative h-9 w-9 shrink-0 transition-colors",
                            count > 0
                              ? "border-violet-300 text-violet-600 hover:bg-violet-50"
                              : "text-muted-foreground hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50",
                          )}
                        >
                          <Camera className="size-4" />
                          {count > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-0.5 text-[9px] font-bold text-white">
                              {count}
                            </span>
                          )}
                        </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Section B: Control y Revisión */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                    B
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">Control y Revisión</h3>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {/* Calidad */}
                  <div className="space-y-1.5">
                    <Label htmlFor="calidad" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Calidad (1–10)
                    </Label>
                    <Input
                      id="calidad"
                      type="number"
                      min={1}
                      max={10}
                      placeholder="—"
                      value={form.calidad}
                      onChange={(e) => setForm((f) => ({ ...f, calidad: e.target.value }))}
                      className="h-9 text-sm"
                    />
                  </div>

                  {/* Tipo de Revisión */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Tipo de Revisión
                    </Label>
                    <Select
                      value={form.tipo_revision}
                      onValueChange={(v) => setForm((f) => ({ ...f, tipo_revision: v }))}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Seleccionar…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VISITA">Visita</SelectItem>
                        <SelectItem value="LLAMADA">Llamada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Habilitaciones e Insumos */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Habilitaciones e Insumos
                    </Label>
                    <Select
                      value={form.habilitaciones_insumos}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, habilitaciones_insumos: v }))
                      }
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Seleccionar…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COMPLETO">Completo</SelectItem>
                        <SelectItem value="PARCIAL">Parcial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Comentarios */}
                <div className="space-y-1.5">
                  <Label htmlFor="comentarios" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Comentarios Generales
                  </Label>
                  <Textarea
                    id="comentarios"
                    placeholder="Observaciones, notas de seguimiento…"
                    value={form.comentarios_generales}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, comentarios_generales: e.target.value }))
                    }
                    className="min-h-[80px] resize-none text-sm"
                  />
                </div>
              </div>

              {/* Section C: Confirmación */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                    C
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">Confirmación</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Fecha Límite de Confirmación
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left text-xs font-normal h-9",
                            !form.fecha_limite_confirmacion && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 size-3.5 shrink-0" />
                          <span className="truncate">
                            {form.fecha_limite_confirmacion
                              ? format(form.fecha_limite_confirmacion, "dd MMM yyyy", { locale: es })
                              : "Sin fecha"}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.fecha_limite_confirmacion ?? undefined}
                          onSelect={(d) => setForm((f) => ({ ...f, fecha_limite_confirmacion: d ?? null }))}
                          locale={es}
                          initialFocus
                        />
                        {form.fecha_limite_confirmacion && (
                          <div className="flex justify-end border-t border-border p-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground"
                              onClick={() => setForm((f) => ({ ...f, fecha_limite_confirmacion: null }))}
                            >
                              Limpiar fecha
                            </Button>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Fecha Contra Muestra Maquilero
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left text-xs font-normal h-9",
                            !form.fecha_contra_muestra && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 size-3.5 shrink-0" />
                          <span className="truncate">
                            {form.fecha_contra_muestra
                              ? format(form.fecha_contra_muestra, "dd MMM yyyy", { locale: es })
                              : "Sin fecha"}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.fecha_contra_muestra ?? undefined}
                          onSelect={(d) => setForm((f) => ({ ...f, fecha_contra_muestra: d ?? null }))}
                          locale={es}
                          initialFocus
                        />
                        {form.fecha_contra_muestra && (
                          <div className="flex justify-end border-t border-border p-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground"
                              onClick={() => setForm((f) => ({ ...f, fecha_contra_muestra: null }))}
                            >
                              Limpiar fecha
                            </Button>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Sin orden seleccionada.
            </div>
          )}
        </div>

        {/* Footer */}
        <SheetFooter className="border-t border-border bg-white/60 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="mr-auto"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !order}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-700"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Guardando…" : "Guardar Avance"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    {/* ── Foto Viewer Dialog ─────────────────────────────────────── */}
    <Dialog open={!!fotoEtapa} onOpenChange={(o) => !o && setFotoEtapa(null)}>
      <DialogContent className="max-w-lg overflow-hidden p-0 shadow-2xl">
        {/* Dark premium header */}
        <div className="flex items-center gap-2.5 bg-gradient-to-r from-violet-700 to-violet-600 px-6 py-4">
          <Camera className="size-4 text-violet-100" />
          <span className="text-sm font-semibold text-white">
            Evidencias Fotográficas
          </span>
          <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white/90">
            {order?.folio ?? "—"} · {fotoEtapa}
          </span>
        </div>
        {/* Body */}
        <div className="px-6 py-5">
          {order && fotoEtapa && (
            <EvidenciaFotos
              folio={order.folio}
              etapa={fotoEtapa}
              onFotoAdded={() =>
                setFotoCounts((prev) => ({
                  ...prev,
                  [fotoEtapa]: (prev[fotoEtapa] ?? 0) + 1,
                }))
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

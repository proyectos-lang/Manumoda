"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarIcon, ClipboardPen, Loader2, RefreshCw, Search, X } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import { cn } from "@/lib/utils"

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
}: {
  configMissing: boolean
  refreshKey?: number
}) {
  const [orders, setOrders] = useState<OrdenProduccion[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<OrdenProduccion | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [search, setSearch] = useState("")

  const fetchOrders = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase
      .from("ordenes_produccion")
      .select(
        "id, idempresa, folio, num_pedido, modelo, familia, cliente, piezas, fase_actual, fecha_s1, fecha_s2, fecha_s3, fecha_s4, fecha_s5, fecha_s6, fecha_s7, calidad, tipo_revision, habilitaciones_insumos, comentarios_generales, fecha_ultima_revision",
      )
      .eq("idempresa", IDEMPRESA)
      .neq("fase_actual", "Por Programar")
      .order("folio", { ascending: true })

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
    if (!q) return orders
    return orders.filter(
      (o) =>
        o.folio.toLowerCase().includes(q) ||
        (o.cliente ?? "").toLowerCase().includes(q) ||
        (o.modelo ?? "").toLowerCase().includes(q),
    )
  }, [orders, search])

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
          <TableView orders={filtered} loading={loading} onUpdate={handleOpen} />
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
}: {
  orders: OrdenProduccion[]
  loading: boolean
  onUpdate: (o: OrdenProduccion) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="font-semibold">Folio</TableHead>
            <TableHead className="font-semibold">Cliente</TableHead>
            <TableHead className="font-semibold">Modelo</TableHead>
            <TableHead className="text-right font-semibold">Piezas</TableHead>
            <TableHead className="font-semibold">Fase Actual</TableHead>
            <TableHead className="font-semibold">Última Revisión</TableHead>
            <TableHead className="font-semibold">Insumos</TableHead>
            <TableHead className="text-center font-semibold">Calidad</TableHead>
            <TableHead className="text-right font-semibold">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && orders.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 9 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={9}
                className="h-28 text-center text-sm text-muted-foreground"
              >
                No hay órdenes en seguimiento.
              </TableCell>
            </TableRow>
          ) : (
            orders.map((o) => (
              <TableRow key={String(o.id)} className="group text-sm">
                <TableCell className="font-mono font-semibold text-foreground">
                  {o.folio}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-muted-foreground">
                  {o.cliente ?? "—"}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-muted-foreground">
                  {o.modelo ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.piezas ?? 0}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("font-medium", PHASE_BADGE[o.fase_actual] ?? "")}
                  >
                    {o.fase_actual}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmtDateTime(o.fecha_ultima_revision)}
                </TableCell>
                <TableCell>
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
                  <Button
                    size="sm"
                    onClick={() => onUpdate(o)}
                    className="gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
                  >
                    <ClipboardPen className="size-3.5" />
                    Registrar Avance
                  </Button>
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
            className="flex min-h-[360px] flex-col rounded-xl border border-border bg-white/70"
          >
            <div className="flex items-center justify-between rounded-t-xl border-b border-border bg-white/80 px-3 py-2 backdrop-blur-sm">
              <span className="text-xs font-semibold text-foreground">{phase}</span>
              <Badge
                variant="outline"
                className={cn("h-5 px-1.5 text-[10px] font-semibold", PHASE_BADGE[phase])}
              >
                {items.length}
              </Badge>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
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
    })
  }, [order])

  const detectedPhase = useMemo(() => detectPhase(form), [form])

  const STAGE_KEYS = [
    "fecha_s1",
    "fecha_s2",
    "fecha_s3",
    "fecha_s4",
    "fecha_s5",
    "fecha_s6",
    "fecha_s7",
  ] as const

  const handleSubmit = async () => {
    if (!order?.id) return
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
                    const value = form[key] as Date | null
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {label}
                        </Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left text-xs font-normal h-9",
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
  )
}

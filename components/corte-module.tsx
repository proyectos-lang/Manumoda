"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  HelpCircle,
  Loader2,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { VwBonosCorte, VwPlanCorteDetalle } from "@/lib/types"
import { computeRisk, needsAttention } from "@/lib/risk"
import type { ModuleFilter } from "@/lib/module-filter"
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BulkMoveWeekBar, RowCheckbox, SelectAllCheckbox } from "@/components/bulk-move-week-bar"
import { DeadlineAlertBanner } from "@/components/deadline-alert-banner"
import { EficienciaTrend } from "@/components/eficiencia-trend"
import { VacacionesPermisosTab } from "@/components/design-module"
import { IncomingFilterChip } from "@/components/incoming-filter-chip"
import { KpiCard } from "@/components/kpi-card"
import { EditCorteVariablesSheet } from "@/components/edit-corte-variables-sheet"
import { CorteMultipliersDialog } from "@/components/corte-multipliers-dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  useDisenoMultiplierCatalogs,
  PlanDisenoDesglosePopover,
} from "@/components/diseno-plan-desglose"

// ─── Constants ────────────────────────────────────────────────────────────────

const MESA_OPTIONS = ["Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4", "Mesa 5"]

const CUMPLIMIENTO_STYLES: Record<string, string> = {
  Pendiente: "bg-slate-100 text-slate-600 border-slate-200",
  Si: "bg-emerald-100 text-emerald-700 border-emerald-200",
  No: "bg-rose-100 text-rose-700 border-rose-200",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHrs(n: number | null | undefined) {
  if (n == null) return "—"
  return n.toFixed(2)
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return "—"
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n)
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—"
  return `${n.toFixed(2)}%`
}

type Cortador = { id: number; nombre: string }

// ─── Main Module ─────────────────────────────────────────────────────────────

export function CorteModule({
  configMissing,
  initialFilter = null,
}: {
  configMissing: boolean
  /** Filtro heredado del inicio (tarjetas de "Atención hoy"). */
  initialFilter?: ModuleFilter | null
}) {
  // Catálogos que necesita la pestaña de vacaciones
  const [cortadores, setCortadores] = useState<Cortador[]>([])
  const [tiposAusentismos, setTiposAusentismos] = useState<Cortador[]>([])
  const [loadingCatalogs, setLoadingCatalogs] = useState(false)

  useEffect(() => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoadingCatalogs(true)
    Promise.all([
      supabase.from("cortadores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("tipos_ausentismos").select("id, nombre").eq("idempresa", IDEMPRESA).order("nombre"),
    ]).then(([cortRes, tipoRes]) => {
      if (!cortRes.error) setCortadores((cortRes.data as Cortador[]) ?? [])
      if (!tipoRes.error) setTiposAusentismos((tipoRes.data as Cortador[]) ?? [])
      setLoadingCatalogs(false)
    })
  }, [configMissing])

  return (
    <Tabs defaultValue="plan" className="w-full">
      <TabsList>
        <TabsTrigger value="plan">Plan de Corte Semanal</TabsTrigger>
        <TabsTrigger value="bonos">Bonos</TabsTrigger>
        <TabsTrigger value="vacaciones">Vacaciones / Permisos</TabsTrigger>
      </TabsList>

      <TabsContent value="plan" className="mt-5">
        <PlanCorteTab configMissing={configMissing} initialFilter={initialFilter} />
      </TabsContent>

      <TabsContent value="bonos" className="mt-5">
        <BonosCorteTab configMissing={configMissing} />
      </TabsContent>

      <TabsContent value="vacaciones" className="mt-5">
        <VacacionesPermisosTab
          cortadores={cortadores}
          tiposAusentismos={tiposAusentismos}
          loadingCatalogs={loadingCatalogs}
          configMissing={configMissing}
          roles={["cortador"]}
        />
      </TabsContent>
    </Tabs>
  )
}

// ─── Tab 1: Plan de Corte ─────────────────────────────────────────────────────

type PatchRow = {
  mesa: string | null
  calificacion: number | null
  comentarios: string | null
}

function PlanCorteTab({
  configMissing,
  initialFilter = null,
}: {
  configMissing: boolean
  initialFilter?: ModuleFilter | null
}) {
  const [rows, setRows] = useState<VwPlanCorteDetalle[]>([])
  const [cortadores, setCortadores] = useState<Cortador[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [filterSemana, setFilterSemana] = useState<string>("__all__")
  const [search, setSearch] = useState("")

  /** Filtro heredado del inicio (tarjetas de "Atención hoy"). */
  const [incomingFilter, setIncomingFilter] = useState<ModuleFilter | null>(initialFilter)
  useEffect(() => { setIncomingFilter(initialFilter) }, [initialFilter])
  const [editVarsOpen, setEditVarsOpen] = useState(false)
  const [multipliersOpen, setMultipliersOpen] = useState(false)

  // Local overrides for inline edits (keyed by registro_id)
  const [localRows, setLocalRows] = useState<Record<number, Partial<PatchRow>>>({})

  // Selección múltiple para mover registros entre semanas
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [movingWeek, setMovingWeek] = useState(false)

  const fetchData = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const [planRes, cortRes] = await Promise.all([
      supabase
        .from("vw_plan_corte_detalle")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .order("semana", { ascending: false })
        .order("folio"),
      supabase
        .from("cortadores")
        .select("id, nombre")
        .eq("activo", true)
        .order("nombre"),
    ])
    setLoading(false)

    if (planRes.error) {
      toast.error("No se pudo cargar el plan de corte", { description: planRes.error.message })
    } else {
      setRows((planRes.data as VwPlanCorteDetalle[]) ?? [])
      setLocalRows({})
    }

    if (cortRes.error) {
      toast.error("No se pudo cargar el catálogo de cortadores", { description: cortRes.error.message })
    } else {
      setCortadores((cortRes.data as Cortador[]) ?? [])
    }
  }, [configMissing])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Semana options derived from data
  const semanaOptions = useMemo(() => {
    const seen = new Set<number>()
    const opts: number[] = []
    for (const r of rows) {
      if (r.semana != null && !seen.has(r.semana)) {
        seen.add(r.semana)
        opts.push(r.semana)
      }
    }
    return opts.sort((a, b) => b - a)
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filterSemana !== "__all__") {
      list = list.filter((r) => r.semana === Number(filterSemana))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.folio.toLowerCase().includes(q) ||
          (r.familia ?? "").toLowerCase().includes(q) ||
          (r.tipo_tela ?? "").toLowerCase().includes(q) ||
          (r.categoria_tela ?? "").toLowerCase().includes(q),
      )
    }
    // Filtro heredado del inicio
    if (incomingFilter === "corte-pendiente") {
      list = list.filter((r) => r.cumplimiento_corte !== "Si")
    }
    return list
  }, [rows, filterSemana, search, incomingFilter])

  const kpis = useMemo(() => {
    let cumplidos = 0
    // Folios distintos: corte_programacion tiene un registro por semana,
    // así que contar filas inflaría el número de pedidos por vencer.
    const foliosPorVencer = new Set<string>()
    for (const r of filtered) {
      if (r.cumplimiento_corte === "Si") cumplidos++
      if (r.folio && needsAttention(computeRisk(r.fecha_cancelacion, 0).risk)) {
        foliosPorVencer.add(r.folio)
      }
    }
    return {
      total: filtered.length,
      cumplidos,
      pendientes: filtered.length - cumplidos,
      porVencer: foliosPorVencer.size,
    }
  }, [filtered])

  // ── Selección múltiple / mover de semana ───────────────────────────────────

  /** Un corte cumplido no se puede mover: sus horas ya contaron en los bonos. */
  const isLocked = useCallback((r: VwPlanCorteDetalle) => r.cumplimiento_corte === "Si", [])

  // Solo las filas NO cumplidas son seleccionables
  const visibleIds = useMemo(
    () => filtered.filter((r) => !isLocked(r)).map((r) => r.registro_id),
    [filtered, isLocked],
  )
  const lockedCount = useMemo(() => filtered.filter(isLocked).length, [filtered, isLocked])
  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [visibleIds, selectedIds],
  )

  const toggleRow = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAllVisible = useCallback((checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of visibleIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [visibleIds])

  const moverSemana = useCallback(async (nuevaSemana: number) => {
    if (configMissing || selectedVisible.length === 0) return
    const supabase = getSupabase()
    if (!supabase) return
    setMovingWeek(true)
    try {
      const { error } = await supabase
        .from("corte_programacion")
        .update({ semana: nuevaSemana })
        .in("id", selectedVisible)
        .eq("idempresa", IDEMPRESA)

      if (error) {
        toast.error("No se pudieron mover los registros", { description: error.message })
        return
      }
      toast.success(
        `${selectedVisible.length} ${selectedVisible.length === 1 ? "registro movido" : "registros movidos"} a la semana ${nuevaSemana}`,
      )
      setSelectedIds(new Set())
      fetchData()
    } catch (err) {
      toast.error("Error inesperado al mover de semana", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setMovingWeek(false)
    }
  }, [configMissing, selectedVisible, fetchData])

  // Merge view data with local overrides for display
  function mergedRow(r: VwPlanCorteDetalle): VwPlanCorteDetalle & Partial<PatchRow> {
    return { ...r, ...(localRows[r.registro_id] ?? {}) }
  }

  // Auto-save handler for select/input fields
  async function handleFieldSave(registroId: number, field: keyof PatchRow, value: PatchRow[keyof PatchRow]) {
    const supabase = getSupabase()
    if (!supabase) return

    // Update local state immediately for snappy UI
    setLocalRows((prev) => ({
      ...prev,
      [registroId]: { ...prev[registroId], [field]: value },
    }))

    setSavingId(registroId)
    const { error } = await supabase
      .from("corte_programacion")
      .update({ [field]: value })
      .eq("id", registroId)
      .eq("idempresa", IDEMPRESA)
    setSavingId(null)

    if (error) {
      toast.error("No se pudo guardar el cambio", { description: error.message })
      // Revert local state
      setLocalRows((prev) => {
        const copy = { ...prev }
        delete copy[registroId]
        return copy
      })
    } else {
      // Refetch to get recalculated hours from the view
      await fetchData()
    }
  }

  return (
    <>
    <CorteMultipliersDialog open={multipliersOpen} onOpenChange={setMultipliersOpen} />
    <EditCorteVariablesSheet open={editVarsOpen} onClose={() => setEditVarsOpen(false)} />
    <div className="space-y-4">
      {/* Alerta de pedidos próximos a vencer */}
      <DeadlineAlertBanner
        items={filtered.map((r) => ({
          folio: r.folio,
          fecha_cancelacion: r.fecha_cancelacion,
          detalle: r.familia,
        }))}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Folios en plan"
          value={kpis.total}
          icon={<Scissors className="size-3.5" />}
          iconBg="bg-violet-50 ring-violet-200"
          iconColor="text-violet-600"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Cumplidos"
          value={kpis.cumplidos}
          icon={<CheckCircle2 className="size-3.5" />}
          iconBg="bg-emerald-50 ring-emerald-200"
          iconColor="text-emerald-600"
          valueColor="text-emerald-700"
        />
        <KpiCard
          label="Pendientes"
          value={kpis.pendientes}
          icon={<Clock className="size-3.5" />}
          iconBg="bg-slate-50 ring-slate-200"
          iconColor="text-slate-500"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Próximos a vencer"
          value={kpis.porVencer}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-50 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.porVencer > 0 ? "text-amber-600" : "text-foreground"}
          hint="Entrega en 7 días o menos"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar folio, familia, tela…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 pr-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Select value={filterSemana} onValueChange={setFilterSemana}>
          <SelectTrigger className="h-9 w-40 text-sm">
            <SelectValue placeholder="Semana…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las semanas</SelectItem>
            {semanaOptions.map((s) => (
              <SelectItem key={s} value={String(s)}>
                Semana {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} registro{filtered.length !== 1 ? "s" : ""}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMultipliersOpen(true)}
            className="gap-1.5 bg-transparent"
          >
            <SlidersHorizontal className="size-3.5" />
            Multiplicadores
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditVarsOpen(true)}
            className="gap-1.5 bg-transparent"
          >
            <Settings2 className="size-3.5" />
            Editar variables
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5 bg-transparent">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Actualizar
          </Button>
        </div>
      </div>

      {/* Filtro heredado del inicio */}
      {incomingFilter && (
        <IncomingFilterChip filter={incomingFilter} onClear={() => setIncomingFilter(null)} />
      )}

      {/* Barra de acción masiva (solo con filas seleccionadas) */}
      <BulkMoveWeekBar
        selectedCount={selectedVisible.length}
        lockedCount={lockedCount}
        onClear={() => setSelectedIds(new Set())}
        onMove={moverSemana}
        moving={movingWeek}
        entidad={selectedVisible.length === 1 ? "registro de corte" : "registros de corte"}
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10">
                <SelectAllCheckbox
                  checked={visibleIds.length > 0 && selectedVisible.length === visibleIds.length}
                  indeterminate={selectedVisible.length > 0 && selectedVisible.length < visibleIds.length}
                  onChange={toggleAllVisible}
                  title="Seleccionar todas las filas visibles"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Familia</TableHead>
              <TableHead className="font-semibold">Categoría</TableHead>
              <TableHead className="font-semibold">Tela</TableHead>
              <TableHead className="text-right font-semibold">Tendidos</TableHead>
              <TableHead className="text-right font-semibold">Piezas</TableHead>
              <TableHead className="font-semibold">Complementos</TableHead>
              <TableHead className="font-semibold">Cortador</TableHead>
              <TableHead className="font-semibold">Apoyo</TableHead>
              <TableHead className="min-w-[110px] font-semibold">Mesa</TableHead>
              <TableHead className="text-right font-semibold">Trazos</TableHead>
              <TableHead className="min-w-[110px] font-semibold">Cumplimiento</TableHead>
              <TableHead className="text-right font-semibold">Hrs Cum.</TableHead>
              <TableHead className="text-center font-semibold">Calidad</TableHead>
              <TableHead className="min-w-[160px] font-semibold">Comentarios</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 16 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={16} className="h-28 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "No hay registros en el plan de corte." : "Sin resultados para esta búsqueda."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const m = mergedRow(r)
                const isSaving = savingId === r.registro_id
                return (
                  <TableRow
                    key={r.registro_id}
                    className={cn(
                      "text-sm",
                      isSaving && "opacity-60",
                      selectedIds.has(r.registro_id) && "bg-indigo-50/60",
                    )}
                  >
                    <TableCell>
                      <RowCheckbox
                        checked={selectedIds.has(r.registro_id)}
                        onChange={(v) => toggleRow(r.registro_id, v)}
                        disabled={isLocked(r)}
                        disabledTitle="Corte cumplido — sus horas ya contaron en los bonos de esta semana"
                      />
                    </TableCell>
                    <TableCell className="font-mono font-semibold">{r.folio}</TableCell>
                    <TableCell className="text-muted-foreground">{r.familia ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.categoria_corte ?? r.categoria ?? "—"}</TableCell>
                    <TableCell className="max-w-[130px] truncate text-xs">{r.categoria_tela ?? r.tipo_tela ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.tendidos ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.piezas_cortadas ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.combinacion && (
                          <span className="rounded px-1 py-0.5 text-[10px] bg-amber-100 text-amber-700">Comb</span>
                        )}
                        {r.comp_entretela && (
                          <span className="rounded px-1 py-0.5 text-[10px] bg-blue-100 text-blue-700">Ent</span>
                        )}
                        {r.comp_poquetin && (
                          <span className="rounded px-1 py-0.5 text-[10px] bg-purple-100 text-purple-700">Poq</span>
                        )}
                        {r.comp_forro && (
                          <span className="rounded px-1 py-0.5 text-[10px] bg-green-100 text-green-700">Fro</span>
                        )}
                        {!r.combinacion && !r.comp_entretela && !r.comp_poquetin && !r.comp_forro && (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Cortador — read-only */}
                    <TableCell className="text-sm">{r.cortador_nombre ?? "—"}</TableCell>

                    {/* Apoyo — read-only */}
                    <TableCell className="text-sm text-muted-foreground">{r.apoyo_nombre ?? "—"}</TableCell>

                    {/* Mesa — inline input (save on blur) */}
                    <TableCell>
                      <MesaCell
                        value={m.mesa ?? ""}
                        disabled={isSaving}
                        onSave={(v) => handleFieldSave(r.registro_id, "mesa", v || null)}
                      />
                    </TableCell>

                    <TableCell className="text-right tabular-nums">{r.trazos ?? "—"}</TableCell>

                    {/* Cumplimiento — read-only badge */}
                    <TableCell>
                      <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium border", CUMPLIMIENTO_STYLES[r.cumplimiento_corte ?? "Pendiente"])}>
                        {r.cumplimiento_corte ?? "Pendiente"}
                      </span>
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {r.horas_cumplimiento_corte != null && r.horas_cumplimiento_corte > 0 ? (
                        <span className="font-semibold text-emerald-600">{fmtHrs(r.horas_cumplimiento_corte)}</span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>

                    {/* Calificación — inline Select 1–10 */}
                    <TableCell className="text-center">
                      <CalificacionCell
                        value={m.calificacion ?? null}
                        disabled={isSaving}
                        onSave={(v) => handleFieldSave(r.registro_id, "calificacion", v)}
                      />
                    </TableCell>

                    {/* Comentarios — inline text input */}
                    <TableCell>
                      <ComentariosCell
                        value={m.comentarios ?? ""}
                        disabled={isSaving}
                        onSave={(v) => handleFieldSave(r.registro_id, "comentarios", v || null)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
    </>
  )
}

// ─── Inline cell helpers ──────────────────────────────────────────────────────

function MesaCell({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value)
  const initialRef = useRef(value)

  useEffect(() => {
    setLocal(value)
    initialRef.current = value
  }, [value])

  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== initialRef.current) onSave(local) }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      disabled={disabled}
      maxLength={20}
      placeholder="—"
      className="h-8 text-xs"
    />
  )
}


function CalificacionCell({ value, disabled, onSave }: {
  value: number | null; disabled: boolean; onSave: (v: number | null) => void
}) {
  const colorClass = value == null ? "text-muted-foreground"
    : value >= 8 ? "text-emerald-700 font-semibold"
    : value >= 5 ? "text-amber-700 font-semibold"
    : "text-rose-700 font-semibold"
  return (
    <Select
      value={value != null ? String(value) : "__none__"}
      onValueChange={(v) => onSave(v === "__none__" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-8 w-16 text-xs", colorClass)}>
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ComentariosCell({ value, disabled, onSave }: {
  value: string; disabled: boolean; onSave: (v: string) => void
}) {
  const [local, setLocal] = useState(value)
  const initialRef = useRef(value)
  useEffect(() => { setLocal(value); initialRef.current = value }, [value])
  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== initialRef.current) onSave(local) }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      disabled={disabled}
      maxLength={200}
      placeholder="—"
      className="h-8 min-w-[150px] text-xs"
    />
  )
}

// ─── Tab 2: Bonos de Corte ────────────────────────────────────────────────────

function BonosCorteTab({ configMissing }: { configMissing: boolean }) {
  const [bonos, setBonos] = useState<VwBonosCorte[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>("")
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, CorteFolioRow[]>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const disMultCats = useDisenoMultiplierCatalogs(configMissing)

  const fetchBonos = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase
      .from("vw_bonos_corte")
      .select("*")
      .order("anio", { ascending: false })
      .order("semana", { ascending: false })
      .order("nombre")
    setLoading(false)

    if (error) {
      toast.error("No se pudo cargar la liquidación de corte", { description: error.message })
      return
    }
    const list = (data as VwBonosCorte[]) ?? []
    setBonos(list)

    // Default to most recent week
    if (list.length > 0 && !selectedWeekKey) {
      const first = list[0]
      setSelectedWeekKey(`${first.anio ?? "?"}-${first.semana}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configMissing])

  useEffect(() => {
    fetchBonos()
  }, [fetchBonos])

  const weekOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { key: string; label: string }[] = []
    for (const r of bonos) {
      const k = `${r.anio ?? "?"}-${r.semana}`
      if (!seen.has(k)) {
        seen.add(k)
        opts.push({ key: k, label: `Año ${r.anio} · Semana ${r.semana}` })
      }
    }
    return opts
  }, [bonos])

  const filtered = useMemo(
    () => bonos.filter((r) => `${r.anio ?? "?"}-${r.semana}` === selectedWeekKey),
    [bonos, selectedWeekKey],
  )

  const toggleExpand = useCallback(async (r: VwBonosCorte) => {
    if (r.semana == null) return
    const key = `${r.registro}-${r.semana}`
    if (expandedKey === key) { setExpandedKey(null); return }
    setExpandedKey(key)
    if (detailCache[key]) return
    setLoadingDetail(key)
    const supabase = getSupabase()
    if (!supabase) { setLoadingDetail(null); return }
    const { data: corteData, error: corteError } = await supabase
      .from("vw_plan_corte_detalle")
      .select("folio, familia, categoria_corte, horas_plan_corte, horas_plan_final, cumplimiento_corte, horas_cumplimiento_corte")
      .eq("idempresa", IDEMPRESA)
      .eq("semana", r.semana)
      .or(`idcortador.eq.${r.registro},idapoyo.eq.${r.registro}`)
      .order("folio")

    if (corteError) {
      toast.error("No se pudo cargar el detalle de folios", { description: corteError.message })
      setLoadingDetail(null)
      return
    }

    const corteRows = (corteData ?? []) as Omit<CorteFolioRow, "horas_plan_diseno" | "idprenda" | "tipo" | "categoria_demografica" | "muchas_operaciones" | "telas_pesadas" | "muchas_habilitaciones" | "prenda_compleja">[]

    // Enriquecer con datos de diseño por folio
    const folios = corteRows.map((row) => row.folio).filter(Boolean)
    const disenoMap = new Map<string, Partial<CorteFolioRow>>()

    if (folios.length > 0) {
      const { data: disenoData, error: disenoError } = await supabase
        .from("diseno_programacion")
        .select("folio, horas_plan_diseno, idprenda, tipo, categoria_demografica, muchas_operaciones, telas_pesadas, muchas_habilitaciones, prenda_compleja")
        .eq("idempresa", IDEMPRESA)
        .in("folio", folios)
        .order("id", { ascending: false })

      if (disenoError) {
        // No bloquea el acordeón: solo faltará la columna Plan Diseño
        toast.warning("No se pudo cargar el detalle de diseño", { description: disenoError.message })
      }
      for (const d of (disenoData ?? []) as { folio: string; horas_plan_diseno: number | null; idprenda: number | null; tipo: string | null; categoria_demografica: string | null; muchas_operaciones: boolean | null; telas_pesadas: boolean | null; muchas_habilitaciones: boolean | null; prenda_compleja: boolean | null }[]) {
        if (!disenoMap.has(d.folio)) {
          disenoMap.set(d.folio, {
            horas_plan_diseno: d.horas_plan_diseno,
            idprenda: d.idprenda,
            tipo: d.tipo,
            categoria_demografica: d.categoria_demografica,
            muchas_operaciones: d.muchas_operaciones,
            telas_pesadas: d.telas_pesadas,
            muchas_habilitaciones: d.muchas_habilitaciones,
            prenda_compleja: d.prenda_compleja,
          })
        }
      }
    }

    const enriched: CorteFolioRow[] = corteRows.map((row) => {
      const d = disenoMap.get(row.folio)
      return {
        ...row,
        horas_plan_diseno: d?.horas_plan_diseno ?? null,
        idprenda: d?.idprenda ?? null,
        tipo: d?.tipo ?? null,
        categoria_demografica: d?.categoria_demografica ?? null,
        muchas_operaciones: d?.muchas_operaciones ?? null,
        telas_pesadas: d?.telas_pesadas ?? null,
        muchas_habilitaciones: d?.muchas_habilitaciones ?? null,
        prenda_compleja: d?.prenda_compleja ?? null,
      }
    })

    setDetailCache((prev) => ({ ...prev, [key]: enriched }))
    setLoadingDetail(null)
  }, [expandedKey, detailCache])

  const recalcularHorasCorte = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setRecalculating(true)
    try {
      // corte_programacion no almacena horas_cumplimiento_corte —
      // la vista vw_plan_corte_detalle la calcula dinámicamente.
      // Solo refrescamos la carga de bonos para reflejar cambios recientes.
      setDetailCache({})
      await fetchBonos()
      toast.success("Datos de corte actualizados")
    } finally {
      setRecalculating(false)
    }
  }, [configMissing, fetchBonos])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedWeekKey} onValueChange={setSelectedWeekKey}>
          <SelectTrigger className="h-9 w-56 text-sm">
            <SelectValue placeholder="Seleccionar semana…" />
          </SelectTrigger>
          <SelectContent>
            {weekOptions.map((o) => (
              <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} colaborador{filtered.length !== 1 ? "es" : ""}</span>
          <Button variant="ghost" size="sm" onClick={() => setInfoOpen(true)} className="gap-1.5">
            <HelpCircle className="size-3.5" />
            Cómo se calcula
          </Button>
          <Button variant="outline" size="sm" onClick={fetchBonos} disabled={loading} className="gap-1.5 bg-transparent">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={recalcularHorasCorte}
            disabled={recalculating || configMissing}
            className="gap-1.5 bg-transparent text-indigo-600 border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
          >
            {recalculating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Recalcular horas
          </Button>
        </div>
      </div>

      {/* Tendencia entre semanas */}
      <EficienciaTrend
        rows={bonos.map((b) => ({ anio: b.anio, semana: b.semana, eficiencia: b.porcentaje_eficiencia }))}
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Nombre</TableHead>
              <TableHead className="font-semibold">Área</TableHead>
              <TableHead className="text-right font-semibold">Hrs Semana</TableHead>
              <TableHead className="text-right font-semibold">Hrs Cumplidas</TableHead>
              <TableHead className="text-right font-semibold">Hrs Fuera</TableHead>
              <TableHead className="text-right font-semibold">Ausentismos</TableHead>
              <TableHead className="text-right font-semibold">% Eficiencia</TableHead>
              <TableHead className="text-center font-semibold">Aceptación</TableHead>
              <TableHead className="text-center font-semibold">¿Bono?</TableHead>
              <TableHead className="text-right font-semibold">Monto</TableHead>
              <TableHead className="text-right font-semibold">% Productividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && bonos.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-28 text-center text-sm text-muted-foreground">
                  {bonos.length === 0 ? "Sin datos de liquidación de corte." : "Sin datos para la semana seleccionada."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const isBaja = r.estatus_colaborador === "Baja"
                const key = `${r.registro}-${r.semana}`
                const isExpanded = expandedKey === key
                const detail = detailCache[key] ?? []
                const isLoadingThis = loadingDetail === key
                const totalCum = detail.reduce((a, d) => a + (d.horas_cumplimiento_corte ?? 0), 0)
                const foliosSi = detail.filter((d) => d.cumplimiento_corte === "Si").length
                return (
                  <Fragment key={key}>
                    <TableRow className={cn("text-sm", isBaja && "opacity-60", isExpanded && "bg-muted/30")}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.nombre ?? "—"}</span>
                          {isBaja && (
                            <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 text-[10px]">
                              Baja
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                          {r.area ?? "Corte"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtHrs(r.horas_semana)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        <button
                          type="button"
                          onClick={() => toggleExpand(r)}
                          className="inline-flex items-center gap-1 tabular-nums hover:text-foreground cursor-pointer text-primary"
                          title={isExpanded ? "Cerrar detalle" : "Ver detalle por folio"}
                        >
                          {isExpanded
                            ? <ChevronDown className="size-3.5 shrink-0" />
                            : <ChevronRight className="size-3.5 shrink-0" />}
                          {fmtHrs(r.horas_cumplidas)}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtHrs(r.horas_fuera_area)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ausentismos ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {r.porcentaje_eficiencia != null ? (
                          <span className={cn(
                            "tabular-nums font-semibold",
                            r.porcentaje_eficiencia >= 80 ? "text-emerald-600" :
                            r.porcentaje_eficiencia >= 70 ? "text-amber-600" : "text-rose-600",
                          )}>
                            {fmtPct(r.porcentaje_eficiencia)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.criterio_aceptacion === "Si" ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">Sí</Badge>
                        ) : r.criterio_aceptacion === "No" ? (
                          <Badge className="bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100">No</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.bono_semanal === "Si" ? (
                          <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100">✓ Bono</Badge>
                        ) : r.bono_semanal === "No" ? (
                          <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200">Sin bono</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {r.monto != null ? (
                          <span className={r.monto > 0 ? "text-emerald-700" : "text-muted-foreground"}>
                            {fmtCurrency(r.monto)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(r.porcentaje_productividad_directa)}</TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={11} className="p-0">
                          <div className="border-t border-border bg-muted/20 px-5 py-3 space-y-2">
                            {isLoadingThis ? (
                              <div className="flex justify-center py-4">
                                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : detail.length === 0 ? (
                              <p className="py-2 text-center text-xs text-muted-foreground">Sin registros para esta semana.</p>
                            ) : (
                              <>
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-transparent hover:bg-transparent">
                                      <TableHead className="h-8 text-xs">Folio</TableHead>
                                      <TableHead className="h-8 text-xs">Familia</TableHead>
                                      <TableHead className="h-8 text-xs">Categoría</TableHead>
                                      <TableHead className="h-8 text-xs text-right">Hrs Plan</TableHead>
                                      <TableHead className="h-8 text-xs text-right">Hrs Final</TableHead>
                                      <TableHead className="h-8 text-xs text-center">Cumpl.</TableHead>
                                      <TableHead className="h-8 text-xs text-right">Hrs Cum.</TableHead>
                                      <TableHead className="h-8 text-xs text-right text-indigo-600">Plan Diseño</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {detail.map((d, di) => (
                                      <TableRow key={di} className={cn("text-xs", d.cumplimiento_corte !== "Si" && "opacity-50")}>
                                        <TableCell className="py-1 font-mono">{d.folio}</TableCell>
                                        <TableCell className="py-1">{d.familia ?? "—"}</TableCell>
                                        <TableCell className="py-1">{d.categoria_corte ?? "—"}</TableCell>
                                        <TableCell className="py-1 text-right tabular-nums">{fmtHrs(d.horas_plan_corte)}</TableCell>
                                        <TableCell className="py-1 text-right tabular-nums">{fmtHrs(d.horas_plan_final)}</TableCell>
                                        <TableCell className="py-1 text-center">
                                          {d.cumplimiento_corte === "Si"
                                            ? <span className="font-semibold text-emerald-600">✓</span>
                                            : d.cumplimiento_corte === "No"
                                            ? <span className="text-rose-500">✗</span>
                                            : <span className="text-muted-foreground/40">—</span>}
                                        </TableCell>
                                        <TableCell className="py-1 text-right tabular-nums font-medium">
                                          {d.horas_cumplimiento_corte != null && d.horas_cumplimiento_corte > 0
                                            ? <span className="text-emerald-600">{fmtHrs(d.horas_cumplimiento_corte)}</span>
                                            : <span className="text-muted-foreground/40">—</span>}
                                        </TableCell>
                                        <TableCell className="py-1 text-right tabular-nums">
                                          {d.horas_plan_diseno != null
                                            ? <PlanDisenoDesglosePopover row={d} cats={disMultCats} />
                                            : <span className="text-muted-foreground/40">—</span>}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                <div className="flex items-center justify-between border-t pt-1.5 text-xs text-muted-foreground">
                                  <span>{foliosSi} de {detail.length} folios con cumplimiento</span>
                                  <span className="font-semibold text-foreground">Total: {fmtHrs(totalCum)} h</span>
                                </div>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      <CorteBonosInfoDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  )
}

// ─── Corte: Tipos para caché de detalle ──────────────────────────────────────

type CorteFolioRow = {
  folio: string
  familia: string | null
  categoria_corte: string | null
  horas_plan_corte: number | null
  horas_plan_final: number | null
  cumplimiento_corte: string | null
  horas_cumplimiento_corte: number | null
  // campos de diseño (enriquecidos desde diseno_programacion)
  horas_plan_diseno: number | null
  idprenda: number | null
  tipo: string | null
  categoria_demografica: string | null
  muchas_operaciones: boolean | null
  telas_pesadas: boolean | null
  muchas_habilitaciones: boolean | null
  prenda_compleja: boolean | null
}

// ─── Corte: Info de cálculo de bono ─────────────────────────────────────────

function CorteBonosInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Cómo se calcula el bono de Corte?</DialogTitle>
          <DialogDescription>Resumen del proceso de liquidación semanal</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="font-semibold text-foreground">1. Horas Cumplidas</p>
              <p className="text-muted-foreground mt-0.5">Suma de <em>Hrs Cumplimiento</em> de todos los folios de la semana donde el cortador registró <span className="font-medium text-emerald-600">Cumplimiento = Sí</span>. Haz clic en el valor de la columna para ver el desglose.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">2. Horas Semana</p>
              <p className="text-muted-foreground mt-0.5">Total de horas laborables pactadas para la semana según el calendario del colaborador.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">3. % Eficiencia</p>
              <p className="font-mono text-xs bg-background rounded px-2 py-1 mt-0.5 inline-block">
                (Hrs Cumplidas + Hrs Fuera de Área) / Hrs Semana × 100
              </p>
            </div>
            <div>
              <p className="font-semibold text-foreground">4. Criterio de Aceptación</p>
              <p className="text-muted-foreground mt-0.5">Se marca <span className="font-medium">Sí</span> cuando la eficiencia supera el umbral mínimo configurado en los parámetros del sistema.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">5. Bono Semanal</p>
              <p className="text-muted-foreground mt-0.5">El colaborador recibe el monto de bono si el criterio se cumple y no tiene ausencias que lo descalifiquen.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">6. % Productividad Directa</p>
              <p className="text-muted-foreground mt-0.5">Eficiencia calculada únicamente con los folios de corte propios (sin sumar horas fuera de área).</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

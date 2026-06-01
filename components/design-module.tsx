"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { getISOWeek, format } from "date-fns"
import { es } from "date-fns/locale"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ClipboardCheck,
  AlertCircle,
  Scissors,
  Pencil,
  CalendarIcon,
  MapPin,
  UserMinus,
  Download,
  FileSpreadsheet,
} from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import * as XLSX from "xlsx"

// ── Tipos ─────────────────────────────────────────────────────────────────────

type DisenoProgramacion = {
  id: number
  idempresa: number
  folio: string | null
  modelo: string | null
  familia: string | null
  categoria: string | null
  cliente: string | null
  fecha: string | null
  semana: number | null
  semana_original: number | null
  tipo: string | null
  numero_muestras: number | null
  iddisenadora: number | null
  idcosturera: number | null
  comentarios: string | null
  horas_plan_diseno: number | null
  horas_diseno_cumplidas: number | null
  horas_plan_costura: number | null
  horas_costura_cumplidas: number | null
  cumplimiento_diseno: boolean
  cumplimiento_costura: boolean
  rechazo_orden: boolean
  disenadoras: { nombre: string } | null
  costureras: { nombre: string } | null
}

type VwBonosDiseno = {
  nombre: string | null
  semana: number | null
  anio: number | null
  horas_cumplidas: number | null
  horas_fuera_area: number | null
  ausentismos: number | null
  eficiencia_pct: number | null
  criterio_aceptacion: string | null
  bono_semanal: string | null
  monto: number | null
  bono_colectivo: number | null
  bono_total: number | null
}

type HojaRow = {
  id: number
  fecha: string | null
  semana: number | null
  modelo: string | null
  familia: string | null
  categoria: string | null
  cliente: string | null
  tipo: string | null
  numero_muestras: number | null
  disenadoras: { nombre: string } | null
  costureras: { nombre: string } | null
  horas_diseno_cumplidas: number | null
  horas_costura_cumplidas: number | null
  horas_totales_cumplidas: number | null
}

type Catalog = { id: number; nombre: string }
type Props = { configMissing: boolean }

// ── Componente principal ───────────────────────────────────────────────────────

export function DesignModule({ configMissing }: Props) {
  // Estado principal
  const [records, setRecords] = useState<DisenoProgramacion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string>("")
  const [selectedMonth, setSelectedMonth] = useState<string>("")

  // Catálogos compartidos
  const [disenadoras, setDisenadoras] = useState<Catalog[]>([])
  const [tiposAusentismos, setTiposAusentismos] = useState<Catalog[]>([])
  const [loadingCatalogs, setLoadingCatalogs] = useState(false)

  // Modales
  const [evalRecord, setEvalRecord] = useState<DisenoProgramacion | null>(null)
  const [evalOpen, setEvalOpen] = useState(false)
  const [tiempoFueraOpen, setTiempoFueraOpen] = useState(false)
  const [ausentismoOpen, setAusentismoOpen] = useState(false)

  // ── Derivados ────────────────────────────────────────────────────────────────

  const weeks = useMemo(
    () =>
      [...new Set(records.map((r) => r.semana).filter((w): w is number => w != null))].sort(
        (a, b) => a - b,
      ),
    [records],
  )

  const months = useMemo(() => {
    const seen = new Set<string>()
    const opts: { key: string; label: string }[] = []
    for (const r of records) {
      if (!r.fecha) continue
      const key = r.fecha.slice(0, 7) // "YYYY-MM"
      if (!seen.has(key)) {
        seen.add(key)
        const [y, m] = key.split("-").map(Number)
        opts.push({ key, label: format(new Date(y, m - 1, 1), "MMMM yyyy", { locale: es }) })
      }
    }
    return opts.sort((a, b) => b.key.localeCompare(a.key))
  }, [records])

  const filteredRecords = useMemo(
    () =>
      records.filter((r) => {
        if (selectedMonth && r.fecha?.slice(0, 7) !== selectedMonth) return false
        if (selectedWeek && String(r.semana) !== selectedWeek) return false
        return true
      }),
    [records, selectedWeek, selectedMonth],
  )

  const kpis = useMemo(
    () => ({
      planDiseno: filteredRecords.reduce((s, r) => s + (r.horas_plan_diseno ?? 0), 0),
      cumplidasDiseno: filteredRecords.reduce((s, r) => s + (r.horas_diseno_cumplidas ?? 0), 0),
      planCostura: filteredRecords.reduce((s, r) => s + (r.horas_plan_costura ?? 0), 0),
      cumplidasCostura: filteredRecords.reduce((s, r) => s + (r.horas_costura_cumplidas ?? 0), 0),
    }),
    [filteredRecords],
  )

  // ── Fetches ──────────────────────────────────────────────────────────────────

  const fetchRecords = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from("diseno_programacion")
      .select("*, disenadoras(nombre), costureras(nombre)")
      .eq("idempresa", IDEMPRESA)
      .order("semana", { ascending: true })
      .order("fecha", { ascending: true })
    if (e) { console.error("[v0] diseno fetch:", e); setError(e.message) }
    else setRecords((data ?? []) as DisenoProgramacion[])
    setLoading(false)
  }, [configMissing])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  useEffect(() => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoadingCatalogs(true)
    Promise.all([
      supabase.from("disenadoras").select("id, nombre").eq("idempresa", IDEMPRESA).order("nombre"),
      supabase.from("tipos_ausentismos").select("id, nombre").eq("idempresa", IDEMPRESA).order("nombre"),
    ]).then(([d, t]) => {
      if (!d.error) setDisenadoras((d.data ?? []) as Catalog[])
      if (!t.error) setTiposAusentismos((t.data ?? []) as Catalog[])
      setLoadingCatalogs(false)
    })
  }, [configMissing])

  useEffect(() => {
    if (weeks.length === 0) return
    setSelectedWeek((prev) => {
      if (prev) return prev
      const cur = getISOWeek(new Date())
      return String(weeks.includes(cur) ? cur : weeks[weeks.length - 1])
    })
  }, [weeks])

  const handleRecordUpdated = useCallback(
    (updated: DisenoProgramacion) =>
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r))),
    [],
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <Tabs defaultValue="seguimiento" className="space-y-5">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="seguimiento" className="flex-1 sm:flex-none">
            Seguimiento Semanal
          </TabsTrigger>
          <TabsTrigger value="bonos" className="flex-1 sm:flex-none">
            Calculadora de Bonos
          </TabsTrigger>
          <TabsTrigger value="impresion" className="flex-1 sm:flex-none">
            Hoja de Impresión
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Seguimiento Semanal ── */}
        <TabsContent value="seguimiento" className="space-y-5 mt-0">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTiempoFueraOpen(true)}
                disabled={configMissing || loadingCatalogs}
                className="gap-1.5 bg-transparent"
              >
                <MapPin className="size-3.5" />
                Registrar Tiempo Fuera
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAusentismoOpen(true)}
                disabled={configMissing || loadingCatalogs}
                className="gap-1.5 bg-transparent"
              >
                <UserMinus className="size-3.5" />
                Registrar Ausentismo
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedMonth || "__all__"}
                onValueChange={(v) => setSelectedMonth(v === "__all__" ? "" : v)}
                disabled={loading || months.length === 0}
              >
                <SelectTrigger className="w-44 bg-transparent capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los meses</SelectItem>
                  {months.map((m) => (
                    <SelectItem key={m.key} value={m.key} className="capitalize">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedWeek || "__all__"}
                onValueChange={(v) => setSelectedWeek(v === "__all__" ? "" : v)}
                disabled={loading || weeks.length === 0}
              >
                <SelectTrigger className="w-40 bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las semanas</SelectItem>
                  {weeks.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      Semana {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchRecords}
                disabled={loading || configMissing}
                className="gap-2 bg-transparent"
              >
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                Actualizar
              </Button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-7 w-20" />
                  </div>
                ))
              : (
                <>
                  <KpiCard label="Plan Diseño" value={kpis.planDiseno} icon={<Pencil className="size-3.5" />} iconBg="bg-indigo-100 ring-indigo-200" iconColor="text-indigo-600" valueColor="text-indigo-700" />
                  <KpiCard label="Cumplidas Diseño" value={kpis.cumplidasDiseno} icon={<CheckCircle2 className="size-3.5" />} iconBg="bg-emerald-100 ring-emerald-200" iconColor="text-emerald-600" valueColor="text-emerald-700" />
                  <KpiCard label="Plan Costura" value={kpis.planCostura} icon={<Scissors className="size-3.5" />} iconBg="bg-violet-100 ring-violet-200" iconColor="text-violet-600" valueColor="text-violet-700" />
                  <KpiCard label="Cumplidas Costura" value={kpis.cumplidasCostura} icon={<CheckCircle2 className="size-3.5" />} iconBg="bg-cyan-100 ring-cyan-200" iconColor="text-cyan-600" valueColor="text-cyan-700" />
                </>
              )}
          </div>

          {/* Tabla de seguimiento */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-semibold">Folio / Modelo</TableHead>
                    <TableHead className="font-semibold">Familia</TableHead>
                    <TableHead className="font-semibold">Categoría</TableHead>
                    <TableHead className="font-semibold">Tipo</TableHead>
                    <TableHead className="font-semibold">Diseñadora</TableHead>
                    <TableHead className="font-semibold text-right">Plan Diseño</TableHead>
                    <TableHead className="font-semibold">Costurera</TableHead>
                    <TableHead className="font-semibold text-right">Plan Costura</TableHead>
                    <TableHead className="font-semibold">Estatus</TableHead>
                    <TableHead className="font-semibold text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((__, j) => (
                          <TableCell key={j}><Skeleton className="h-4 rounded" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : error ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-24 text-center text-destructive">
                        <AlertCircle className="inline size-4 mr-1.5 align-text-bottom" />
                        {error}
                      </TableCell>
                    </TableRow>
                  ) : filteredRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                        {records.length === 0 ? "Sin registros en diseño." : "Sin registros para la semana seleccionada."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecords.map((row) => (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell>
                          <p className="font-mono text-xs font-semibold text-foreground">{row.folio ?? "—"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{row.modelo ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.familia ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.categoria ?? "—"}</TableCell>
                        <TableCell>
                          {row.tipo
                            ? <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">{row.tipo}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{row.disenadoras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium text-indigo-700">
                          {fmtH(row.horas_plan_diseno)} <span className="text-muted-foreground text-xs font-normal">h</span>
                        </TableCell>
                        <TableCell className="text-sm">{row.costureras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium text-violet-700">
                          {fmtH(row.horas_plan_costura)} <span className="text-muted-foreground text-xs font-normal">h</span>
                        </TableCell>
                        <TableCell><StatusBadge row={row} /></TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => { setEvalRecord(row); setEvalOpen(true) }} className="gap-1.5">
                            <ClipboardCheck className="size-3.5" />
                            Evaluar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 2: Calculadora de Bonos ── */}
        <TabsContent value="bonos" className="mt-0">
          <BonosTab configMissing={configMissing} />
        </TabsContent>

        {/* ── Tab 3: Hoja de Impresión ── */}
        <TabsContent value="impresion" className="mt-0">
          <HojaImpresionTab configMissing={configMissing} />
        </TabsContent>
      </Tabs>

      {/* Modales — fuera del árbol de Tabs para evitar problemas de z-index */}
      <EvalSheet
        record={evalRecord}
        open={evalOpen}
        onOpenChange={(o) => { setEvalOpen(o); if (!o) setEvalRecord(null) }}
        onUpdated={handleRecordUpdated}
      />
      <TiempoFueraDialog
        open={tiempoFueraOpen}
        onOpenChange={setTiempoFueraOpen}
        disenadoras={disenadoras}
        loadingCatalogs={loadingCatalogs}
      />
      <AusentismoDialog
        open={ausentismoOpen}
        onOpenChange={setAusentismoOpen}
        disenadoras={disenadoras}
        tiposAusentismos={tiposAusentismos}
        loadingCatalogs={loadingCatalogs}
      />
    </>
  )
}

// ── Tab 2: Calculadora de Bonos ───────────────────────────────────────────────

function BonosTab({ configMissing }: { configMissing: boolean }) {
  const [bonos, setBonos] = useState<VwBonosDiseno[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>("")

  // Fetch desde la vista SQL (sin matemáticas en frontend)
  const fetchBonos = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from("vw_bonos_diseno")
      .select("*")
      .eq("idempresa", IDEMPRESA)
      .order("anio", { ascending: false })
      .order("semana", { ascending: false })
    if (e) { console.error("[v0] bonos fetch:", e); setError(e.message) }
    else setBonos((data ?? []) as VwBonosDiseno[])
    setLoading(false)
  }, [configMissing])

  useEffect(() => { fetchBonos() }, [fetchBonos])

  // Semanas únicas preservando el orden desc del fetch (anio+semana combinados)
  const weekOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { key: string; label: string }[] = []
    for (const r of bonos) {
      if (r.semana == null) continue
      const key = `${r.anio ?? "?"}-${r.semana}`
      if (!seen.has(key)) {
        seen.add(key)
        opts.push({
          key,
          label: r.anio ? `Sem ${r.semana} / ${r.anio}` : `Semana ${r.semana}`,
        })
      }
    }
    return opts
  }, [bonos])

  // Por defecto: semana más reciente (primera en el arreglo ordenado desc)
  useEffect(() => {
    if (weekOptions.length === 0) return
    setSelectedWeekKey((prev) => prev || weekOptions[0].key)
  }, [weekOptions])

  const filteredBonos = useMemo(
    () =>
      selectedWeekKey
        ? bonos.filter((r) => `${r.anio ?? "?"}-${r.semana}` === selectedWeekKey)
        : bonos,
    [bonos, selectedWeekKey],
  )

  // El bono colectivo de la semana es el mismo para todas las filas — tomamos el primero
  const bonoColectivoActivo = filteredBonos.length > 0 && (filteredBonos[0].bono_colectivo ?? 0) > 0
  const montoColectivo = filteredBonos[0]?.bono_colectivo ?? 0

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Select
            value={selectedWeekKey}
            onValueChange={setSelectedWeekKey}
            disabled={loading || weekOptions.length === 0}
          >
            <SelectTrigger className="w-44 bg-transparent">
              <SelectValue placeholder="Seleccionar semana…" />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchBonos}
            disabled={loading || configMissing}
            className="gap-2 bg-transparent"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Actualizar
          </Button>
        </div>

        {/* Badge bono colectivo */}
        {!loading && filteredBonos.length > 0 && (
          <Badge
            variant="outline"
            className={cn(
              "gap-1.5 px-3 py-1 text-xs font-medium",
              bonoColectivoActivo
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-500",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                bonoColectivoActivo ? "bg-emerald-500" : "bg-slate-400",
              )}
            />
            Bono Colectivo:{" "}
            {bonoColectivoActivo ? `Activo (${fmtCurrency(montoColectivo)})` : "Inactivo"}
          </Badge>
        )}
      </div>

      {/* Tabla de bonos */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Nombre</TableHead>
                <TableHead className="font-semibold text-right">Hrs Cumplidas</TableHead>
                <TableHead className="font-semibold text-right">Hrs Fuera</TableHead>
                <TableHead className="font-semibold text-right">Ausentismos</TableHead>
                <TableHead className="font-semibold text-right">Eficiencia</TableHead>
                <TableHead className="font-semibold">Criterio</TableHead>
                <TableHead className="font-semibold">Bono</TableHead>
                <TableHead className="font-semibold text-right">Monto</TableHead>
                <TableHead className="font-semibold text-right">Colectivo</TableHead>
                <TableHead className="font-semibold text-right">Bono Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-destructive">
                    <AlertCircle className="inline size-4 mr-1.5 align-text-bottom" />
                    {error}
                  </TableCell>
                </TableRow>
              ) : filteredBonos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                    {bonos.length === 0
                      ? "Sin datos de bonos disponibles."
                      : "Sin datos para la semana seleccionada."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredBonos.map((row, i) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-foreground">
                      {row.nombre ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {fmtH(row.horas_cumplidas)} <span className="text-muted-foreground text-xs">h</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {fmtH(row.horas_fuera_area)} <span className="text-muted-foreground text-xs">h</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {row.ausentismos ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <EficienciaBadge pct={row.eficiencia_pct} />
                    </TableCell>
                    <TableCell>
                      <CriterioBadge criterio={row.criterio_aceptacion} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.bono_semanal ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {fmtCurrency(row.monto)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {fmtCurrency(row.bono_colectivo)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="tabular-nums text-sm font-bold text-foreground">
                        {fmtCurrency(row.bono_total)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

// ── Modal 1: Tiempo Fuera de Área ─────────────────────────────────────────────

type TiempoFueraForm = {
  fecha: Date | undefined
  iddisenadora: string
  area_foranea: string
  tiempo_af: string
  comentarios: string
}

const INITIAL_TIEMPO_FUERA: TiempoFueraForm = {
  fecha: undefined,
  iddisenadora: "",
  area_foranea: "",
  tiempo_af: "",
  comentarios: "",
}

function TiempoFueraDialog({
  open, onOpenChange, disenadoras, loadingCatalogs,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  disenadoras: Catalog[]
  loadingCatalogs: boolean
}) {
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<TiempoFueraForm>({ ...INITIAL_TIEMPO_FUERA })

  useEffect(() => { if (!open) setForm({ ...INITIAL_TIEMPO_FUERA }) }, [open])

  const set = <K extends keyof TiempoFueraForm>(k: K, v: TiempoFueraForm[K]) =>
    setForm((p) => ({ ...p, [k]: v }))

  const handleSubmit = async () => {
    if (!form.fecha) { toast.error("Campo requerido", { description: "Selecciona una fecha." }); return }
    if (!form.iddisenadora) { toast.error("Campo requerido", { description: "Selecciona una diseñadora." }); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSubmitting(true)
    try {
      const { error } = await supabase.from("tiempos_fuera_area").insert({
        idempresa: IDEMPRESA,
        fecha: format(form.fecha, "yyyy-MM-dd"),
        iddisenadora: Number(form.iddisenadora),
        area_foranea: form.area_foranea.trim() || null,
        tiempo_af: form.tiempo_af ? Number(form.tiempo_af) : null,
        comentarios: form.comentarios.trim() || null,
      })
      if (error) { console.error("[v0] tiempo_fuera:", error); toast.error("No se pudo registrar", { description: error.message }); return }
      toast.success("Tiempo fuera de área registrado.")
      onOpenChange(false)
    } finally { setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-200">
              <MapPin className="size-4 text-amber-600" />
            </div>
            <div>
              <DialogTitle>Registrar Tiempo Fuera de Área</DialogTitle>
              <DialogDescription>La semana se calculará automáticamente desde la fecha.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormRow label="Fecha" required>
            <DatePicker value={form.fecha} onChange={(d) => set("fecha", d)} />
          </FormRow>
          <FormRow label="Diseñadora" required>
            <CatalogSelect
              value={form.iddisenadora}
              onValueChange={(v) => set("iddisenadora", v)}
              items={disenadoras}
              loading={loadingCatalogs}
              placeholder="Selecciona una diseñadora"
            />
          </FormRow>
          <FormRow label="Área Foránea">
            <Input placeholder="Nombre del área o departamento" value={form.area_foranea} onChange={(e) => set("area_foranea", e.target.value)} />
          </FormRow>
          <FormRow label="Tiempo en AF (horas)">
            <Input type="number" min={0} step={0.5} placeholder="0.0" value={form.tiempo_af} onChange={(e) => set("tiempo_af", e.target.value)} className="w-32" />
          </FormRow>
          <FormRow label="Comentarios">
            <Textarea rows={3} placeholder="Observaciones opcionales…" value={form.comentarios} onChange={(e) => set("comentarios", e.target.value)} className="resize-none" />
          </FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-amber-600 hover:bg-amber-700 text-white">
            {submitting ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Modal 2: Vacaciones o Permisos ────────────────────────────────────────────

type AusentismoForm = {
  fecha_inicio: Date | undefined
  iddisenadora: string
  tipo_ausentismo: string
  dias: string
  horas_manuales: string
  comentarios: string
}

const INITIAL_AUSENTISMO: AusentismoForm = {
  fecha_inicio: undefined,
  iddisenadora: "",
  tipo_ausentismo: "",
  dias: "",
  horas_manuales: "",
  comentarios: "",
}

function AusentismoDialog({
  open, onOpenChange, disenadoras, tiposAusentismos, loadingCatalogs,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  disenadoras: Catalog[]
  tiposAusentismos: Catalog[]
  loadingCatalogs: boolean
}) {
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<AusentismoForm>({ ...INITIAL_AUSENTISMO })

  useEffect(() => { if (!open) setForm({ ...INITIAL_AUSENTISMO }) }, [open])

  const set = <K extends keyof AusentismoForm>(k: K, v: AusentismoForm[K]) =>
    setForm((p) => ({ ...p, [k]: v }))

  const tipoLower = form.tipo_ausentismo.toLowerCase()
  const showDias = tipoLower.includes("vacacion")
  const showHorasManuales = tipoLower.includes("permiso")

  const handleSubmit = async () => {
    if (!form.fecha_inicio) { toast.error("Campo requerido", { description: "Selecciona la fecha de inicio." }); return }
    if (!form.iddisenadora) { toast.error("Campo requerido", { description: "Selecciona una diseñadora." }); return }
    if (!form.tipo_ausentismo) { toast.error("Campo requerido", { description: "Selecciona el tipo de ausentismo." }); return }
    if (showDias && !form.dias) { toast.error("Campo requerido", { description: "Ingresa los días de vacaciones." }); return }
    if (showHorasManuales && !form.horas_manuales) { toast.error("Campo requerido", { description: "Ingresa las horas del permiso." }); return }

    const supabase = getSupabase()
    if (!supabase) return
    setSubmitting(true)
    try {
      const { data, error } = await supabase
        .from("vacaciones_permisos")
        .insert({
          idempresa: IDEMPRESA,
          fecha_inicio: format(form.fecha_inicio, "yyyy-MM-dd"),
          iddisenadora: Number(form.iddisenadora),
          tipo_ausentismo: form.tipo_ausentismo,
          dias: showDias && form.dias ? Number(form.dias) : null,
          horas_manuales: showHorasManuales && form.horas_manuales ? Number(form.horas_manuales) : null,
          comentarios: form.comentarios.trim() || null,
        })
        .select("*")
        .single()
      if (error) { console.error("[v0] ausentismo:", error); toast.error("No se pudo registrar", { description: error.message }); return }
      const row = data as Record<string, unknown>
      toast.success("Ausentismo registrado.", { description: `Horas totales calculadas: ${row.horas_totales ?? "—"} h` })
      onOpenChange(false)
    } finally { setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 ring-1 ring-rose-200">
              <UserMinus className="size-4 text-rose-600" />
            </div>
            <div>
              <DialogTitle>Registrar Vacaciones o Permiso</DialogTitle>
              <DialogDescription>La semana y horas totales se calculan automáticamente.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormRow label="Fecha de Inicio" required>
            <DatePicker value={form.fecha_inicio} onChange={(d) => set("fecha_inicio", d)} />
          </FormRow>
          <FormRow label="Diseñadora" required>
            <CatalogSelect value={form.iddisenadora} onValueChange={(v) => set("iddisenadora", v)} items={disenadoras} loading={loadingCatalogs} placeholder="Selecciona una diseñadora" />
          </FormRow>
          <FormRow label="Tipo de Ausentismo" required>
            <CatalogSelect
              value={form.tipo_ausentismo}
              onValueChange={(v) => setForm((p) => ({ ...p, tipo_ausentismo: v, dias: "", horas_manuales: "" }))}
              items={tiposAusentismos}
              loading={loadingCatalogs}
              placeholder="Selecciona un tipo"
              useNombre
            />
          </FormRow>
          {showDias && (
            <FormRow label="Días de Vacaciones" required>
              <Input type="number" min={1} placeholder="Nº de días" value={form.dias} onChange={(e) => set("dias", e.target.value)} className="w-36" />
            </FormRow>
          )}
          {showHorasManuales && (
            <FormRow label="Horas del Permiso" required>
              <Input type="number" min={0} step={0.5} placeholder="0.0" value={form.horas_manuales} onChange={(e) => set("horas_manuales", e.target.value)} className="w-36" />
            </FormRow>
          )}
          <FormRow label="Comentarios">
            <Textarea rows={3} placeholder="Observaciones opcionales…" value={form.comentarios} onChange={(e) => set("comentarios", e.target.value)} className="resize-none" />
          </FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-rose-600 hover:bg-rose-700 text-white">
            {submitting ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── EvalSheet ──────────────────────────────────────────────────────────────────

type EvalSheetProps = {
  record: DisenoProgramacion | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: (record: DisenoProgramacion) => void
}

function EvalSheet({ record, open, onOpenChange, onUpdated }: EvalSheetProps) {
  const [submitting, setSubmitting] = useState(false)
  const [costureras, setCostureras] = useState<Catalog[]>([])
  const [loadingCostureras, setLoadingCostureras] = useState(false)
  const [form, setForm] = useState({
    cumplimientoDiseno: false,
    cumplimientoCostura: false,
    rechazoOrden: false,
    idcosturera: "__none__",
    comentarios: "",
  })

  // Carga catálogo de costureras al abrir el sheet
  useEffect(() => {
    if (!open) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoadingCostureras(true)
    supabase
      .from("costureras")
      .select("id, nombre")
      .eq("idempresa", IDEMPRESA)
      .order("nombre")
      .then(({ data }) => {
        setCostureras((data ?? []) as Catalog[])
        setLoadingCostureras(false)
      })
  }, [open])

  // Sincroniza form con el registro seleccionado
  useEffect(() => {
    if (record) setForm({
      cumplimientoDiseno: record.cumplimiento_diseno ?? false,
      cumplimientoCostura: record.cumplimiento_costura ?? false,
      rechazoOrden: record.rechazo_orden ?? false,
      idcosturera: record.idcosturera ? String(record.idcosturera) : "__none__",
      comentarios: record.comentarios ?? "",
    })
  }, [record])

  const handleSubmit = async () => {
    if (!record) return
    const supabase = getSupabase()
    if (!supabase) return
    setSubmitting(true)
    try {
      const { data, error } = await supabase
        .from("diseno_programacion")
        .update({
          cumplimiento_diseno: form.cumplimientoDiseno,
          cumplimiento_costura: form.cumplimientoCostura,
          rechazo_orden: form.rechazoOrden,
          idcosturera: form.idcosturera && form.idcosturera !== "__none__" ? Number(form.idcosturera) : null,
          comentarios: form.comentarios.trim() || null,
        })
        .eq("id", record.id)
        .eq("idempresa", IDEMPRESA)
        .select("*, disenadoras(nombre), costureras(nombre)")
        .single()
      if (error) { console.error("[v0] eval update:", error); toast.error("No se pudo guardar", { description: error.message }); return }
      const updated = data as DisenoProgramacion
      toast.success("Evaluación guardada", { description: `Diseño: ${fmtH(updated.horas_diseno_cumplidas)} h · Costura: ${fmtH(updated.horas_costura_cumplidas)} h cumplidas` })
      onUpdated(updated)
      onOpenChange(false)
    } finally { setSubmitting(false) }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border bg-muted/30 p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 ring-1 ring-indigo-200">
              <ClipboardCheck className="size-4 text-indigo-600" />
            </div>
            <div>
              <SheetTitle className="text-base">Evaluar Orden</SheetTitle>
              <SheetDescription>Folio: <span className="font-mono font-medium">{record?.folio ?? "—"}</span></SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos de la Orden</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <ReadField label="Folio" value={record?.folio} mono />
              <ReadField label="Modelo" value={record?.modelo} />
              <div><dt className="text-xs text-muted-foreground">Plan Diseño</dt><dd className="mt-0.5 tabular-nums font-semibold text-indigo-700">{fmtH(record?.horas_plan_diseno)} h</dd></div>
              <div><dt className="text-xs text-muted-foreground">Plan Costura</dt><dd className="mt-0.5 tabular-nums font-semibold text-violet-700">{fmtH(record?.horas_plan_costura)} h</dd></div>
            </dl>
          </div>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cumplimiento</p>
            <div className="space-y-2">
              <EvalCheck id="ev-diseno" label="Cumplimiento Diseño" checked={form.cumplimientoDiseno} onCheckedChange={(v) => setForm((p) => ({ ...p, cumplimientoDiseno: v }))} color="emerald" />
              <EvalCheck id="ev-costura" label="Cumplimiento Costura" checked={form.cumplimientoCostura} onCheckedChange={(v) => setForm((p) => ({ ...p, cumplimientoCostura: v }))} color="emerald" />
              <EvalCheck id="ev-rechazo" label="Rechazo de Orden" checked={form.rechazoOrden} onCheckedChange={(v) => setForm((p) => ({ ...p, rechazoOrden: v }))} color="red" />
            </div>
          </section>
          {/* Costurera */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Asignación</p>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-costurera" className="text-sm font-medium">Costurera</Label>
              <Select
                value={form.idcosturera}
                onValueChange={(v) => setForm((p) => ({ ...p, idcosturera: v }))}
                disabled={loadingCostureras}
              >
                <SelectTrigger id="ev-costurera">
                  {loadingCostureras
                    ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Cargando…</span>
                    : <SelectValue placeholder="Sin asignar (opcional)" />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Sin asignar</span>
                  </SelectItem>
                  {costureras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="ev-comentarios" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comentarios / Novedades</Label>
            <Textarea id="ev-comentarios" rows={3} placeholder="Observaciones opcionales…" value={form.comentarios} onChange={(e) => setForm((p) => ({ ...p, comentarios: e.target.value }))} className="resize-none" />
          </section>
        </div>
        <SheetFooter className="border-t border-border bg-muted/30 p-4 sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {submitting ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar Evaluación"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Helpers de UI ──────────────────────────────────────────────────────────────

function DatePicker({ value, onChange }: { value: Date | undefined; onChange: (d: Date | undefined) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("w-full justify-start gap-2 font-normal", !value && "text-muted-foreground")}>
          <CalendarIcon className="size-4" />
          {value ? format(value, "PPP", { locale: es }) : "Seleccionar fecha"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={onChange} locale={es} initialFocus />
      </PopoverContent>
    </Popover>
  )
}

function CatalogSelect({
  value, onValueChange, items, loading, placeholder, useNombre = false,
}: {
  value: string
  onValueChange: (v: string) => void
  items: Catalog[]
  loading: boolean
  placeholder: string
  useNombre?: boolean
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={loading}>
      <SelectTrigger>
        {loading
          ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Cargando…</span>
          : <SelectValue placeholder={placeholder} />}
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={useNombre ? item.nombre : String(item.id)}>
            {item.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm font-medium">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  )
}

function KpiCard({ label, value, icon, iconBg, iconColor, valueColor }: {
  label: string; value: number; icon: React.ReactNode
  iconBg: string; iconColor: string; valueColor: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg ring-1", iconBg, iconColor)}>{icon}</div>
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", valueColor)}>
        {value.toFixed(1)}<span className="ml-1 text-sm font-normal text-muted-foreground">h</span>
      </p>
    </div>
  )
}

function EficienciaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground tabular-nums">—</span>
  const cls = pct > 80 ? "text-emerald-700 font-semibold" : pct > 70 ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"
  return <span className={cn("tabular-nums text-sm", cls)}>{pct.toFixed(1)}%</span>
}

function CriterioBadge({ criterio }: { criterio: string | null }) {
  if (!criterio) return <span className="text-muted-foreground">—</span>
  const isSi = /^s[íi]?$/i.test(criterio.trim())
  return (
    <span className={cn(
      "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
      isSi ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-red-200 bg-red-100 text-red-700",
    )}>
      {criterio}
    </span>
  )
}

function StatusBadge({ row }: { row: DisenoProgramacion }) {
  if (row.rechazo_orden) return <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><XCircle className="size-3" />Rechazado</span>
  if (row.cumplimiento_diseno && row.cumplimiento_costura) return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-3" />Completo</span>
  if (row.cumplimiento_diseno) return <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"><CheckCircle2 className="size-3" />Diseño OK</span>
  if (row.cumplimiento_costura) return <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700"><CheckCircle2 className="size-3" />Costura OK</span>
  return <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"><Clock className="size-3" />Pendiente</span>
}

function EvalCheck({ id, label, checked, onCheckedChange, color }: { id: string; label: string; checked: boolean; onCheckedChange: (v: boolean) => void; color: "emerald" | "red" }) {
  return (
    <div
      className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
        checked && color === "emerald" && "border-emerald-300 bg-emerald-50",
        checked && color === "red" && "border-red-300 bg-red-50",
        !checked && "border-border bg-background hover:bg-muted/40",
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(Boolean(v))}
        className={cn(
          color === "emerald" && "data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600",
          color === "red" && "data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600",
        )}
      />
      <Label htmlFor={id} className={cn("cursor-pointer select-none text-sm font-medium",
        checked && color === "emerald" && "text-emerald-800",
        checked && color === "red" && "text-red-800",
        !checked && "text-foreground",
      )}>{label}</Label>
    </div>
  )
}

function ReadField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm font-medium", mono && "font-mono text-xs")}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  )
}

function fmtH(h: number | null | undefined): string {
  if (h == null) return "—"
  return h.toFixed(1)
}

// ── Tab 3: Hoja de Impresión ──────────────────────────────────────────────────

function HojaImpresionTab({ configMissing }: { configMissing: boolean }) {
  const [rows, setRows] = useState<HojaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string>("")

  const fetchRows = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from("diseno_programacion")
      .select(
        "id, fecha, semana, modelo, familia, categoria, cliente, tipo, numero_muestras, disenadoras(nombre), costureras(nombre), horas_diseno_cumplidas, horas_costura_cumplidas, horas_totales_cumplidas",
      )
      .eq("idempresa", IDEMPRESA)
      .order("fecha", { ascending: false })
    if (e) { console.error("[v0] hoja fetch:", e); setError(e.message) }
    else setRows((data ?? []) as unknown as HojaRow[])
    setLoading(false)
  }, [configMissing])

  useEffect(() => { fetchRows() }, [fetchRows])

  // Semanas únicas en orden descendente
  const weeks = useMemo(
    () => [...new Set(rows.map((r) => r.semana).filter((w): w is number => w != null))].sort((a, b) => b - a),
    [rows],
  )

  useEffect(() => {
    if (weeks.length === 0) return
    setSelectedWeek((prev) => prev || String(weeks[0]))
  }, [weeks])

  const filteredRows = useMemo(
    () => (selectedWeek ? rows.filter((r) => String(r.semana) === selectedWeek) : rows),
    [rows, selectedWeek],
  )

  // ── Exportar a Excel ─────────────────────────────────────────────────────────
  const handleExport = () => {
    if (filteredRows.length === 0) {
      toast.warning("Sin datos para exportar en la semana seleccionada.")
      return
    }

    const sheetData = filteredRows.map((r) => ({
      "id": r.id,
      "Fecha": r.fecha ?? "",
      "Modelo": r.modelo ?? "",
      "Familia": r.familia ?? "",
      "Categoría": r.categoria ?? "",
      "Cliente": r.cliente ?? "",
      "Tipo": r.tipo ?? "",
      "Número de Muestras": r.numero_muestras ?? "",
      "Diseñadora": r.disenadoras?.nombre ?? "",
      "Costurera": r.costureras?.nombre ?? "",
      "Horas Diseño Cumplidas": r.horas_diseno_cumplidas ?? "",
      "Horas Costura Cumplidas": r.horas_costura_cumplidas ?? "",
      "Horas Totales Cumplidas": r.horas_totales_cumplidas ?? "",
    }))

    const ws = XLSX.utils.json_to_sheet(sheetData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Hoja de Impresión")
    XLSX.writeFile(wb, `Hoja_Impresion_Semana_${selectedWeek || "todas"}.xlsx`)
    toast.success(`Archivo exportado: Hoja_Impresion_Semana_${selectedWeek}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Select
            value={selectedWeek}
            onValueChange={setSelectedWeek}
            disabled={loading || weeks.length === 0}
          >
            <SelectTrigger className="w-36 bg-transparent">
              <SelectValue placeholder="Semana…" />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Semana {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRows}
            disabled={loading || configMissing}
            className="gap-2 bg-transparent"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Actualizar
          </Button>
        </div>

        <Button
          onClick={handleExport}
          disabled={loading || filteredRows.length === 0}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Download className="size-4" />
          Exportar a Excel
          {filteredRows.length > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs tabular-nums">
              {filteredRows.length}
            </span>
          )}
        </Button>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">ID</TableHead>
                <TableHead className="font-semibold">Fecha</TableHead>
                <TableHead className="font-semibold">Modelo</TableHead>
                <TableHead className="font-semibold">Familia</TableHead>
                <TableHead className="font-semibold">Categoría</TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                <TableHead className="font-semibold">Tipo</TableHead>
                <TableHead className="font-semibold text-right">Muestras</TableHead>
                <TableHead className="font-semibold">Diseñadora</TableHead>
                <TableHead className="font-semibold">Costurera</TableHead>
                <TableHead className="font-semibold text-right">Hrs Diseño</TableHead>
                <TableHead className="font-semibold text-right">Hrs Costura</TableHead>
                <TableHead className="font-semibold text-right">Hrs Totales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 13 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-24 text-center text-destructive">
                    <AlertCircle className="inline size-4 mr-1.5 align-text-bottom" />
                    {error}
                  </TableCell>
                </TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-32 text-center text-muted-foreground">
                    {rows.length === 0
                      ? "Sin registros de programación de diseño."
                      : "Sin registros para la semana seleccionada."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    <TableCell className="tabular-nums text-xs text-muted-foreground">{row.id}</TableCell>
                    <TableCell className="text-sm tabular-nums">{row.fecha ?? "—"}</TableCell>
                    <TableCell className="text-sm font-medium">{row.modelo ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.familia ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.categoria ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.cliente ?? "—"}</TableCell>
                    <TableCell>
                      {row.tipo ? (
                        <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                          {row.tipo}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{row.numero_muestras ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.disenadoras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{row.costureras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-indigo-700 font-medium">
                      {row.horas_diseno_cumplidas != null ? `${row.horas_diseno_cumplidas.toFixed(1)} h` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-violet-700 font-medium">
                      {row.horas_costura_cumplidas != null ? `${row.horas_costura_cumplidas.toFixed(1)} h` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-bold text-foreground">
                      {row.horas_totales_cumplidas != null ? `${row.horas_totales_cumplidas.toFixed(1)} h` : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Nota informativa sobre la exportación */}
      {filteredRows.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileSpreadsheet className="size-3.5" />
          {filteredRows.length} registro(s) listos para exportar · Semana {selectedWeek}
        </p>
      )}
    </div>
  )
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—"
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

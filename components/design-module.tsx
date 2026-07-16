"use client"

import { Fragment, useEffect, useState, useMemo, useCallback } from "react"
import { getISOWeek, format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ClipboardCheck,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Scissors,
  Pencil,
  CalendarIcon,
  MapPin,
  UserMinus,
  Download,
  FileSpreadsheet,
  Trash2,
  MoreHorizontal,
  CalendarClock,
  X,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { DisenoMultipliersDialog } from "@/components/diseno-multipliers-dialog"
import {
  useDisenoMultiplierCatalogs,
  PlanDisenoDesglosePopover,
  type DisenoMultiplierCats,
} from "@/components/diseno-plan-desglose"

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
  fecha_aprobacion_diseno?: string | null
  // adiciones al proceso
  muchas_operaciones?: boolean | null
  telas_pesadas?: boolean | null
  muchas_habilitaciones?: boolean | null
  prenda_compleja?: boolean | null
  // costura calc
  idprenda?: number | null
  categoria_demografica?: string | null
  tipo_tela?: string | null
  trazos?: number | null
  comp_combinacion?: boolean | null
  comp_entretela?: boolean | null
  comp_poquetin?: boolean | null
  comp_forro?: boolean | null
  disenadoras: { nombre: string } | null
  costureras: { nombre: string } | null
}

type VwBonosDiseno = {
  nombre: string | null
  tipo_personal: string | null
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
  const [filterFolio, setFilterFolio] = useState("")
  const [filterModelo, setFilterModelo] = useState("")
  const [filterDisenadora, setFilterDisenadora] = useState("__all__")
  const [filterCosturera, setFilterCosturera] = useState("__all__")
  const [filterFamilia, setFilterFamilia] = useState("__all__")
  const [filterCategoria, setFilterCategoria] = useState("__all__")
  const [filterEstado, setFilterEstado] = useState("__all__")
  const [multipliersOpen, setMultipliersOpen] = useState(false)

  // Catálogos de multiplicadores de diseño (para el popover de desglose en Programación)
  const disMultCats = useDisenoMultiplierCatalogs(configMissing)

  // Restaurar filtros guardados al montar
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("design:filters")
      if (!raw) return
      const f = JSON.parse(raw) as Record<string, string>
      if (f.filterFolio      !== undefined) setFilterFolio(f.filterFolio)
      if (f.filterModelo     !== undefined) setFilterModelo(f.filterModelo)
      if (f.filterDisenadora !== undefined) setFilterDisenadora(f.filterDisenadora)
      if (f.filterCosturera  !== undefined) setFilterCosturera(f.filterCosturera)
      if (f.filterFamilia    !== undefined) setFilterFamilia(f.filterFamilia)
      if (f.filterCategoria  !== undefined) setFilterCategoria(f.filterCategoria)
      if (f.filterEstado     !== undefined) setFilterEstado(f.filterEstado)
    } catch { /* sessionStorage no disponible o JSON inválido */ }
  }, [])

  // Persistir filtros cuando cambian
  useEffect(() => {
    try {
      sessionStorage.setItem("design:filters", JSON.stringify({
        filterFolio, filterModelo, filterDisenadora,
        filterCosturera, filterFamilia, filterCategoria, filterEstado,
      }))
    } catch { /* ignorar */ }
  }, [filterFolio, filterModelo, filterDisenadora, filterCosturera, filterFamilia, filterCategoria, filterEstado])

  // Catálogos compartidos
  const [disenadoras, setDisenadoras] = useState<Catalog[]>([])
  const [costureras, setCostureraCatalog] = useState<Catalog[]>([])
  const [tiposAusentismos, setTiposAusentismos] = useState<Catalog[]>([])
  const [loadingCatalogs, setLoadingCatalogs] = useState(false)

  // Modales
  const [evalRecord, setEvalRecord] = useState<DisenoProgramacion | null>(null)
  const [evalOpen, setEvalOpen] = useState(false)
  const [reprogramarRecord, setReprogramarRecord] = useState<DisenoProgramacion | null>(null)
  const [reprogramarOpen, setReprogramarOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DisenoProgramacion | null>(null)

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
        if (filterFolio.trim()) {
          const q = filterFolio.trim().toLowerCase()
          if (!(r.folio ?? "").toLowerCase().includes(q)) return false
        }
        if (filterModelo.trim()) {
          const q = filterModelo.trim().toLowerCase()
          if (!(r.modelo ?? "").toLowerCase().includes(q)) return false
        }
        if (filterDisenadora !== "__all__" && String(r.iddisenadora ?? "") !== filterDisenadora) return false
        if (filterCosturera !== "__all__" && String(r.idcosturera ?? "") !== filterCosturera) return false
        if (filterFamilia !== "__all__" && r.familia !== filterFamilia) return false
        if (filterCategoria !== "__all__" && r.categoria !== filterCategoria) return false
        if (filterEstado !== "__all__" && getStatusKey(r) !== filterEstado) return false
        return true
      }),
    [records, selectedWeek, selectedMonth, filterFolio, filterModelo, filterDisenadora, filterCosturera, filterFamilia, filterCategoria, filterEstado],
  )

  const familiaOptions = useMemo(
    () => [...new Set(records.map((r) => r.familia).filter((f): f is string => !!f))].sort(),
    [records],
  )

  const categoriaOptions = useMemo(
    () => [...new Set(records.map((r) => r.categoria).filter((c): c is string => !!c))].sort(),
    [records],
  )

  const hasActiveFilters =
    filterFolio.trim() !== "" ||
    filterModelo.trim() !== "" ||
    filterDisenadora !== "__all__" ||
    filterCosturera !== "__all__" ||
    filterFamilia !== "__all__" ||
    filterCategoria !== "__all__" ||
    filterEstado !== "__all__"

  const clearFilters = () => {
    setFilterFolio("")
    setFilterModelo("")
    setFilterDisenadora("__all__")
    setFilterCosturera("__all__")
    setFilterFamilia("__all__")
    setFilterCategoria("__all__")
    setFilterEstado("__all__")
    try { sessionStorage.removeItem("design:filters") } catch { /* ignorar */ }
  }

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

    if (e) {
      console.error("[v0] diseno fetch:", e)
      setError(e.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as DisenoProgramacion[]

    // Enriquecer con fecha_aprobacion_diseno desde ordenes_produccion por folio
    const folios = [...new Set(rows.map((r) => r.folio).filter((f): f is string => !!f))]
    const aprobMap = new Map<string, string | null>()

    if (folios.length > 0) {
      const { data: aprobData } = await supabase
        .from("ordenes_produccion")
        .select("folio, fecha_aprobacion_diseno")
        .in("folio", folios)
        .eq("idempresa", IDEMPRESA)

      for (const a of (aprobData ?? []) as {
        folio: string
        fecha_aprobacion_diseno: string | null
      }[]) {
        if (a.folio) aprobMap.set(a.folio, a.fecha_aprobacion_diseno ?? null)
      }
    }

    setRecords(rows.map((r) => ({
      ...r,
      fecha_aprobacion_diseno: r.folio ? (aprobMap.get(r.folio) ?? null) : null,
    })))
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
      supabase.from("costureras").select("id, nombre").eq("idempresa", IDEMPRESA).order("nombre"),
    ]).then(([d, t, c]) => {
      if (!d.error) setDisenadoras((d.data ?? []) as Catalog[])
      if (!t.error) setTiposAusentismos((t.data ?? []) as Catalog[])
      if (!c.error) setCostureraCatalog((c.data ?? []) as Catalog[])
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

  const handleDisenadoraChange = useCallback(
    (recordId: number, iddisenadora: number | null, nombre: string | null) => {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === recordId
            ? { ...r, iddisenadora, disenadoras: nombre ? { nombre } : null }
            : r,
        ),
      )
    },
    [],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("diseno_programacion")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("idempresa", IDEMPRESA)
    if (error) {
      toast.error("No se pudo eliminar", { description: error.message })
    } else {
      setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      toast.success("Registro de diseño eliminado.")
    }
    setDeleteTarget(null)
  }, [deleteTarget])

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
          <TabsTrigger value="tiempos-fuera" className="flex-1 sm:flex-none">
            Tiempos Fuera
          </TabsTrigger>
          <TabsTrigger value="vacaciones" className="flex-1 sm:flex-none">
            Vacaciones / Permisos
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Seguimiento Semanal ── */}
        <TabsContent value="seguimiento" className="space-y-5 mt-0">
          {/* Toolbar */}
          <div className="flex flex-col gap-2">
            {/* Fila 1: búsqueda + fechas + actualizar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar folio…"
                  value={filterFolio}
                  onChange={(e) => setFilterFolio(e.target.value)}
                  className="h-9 pl-8 pr-8 text-sm"
                />
                {filterFolio && (
                  <button
                    type="button"
                    onClick={() => setFilterFolio("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="relative min-w-[180px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar modelo…"
                  value={filterModelo}
                  onChange={(e) => setFilterModelo(e.target.value)}
                  className="h-9 pl-8 pr-8 text-sm"
                />
                {filterModelo && (
                  <button
                    type="button"
                    onClick={() => setFilterModelo("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
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
                onClick={() => setMultipliersOpen(true)}
                className="gap-1.5 bg-transparent"
              >
                <SlidersHorizontal className="size-3.5" />
                Multiplicadores
              </Button>
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

            {/* Fila 2: filtros de entidad */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filterDisenadora} onValueChange={setFilterDisenadora} disabled={loadingCatalogs}>
                <SelectTrigger className="h-8 w-44 bg-transparent text-xs">
                  <SelectValue placeholder="Diseñadora" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las diseñadoras</SelectItem>
                  {disenadoras.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterCosturera} onValueChange={setFilterCosturera} disabled={loadingCatalogs}>
                <SelectTrigger className="h-8 w-44 bg-transparent text-xs">
                  <SelectValue placeholder="Costurera" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las costureras</SelectItem>
                  {costureras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterFamilia} onValueChange={setFilterFamilia}>
                <SelectTrigger className="h-8 w-36 bg-transparent text-xs">
                  <SelectValue placeholder="Familia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las familias</SelectItem>
                  {familiaOptions.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                <SelectTrigger className="h-8 w-36 bg-transparent text-xs">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las categorías</SelectItem>
                  {categoriaOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterEstado} onValueChange={setFilterEstado}>
                <SelectTrigger className="h-8 w-36 bg-transparent text-xs">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los estados</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="diseno_ok">Diseño OK</SelectItem>
                  <SelectItem value="costura_ok">Costura OK</SelectItem>
                  <SelectItem value="completo">Completo</SelectItem>
                  <SelectItem value="rechazado">Rechazado</SelectItem>
                </SelectContent>
              </Select>

              <div className="ml-auto flex items-center gap-2">
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" /> Limpiar filtros
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {filteredRecords.length} de {records.length}
                </span>
              </div>
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
                    <TableHead className="font-semibold text-right">Semana</TableHead>
                    <TableHead className="font-semibold text-right">Sem. Orig.</TableHead>
                    <TableHead className="font-semibold">Familia</TableHead>
                    <TableHead className="font-semibold">Tipo Tela</TableHead>
                    <TableHead className="font-semibold">Categoría</TableHead>
                    <TableHead className="font-semibold">Tipo</TableHead>
                    <TableHead className="font-semibold">Diseñadora</TableHead>
                    <TableHead className="font-semibold text-right">Plan Diseño</TableHead>
                    <TableHead className="font-semibold">Costurera</TableHead>
                    <TableHead className="font-semibold text-right">Plan Costura</TableHead>
                    <TableHead className="font-semibold">Aprobación Cliente</TableHead>
                    <TableHead className="font-semibold">Estatus</TableHead>
                    <TableHead className="font-semibold text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 14 }).map((__, j) => (
                          <TableCell key={j}><Skeleton className="h-4 rounded" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : error ? (
                    <TableRow>
                      <TableCell colSpan={14} className="h-24 text-center text-destructive">
                        <AlertCircle className="inline size-4 mr-1.5 align-text-bottom" />
                        {error}
                      </TableCell>
                    </TableRow>
                  ) : filteredRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="h-32 text-center text-muted-foreground">
                        {records.length === 0
                          ? "Sin registros en diseño."
                          : "Sin registros para los filtros seleccionados."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecords.map((row) => (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell>
                          <p className="font-mono text-xs font-semibold text-foreground">{row.folio ?? "—"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{row.modelo ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {row.semana ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {row.semana_original ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.familia ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.tipo_tela ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.categoria ?? "—"}</TableCell>
                        <TableCell>
                          {row.tipo
                            ? <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">{row.tipo}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm min-w-[140px]">
                          <DisenadoraCell
                            recordId={row.id}
                            value={row.iddisenadora}
                            disenadoras={disenadoras}
                            onSave={(id, nombre) => handleDisenadoraChange(row.id, id, nombre)}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          <PlanDisenoDesglosePopover row={row} cats={disMultCats} />
                          <span className="text-muted-foreground text-xs font-normal"> h</span>
                        </TableCell>
                        <TableCell className="text-sm">{row.costureras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium text-violet-700">
                          {fmtH(row.horas_plan_costura)} <span className="text-muted-foreground text-xs font-normal">h</span>
                        </TableCell>
                        <TableCell><AprobacionBadge fecha={row.fecha_aprobacion_diseno} /></TableCell>
                        <TableCell><StatusBadge row={row} /></TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="size-8 p-0">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEvalRecord(row); setEvalOpen(true) }}>
                                <ClipboardCheck className="size-4" />
                                Evaluar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setReprogramarRecord(row); setReprogramarOpen(true) }}>
                                <CalendarClock className="size-4" />
                                Reprogramar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(row)}
                              >
                                <Trash2 className="size-4" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

        {/* ── Tab 4: Historial Tiempos Fuera ── */}
        <TabsContent value="tiempos-fuera" className="mt-0">
          <TiemposFueraTab
            disenadoras={disenadoras}
            costureras={costureras}
            loadingCatalogs={loadingCatalogs}
            configMissing={configMissing}
          />
        </TabsContent>

        {/* ── Tab 5: Historial Vacaciones / Permisos ── */}
        <TabsContent value="vacaciones" className="mt-0">
          <VacacionesPermisosTab
            disenadoras={disenadoras}
            costureras={costureras}
            tiposAusentismos={tiposAusentismos}
            loadingCatalogs={loadingCatalogs}
            configMissing={configMissing}
          />
        </TabsContent>
      </Tabs>

      {/* Modales — fuera del árbol de Tabs para evitar problemas de z-index */}
      <DisenoMultipliersDialog
        open={multipliersOpen}
        onOpenChange={setMultipliersOpen}
      />

      <ReprogramarDialog
        record={reprogramarRecord}
        open={reprogramarOpen}
        onOpenChange={(o) => { setReprogramarOpen(o); if (!o) setReprogramarRecord(null) }}
        onReprogramado={handleRecordUpdated}
        onRefresh={fetchRecords}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar registro de diseño?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente el registro del folio{" "}
              <span className="font-mono font-medium">{deleteTarget?.folio ?? ""}</span>.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={handleConfirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EvalSheet
        record={evalRecord}
        open={evalOpen}
        onOpenChange={(o) => { setEvalOpen(o); if (!o) setEvalRecord(null) }}
        onUpdated={handleRecordUpdated}
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, DesignFolioRow[]>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const disMultCats = useDisenoMultiplierCatalogs(configMissing)

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

  const toggleExpand = useCallback(async (row: VwBonosDiseno) => {
    if (row.semana == null || !row.nombre || !row.tipo_personal) return
    const key = `${row.nombre}-${row.tipo_personal}-${row.semana}`
    if (expandedKey === key) { setExpandedKey(null); return }
    setExpandedKey(key)
    if (detailCache[key]) return
    setLoadingDetail(key)
    const supabase = getSupabase()
    if (!supabase) { setLoadingDetail(null); return }

    // Paso 1: obtener el id de la persona por nombre
    const table = row.tipo_personal === "Diseño" ? "disenadoras" : "costureras"
    const { data: persons } = await supabase.from(table).select("id").eq("nombre", row.nombre).limit(1)
    const personId = (persons as { id: number }[] | null)?.[0]?.id
    if (!personId) { setDetailCache((prev) => ({ ...prev, [key]: [] })); setLoadingDetail(null); return }

    // Paso 2: traer los folios de la semana para esa persona
    const field = row.tipo_personal === "Diseño" ? "iddisenadora" : "idcosturera"
    const { data } = await supabase
      .from("diseno_programacion")
      .select("folio, modelo, familia, cliente, horas_plan_diseno, cumplimiento_diseno, cumplimiento_costura, horas_diseno_cumplidas, horas_costura_cumplidas, idprenda, tipo, categoria_demografica, muchas_operaciones, telas_pesadas, muchas_habilitaciones, prenda_compleja")
      .eq("idempresa", IDEMPRESA)
      .eq("semana", row.semana)
      .eq(field, personId)
      .order("folio")
    setDetailCache((prev) => ({ ...prev, [key]: (data as DesignFolioRow[]) ?? [] }))
    setLoadingDetail(null)
  }, [expandedKey, detailCache])

  const recalcularHorasDiseno = useCallback(async () => {
    if (configMissing || disMultCats.prendas.length === 0) return
    const supabase = getSupabase()
    if (!supabase) return
    setRecalculating(true)
    try {
      const { data, error } = await supabase
        .from("diseno_programacion")
        .select("id, idprenda, tipo, categoria_demografica, muchas_operaciones, telas_pesadas, muchas_habilitaciones, prenda_compleja, cumplimiento_diseno")
        .eq("idempresa", IDEMPRESA)
        .not("idprenda", "is", null)
      if (error) { toast.error("Error al obtener registros", { description: error.message }); return }
      const rows = (data ?? []) as { id: number; idprenda: number; tipo: string | null; categoria_demografica: string | null; muchas_operaciones: boolean | null; telas_pesadas: boolean | null; muchas_habilitaciones: boolean | null; prenda_compleja: boolean | null; cumplimiento_diseno: boolean }[]

      let ok = 0
      await Promise.all(rows.map(async (row) => {
        const prenda = disMultCats.prendas.find((p) => p.id === row.idprenda)
        if (!prenda) return
        const tipoMult = disMultCats.tipos.find((t) => t.nombre === row.tipo)?.multiplicador ?? 1
        const catMult  = disMultCats.categorias.find((c) => c.nombre === row.categoria_demografica)?.multiplicador ?? 1
        const adicionHoras = disMultCats.adiciones.reduce((s, a) => {
          return s + ((row as Record<string, unknown>)[a.clave] === true ? Number(a.horas) : 0)
        }, 0)
        const computed = Math.round((prenda.horas_base * tipoMult * catMult + adicionHoras) * 100) / 100
        const { error: ue } = await supabase
          .from("diseno_programacion")
          .update({
            horas_plan_diseno: computed,
            horas_diseno_cumplidas: row.cumplimiento_diseno ? computed : null,
          })
          .eq("id", row.id)
          .eq("idempresa", IDEMPRESA)
        if (!ue) ok++
      }))

      toast.success(`Recalculadas: ${ok} de ${rows.length} órdenes de diseño`)
      setDetailCache({})
      fetchBonos()
    } finally {
      setRecalculating(false)
    }
  }, [configMissing, disMultCats, fetchBonos])

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
            variant="ghost"
            size="sm"
            onClick={() => setInfoOpen(true)}
            className="gap-2"
          >
            <HelpCircle className="size-4" />
            Cómo se calcula
          </Button>
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
          <Button
            variant="outline"
            size="sm"
            onClick={recalcularHorasDiseno}
            disabled={recalculating || configMissing || disMultCats.prendas.length === 0}
            className="gap-2 bg-transparent text-indigo-600 border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
          >
            <RefreshCw className={cn("size-4", recalculating && "animate-spin")} />
            Recalcular horas
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
                <TableHead className="font-semibold">Área</TableHead>
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
                    {Array.from({ length: 11 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-destructive">
                    <AlertCircle className="inline size-4 mr-1.5 align-text-bottom" />
                    {error}
                  </TableCell>
                </TableRow>
              ) : filteredBonos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                    {bonos.length === 0
                      ? "Sin datos de bonos disponibles."
                      : "Sin datos para la semana seleccionada."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredBonos.map((row) => {
                  const key = `${row.nombre}-${row.tipo_personal}-${row.semana}`
                  const isExpanded = expandedKey === key
                  const esDisenadora = row.tipo_personal === "Diseño"
                  const detail = detailCache[key] ?? []
                  const isLoadingThis = loadingDetail === key
                  const totalPlan = detail.reduce((a, d) => a + (d.horas_plan_diseno ?? 0), 0)
                  const totalCum = detail.reduce((a, d) => a + ((esDisenadora ? d.horas_diseno_cumplidas : d.horas_costura_cumplidas) ?? 0), 0)
                  const foliosCumplidos = detail.filter((d) => esDisenadora ? d.cumplimiento_diseno : d.cumplimiento_costura).length
                  return (
                    <Fragment key={key}>
                      <TableRow className={cn("hover:bg-muted/30", isExpanded && "bg-muted/30")}>
                        <TableCell className="font-medium text-foreground">
                          {row.nombre ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {row.tipo_personal === "Diseño" ? (
                            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-100">Diseño</Badge>
                          ) : row.tipo_personal === "Costura" ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">Costura</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          <button
                            type="button"
                            onClick={() => toggleExpand(row)}
                            className="inline-flex items-center gap-1 tabular-nums hover:text-foreground cursor-pointer text-primary"
                            title={isExpanded ? "Cerrar detalle" : "Ver detalle por folio"}
                          >
                            {isExpanded
                              ? <ChevronDown className="size-3.5 shrink-0" />
                              : <ChevronRight className="size-3.5 shrink-0" />}
                            {fmtH(row.horas_cumplidas)} <span className="text-muted-foreground text-xs">h</span>
                          </button>
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
                                        <TableHead className="h-8 text-xs">Modelo</TableHead>
                                        <TableHead className="h-8 text-xs">Familia</TableHead>
                                        <TableHead className="h-8 text-xs">Cliente</TableHead>
                                        <TableHead className="h-8 text-xs text-right">Hrs Plan</TableHead>
                                        <TableHead className="h-8 text-xs text-center">Cumpl.</TableHead>
                                        <TableHead className="h-8 text-xs text-right">Hrs Cum.</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {detail.map((d, di) => {
                                        const cumplido = esDisenadora ? d.cumplimiento_diseno : d.cumplimiento_costura
                                        const hrsCum = esDisenadora ? d.horas_diseno_cumplidas : d.horas_costura_cumplidas
                                        return (
                                          <TableRow key={di} className={cn("text-xs", !cumplido && "opacity-50")}>
                                            <TableCell className="py-1 font-mono">{d.folio ?? "—"}</TableCell>
                                            <TableCell className="py-1">{d.modelo ?? "—"}</TableCell>
                                            <TableCell className="py-1">{d.familia ?? "—"}</TableCell>
                                            <TableCell className="py-1">{d.cliente ?? "—"}</TableCell>
                                            <TableCell className="py-1 text-right tabular-nums">
                                              <PlanDisenoDesglosePopover row={d} cats={disMultCats} />
                                            </TableCell>
                                            <TableCell className="py-1 text-center">
                                              {cumplido
                                                ? <span className="font-semibold text-emerald-600">✓</span>
                                                : <span className="text-muted-foreground/40">—</span>}
                                            </TableCell>
                                            <TableCell className="py-1 text-right tabular-nums font-medium">
                                              {hrsCum != null && hrsCum > 0
                                                ? <span className="text-emerald-600">{fmtH(hrsCum)}</span>
                                                : <span className="text-muted-foreground/40">—</span>}
                                            </TableCell>
                                          </TableRow>
                                        )
                                      })}
                                    </TableBody>
                                  </Table>
                                  <div className="flex items-center justify-between border-t pt-1.5 text-xs text-muted-foreground">
                                    <span>{foliosCumplidos} de {detail.length} folios con cumplimiento · {fmtH(totalPlan)} h planeadas</span>
                                    <span className="font-semibold text-foreground">Total: {fmtH(totalCum)} h</span>
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
      </div>
      <DesignBonosInfoDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  )
}

// ── Diseño: Tipos para caché de detalle ──────────────────────────────────────

type DesignFolioRow = {
  folio: string | null
  modelo: string | null
  familia: string | null
  cliente: string | null
  horas_plan_diseno: number | null
  cumplimiento_diseno: boolean | null
  cumplimiento_costura: boolean | null
  horas_diseno_cumplidas: number | null
  horas_costura_cumplidas: number | null
  // campos para desglose de multiplicadores
  idprenda: number | null
  tipo: string | null
  categoria_demografica: string | null
  muchas_operaciones: boolean | null
  telas_pesadas: boolean | null
  muchas_habilitaciones: boolean | null
  prenda_compleja: boolean | null
}



// ── Diseño: Info de cálculo de bono ─────────────────────────────────────────

function DesignBonosInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Cómo se calcula el bono de Diseño?</DialogTitle>
          <DialogDescription>Resumen del proceso de liquidación semanal</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="font-semibold text-foreground">1. Horas Cumplidas</p>
              <p className="text-muted-foreground mt-0.5">
                Para <span className="font-medium text-indigo-600">Diseñadora</span>: suma de horas de los folios donde registró <span className="font-medium text-emerald-600">Cumplimiento Diseño = ✓</span>.<br />
                Para <span className="font-medium text-emerald-600">Costurera</span>: suma de horas de los folios donde registró <span className="font-medium text-emerald-600">Cumplimiento Costura = ✓</span>.<br />
                Haz clic en el valor de horas para ver el desglose folio por folio.
              </p>
            </div>
            <div>
              <p className="font-semibold text-foreground">2. Horas Fuera de Área</p>
              <p className="text-muted-foreground mt-0.5">Horas trabajadas en apoyo a otro departamento durante la semana.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">3. % Eficiencia</p>
              <p className="font-mono text-xs bg-background rounded px-2 py-1 mt-0.5 inline-block">
                (Hrs Cumplidas + Hrs Fuera de Área) / Hrs Semana × 100
              </p>
            </div>
            <div>
              <p className="font-semibold text-foreground">4. Criterio de Aceptación</p>
              <p className="text-muted-foreground mt-0.5">Se requiere alcanzar el umbral de eficiencia configurado en el sistema (y cumplir con la asistencia mínima).</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">5. Bono Semanal</p>
              <p className="text-muted-foreground mt-0.5">Monto individual que recibe el colaborador cuando cumple el criterio de aceptación.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">6. Bono Colectivo</p>
              <p className="text-muted-foreground mt-0.5">Monto adicional que se activa cuando <em>todo el equipo</em> cumple el criterio en la misma semana.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">7. Bono Total</p>
              <p className="font-mono text-xs bg-background rounded px-2 py-1 mt-0.5 inline-block">
                Bono Semanal + Bono Colectivo
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Reprogramar Dialog ────────────────────────────────────────────────────────

function ReprogramarDialog({
  record,
  open,
  onOpenChange,
  onReprogramado,
  onRefresh,
}: {
  record: DisenoProgramacion | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onReprogramado: (updated: DisenoProgramacion) => void
  onRefresh?: () => void
}) {
  const [nuevaSemana, setNuevaSemana] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (!open) setNuevaSemana("") }, [open])

  // Orden rechazada → clonar como nueva fila con evaluación limpia
  const esRechazada = record?.rechazo_orden === true

  const handleSubmit = async () => {
    if (!record || !nuevaSemana) return
    const supabase = getSupabase()
    if (!supabase) return

    setSubmitting(true)
    try {
      if (esRechazada) {
        // Insertar nueva fila: mismos datos, evaluación reseteada, nueva semana
        const { data, error } = await supabase
          .from("diseno_programacion")
          .insert({
            idempresa: record.idempresa,
            folio: record.folio,
            modelo: record.modelo,
            familia: record.familia,
            categoria: record.categoria,
            cliente: record.cliente,
            fecha: record.fecha,
            semana: Number(nuevaSemana),
            semana_original: record.semana_original ?? record.semana,
            tipo: record.tipo,
            idprenda: record.idprenda ?? null,
            categoria_demografica: record.categoria_demografica ?? null,
            muchas_operaciones: record.muchas_operaciones ?? false,
            telas_pesadas: record.telas_pesadas ?? false,
            muchas_habilitaciones: record.muchas_habilitaciones ?? false,
            prenda_compleja: record.prenda_compleja ?? false,
            horas_plan_diseno: record.horas_plan_diseno,
            numero_muestras: record.numero_muestras ?? 1,
            iddisenadora: record.iddisenadora,
            idcosturera: record.idcosturera ?? null,
            // evaluación limpia
            cumplimiento_diseno: false,
            cumplimiento_costura: false,
            rechazo_orden: false,
            horas_costura_cumplidas: null,
            comentarios: null,
          })
          .select("*, disenadoras(nombre), costureras(nombre)")
          .single()

        if (error) {
          toast.error("No se pudo crear la reprogramación", { description: error.message })
          return
        }

        toast.success("Orden duplicada para reprogramación", {
          description: `Nueva entrada para semana ${nuevaSemana} · La fila rechazada se mantiene como historial.`,
        })
        onReprogramado(data as DisenoProgramacion)
        onRefresh?.()
        onOpenChange(false)
      } else {
        const { data, error } = await supabase
          .from("diseno_programacion")
          .update({
            semana: Number(nuevaSemana),
            semana_original: record.semana,
          })
          .eq("id", record.id)
          .eq("idempresa", IDEMPRESA)
          .select("*, disenadoras(nombre), costureras(nombre)")
          .single()

        if (error) {
          toast.error("No se pudo reprogramar", { description: error.message })
          return
        }

        toast.success("Orden reprogramada", {
          description: `Semana ${record.semana ?? "—"} → Semana ${nuevaSemana}`,
        })
        onReprogramado(data as DisenoProgramacion)
        onOpenChange(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1",
              esRechazada
                ? "bg-rose-50 ring-rose-200"
                : "bg-violet-100 ring-violet-200",
            )}>
              <CalendarClock className={cn("size-4", esRechazada ? "text-rose-600" : "text-violet-600")} />
            </div>
            <div>
              <DialogTitle>
                {esRechazada ? "Reprogramar Orden Rechazada" : "Reprogramar Orden"}
              </DialogTitle>
              <DialogDescription>
                Folio: <span className="font-mono font-medium">{record?.folio ?? "—"}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {esRechazada && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
              Esta orden está rechazada. Se creará una <strong>nueva fila</strong> con la misma información pero con evaluación limpia. La fila rechazada se mantiene como historial.
            </p>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1">
            <p className="text-muted-foreground">
              Semana actual:{" "}
              <span className="font-semibold text-foreground">{record?.semana ?? "—"}</span>
            </p>
            {record?.semana_original != null && (
              <p className="text-muted-foreground">
                Semana original:{" "}
                <span className="font-semibold text-foreground">{record.semana_original}</span>
              </p>
            )}
          </div>

          <FormRow label="Nueva Semana" required>
            <Input
              type="number"
              min={1}
              max={53}
              placeholder="Nº de semana"
              value={nuevaSemana}
              onChange={(e) => setNuevaSemana(e.target.value)}
              className="w-36"
              autoFocus
            />
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !nuevaSemana}
            className={cn(
              "text-white",
              esRechazada
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-violet-600 hover:bg-violet-700",
            )}
          >
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" />{esRechazada ? "Creando…" : "Reprogramando…"}</>
            ) : (
              esRechazada ? "Crear nueva programación" : "Reprogramar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Tab 4: Historial Tiempos Fuera ────────────────────────────────────────────

type TiempoFueraRecord = {
  id: number
  fecha: string | null
  semana: number | null
  iddisenadora: number | null
  idcosturera: number | null
  area_foranea: string | null
  tiempo_af: number | null
  comentarios: string | null
  disenadoras: { nombre: string } | null
  costureras: { nombre: string } | null
}

const INIT_TF = { fecha: undefined as Date | undefined, tipoColaborador: "disenadora" as "disenadora" | "costurera", idColaborador: "", area_foranea: "", tiempo_af: "", comentarios: "" }

function TiemposFueraTab({
  disenadoras, costureras, loadingCatalogs, configMissing,
}: {
  disenadoras: Catalog[]
  costureras: Catalog[]
  loadingCatalogs: boolean
  configMissing: boolean
}) {
  const [form, setForm] = useState({ ...INIT_TF })
  const [submitting, setSubmitting] = useState(false)
  const [records, setRecords] = useState<TiempoFueraRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [editTarget, setEditTarget] = useState<TiempoFueraRecord | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ ...INIT_TF })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TiempoFueraRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const set = <K extends keyof typeof INIT_TF>(k: K, v: (typeof INIT_TF)[K]) =>
    setForm((p) => ({ ...p, [k]: v }))
  const setE = <K extends keyof typeof INIT_TF>(k: K, v: (typeof INIT_TF)[K]) =>
    setEditForm((p) => ({ ...p, [k]: v }))

  const fetchHistory = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoadingRecords(true)
    const { data, error } = await supabase
      .from("tiempos_fuera_area")
      .select("id, fecha, semana, iddisenadora, idcosturera, area_foranea, tiempo_af, comentarios, disenadoras(nombre), costureras(nombre)")
      .eq("idempresa", IDEMPRESA)
      .order("fecha", { ascending: false })
    if (!error) setRecords((data ?? []) as unknown as TiempoFueraRecord[])
    else console.error("[v0] tiempos_fuera fetch:", error)
    setLoadingRecords(false)
  }, [configMissing])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  const handleSubmit = async () => {
    if (!form.fecha) { toast.error("Campo requerido", { description: "Selecciona una fecha." }); return }
    if (!form.idColaborador) { toast.error("Campo requerido", { description: `Selecciona ${form.tipoColaborador === "costurera" ? "una costurera" : "una diseñadora"}.` }); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSubmitting(true)
    try {
      const tfPayload: Record<string, unknown> = {
        idempresa: IDEMPRESA,
        fecha: format(form.fecha, "yyyy-MM-dd"),
        area_foranea: form.area_foranea.trim() || null,
        tiempo_af: form.tiempo_af ? Number(form.tiempo_af) : null,
        comentarios: form.comentarios.trim() || null,
      }
      if (form.tipoColaborador === "costurera") {
        tfPayload.idcosturera = Number(form.idColaborador)
        tfPayload.iddisenadora = null
      } else {
        tfPayload.iddisenadora = Number(form.idColaborador)
      }
      const { error } = await supabase.from("tiempos_fuera_area").insert(tfPayload)
      if (error) { toast.error("No se pudo registrar", { description: error.message }); return }
      toast.success("Tiempo fuera de área registrado.")
      setForm({ ...INIT_TF })
      fetchHistory()
    } finally { setSubmitting(false) }
  }

  const openEdit = (r: TiempoFueraRecord) => {
    setEditTarget(r)
    const tipoColaborador: "disenadora" | "costurera" = r.idcosturera ? "costurera" : "disenadora"
    setEditForm({
      fecha: r.fecha ? new Date(`${r.fecha}T00:00:00`) : undefined,
      tipoColaborador,
      idColaborador: tipoColaborador === "costurera" ? String(r.idcosturera ?? "") : String(r.iddisenadora ?? ""),
      area_foranea: r.area_foranea ?? "",
      tiempo_af: r.tiempo_af != null ? String(r.tiempo_af) : "",
      comentarios: r.comentarios ?? "",
    })
    setEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editTarget || !editForm.fecha) { toast.error("Campo requerido", { description: "Selecciona una fecha." }); return }
    if (!editForm.idColaborador) { toast.error("Campo requerido", { description: `Selecciona ${editForm.tipoColaborador === "costurera" ? "una costurera" : "una diseñadora"}.` }); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)
    try {
      const tfEditPayload: Record<string, unknown> = {
        fecha: format(editForm.fecha, "yyyy-MM-dd"),
        area_foranea: editForm.area_foranea.trim() || null,
        tiempo_af: editForm.tiempo_af ? Number(editForm.tiempo_af) : null,
        comentarios: editForm.comentarios.trim() || null,
      }
      if (editForm.tipoColaborador === "costurera") {
        tfEditPayload.idcosturera = Number(editForm.idColaborador)
        tfEditPayload.iddisenadora = null
      } else {
        tfEditPayload.iddisenadora = Number(editForm.idColaborador)
      }
      const { error } = await supabase
        .from("tiempos_fuera_area")
        .update(tfEditPayload)
        .eq("id", editTarget.id)
        .eq("idempresa", IDEMPRESA)
      if (error) { toast.error("No se pudo actualizar", { description: error.message }); return }
      toast.success("Registro actualizado.")
      setEditOpen(false)
      fetchHistory()
    } finally { setSaving(false) }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const supabase = getSupabase()
    if (!supabase) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from("tiempos_fuera_area")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("idempresa", IDEMPRESA)
      if (error) { toast.error("No se pudo eliminar", { description: error.message }); return }
      setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      toast.success("Registro eliminado.")
      setDeleteTarget(null)
    } finally { setDeleting(false) }
  }

  return (
    <>
      <div className="space-y-5">
        {/* ── Formulario en línea ── */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-200">
              <MapPin className="size-4 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Registrar Tiempo Fuera de Área</p>
              <p className="text-xs text-muted-foreground">La semana se calcula automáticamente desde la fecha.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Fecha <span className="text-destructive">*</span></Label>
              <DatePicker value={form.fecha} onChange={(d) => set("fecha", d)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tipo</Label>
              <Select value={form.tipoColaborador} onValueChange={(v) => setForm((p) => ({ ...p, tipoColaborador: v as "disenadora" | "costurera", idColaborador: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disenadora">Diseñadora</SelectItem>
                  <SelectItem value="costurera">Costurera</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{form.tipoColaborador === "costurera" ? "Costurera" : "Diseñadora"} <span className="text-destructive">*</span></Label>
              <CatalogSelect value={form.idColaborador} onValueChange={(v) => set("idColaborador", v)} items={form.tipoColaborador === "costurera" ? costureras : disenadoras} loading={loadingCatalogs} placeholder="Seleccionar…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Área Foránea</Label>
              <Input placeholder="Nombre del área" value={form.area_foranea} onChange={(e) => set("area_foranea", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tiempo AF (h)</Label>
              <Input type="number" min={0} step={0.5} placeholder="0.0" value={form.tiempo_af} onChange={(e) => set("tiempo_af", e.target.value)} />
            </div>
          </div>

          <div className="mt-3 flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs font-medium">Comentarios</Label>
              <Input placeholder="Observaciones opcionales…" value={form.comentarios} onChange={(e) => set("comentarios", e.target.value)} />
            </div>
            <Button onClick={handleSubmit} disabled={submitting || configMissing} className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
              {submitting ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar"}
            </Button>
          </div>
        </div>

        {/* ── Tabla de historial ── */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Historial</p>
            <Button variant="ghost" size="sm" onClick={fetchHistory} disabled={loadingRecords} className="gap-1.5 text-muted-foreground">
              <RefreshCw className={cn("size-3.5", loadingRecords && "animate-spin")} />
              Actualizar
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Fecha</TableHead>
                  <TableHead className="font-semibold text-right">Semana</TableHead>
                  <TableHead className="font-semibold">Colaborador</TableHead>
                  <TableHead className="font-semibold">Área Foránea</TableHead>
                  <TableHead className="font-semibold text-right">Tiempo (h)</TableHead>
                  <TableHead className="font-semibold">Comentarios</TableHead>
                  <TableHead className="font-semibold text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRecords ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
                  ))
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Sin registros.</TableCell>
                  </TableRow>
                ) : records.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell className="tabular-nums text-sm">{r.fecha ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{r.semana ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.costureras?.nombre ?? r.disenadoras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.area_foranea ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium text-amber-700">{r.tiempo_af != null ? `${r.tiempo_af} h` : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{r.comentarios ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="gap-1 text-muted-foreground hover:text-foreground">
                          <Pencil className="size-3.5" />
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="gap-1 text-destructive/60 hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="size-3.5" />
                          Eliminar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Dialog Editar ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!saving) setEditOpen(o) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Tiempo Fuera de Área</DialogTitle>
            <DialogDescription>Modifica los campos y guarda los cambios. La semana se recalcula automáticamente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Fecha" required>
                <DatePicker value={editForm.fecha} onChange={(d) => setE("fecha", d)} />
              </FormRow>
              <FormRow label="Tipo">
                <Select value={editForm.tipoColaborador} onValueChange={(v) => setEditForm((p) => ({ ...p, tipoColaborador: v as "disenadora" | "costurera", idColaborador: "" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disenadora">Diseñadora</SelectItem>
                    <SelectItem value="costurera">Costurera</SelectItem>
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label={editForm.tipoColaborador === "costurera" ? "Costurera" : "Diseñadora"} required>
                <CatalogSelect value={editForm.idColaborador} onValueChange={(v) => setE("idColaborador", v)} items={editForm.tipoColaborador === "costurera" ? costureras : disenadoras} loading={loadingCatalogs} placeholder="Seleccionar…" />
              </FormRow>
              <FormRow label="Área Foránea">
                <Input placeholder="Nombre del área" value={editForm.area_foranea} onChange={(e) => setE("area_foranea", e.target.value)} />
              </FormRow>
              <FormRow label="Tiempo AF (h)">
                <Input type="number" min={0} step={0.5} placeholder="0.0" value={editForm.tiempo_af} onChange={(e) => setE("tiempo_af", e.target.value)} />
              </FormRow>
            </div>
            <FormRow label="Comentarios">
              <Textarea rows={2} placeholder="Observaciones opcionales…" value={editForm.comentarios} onChange={(e) => setE("comentarios", e.target.value)} className="resize-none" />
            </FormRow>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog Eliminar ── */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el registro del{" "}
              <span className="font-medium">{deleteTarget?.fecha ?? "—"}</span>.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── Tab 5: Historial Vacaciones / Permisos ────────────────────────────────────

type VacacionPermiso = {
  id: number
  fecha_inicio: string | null
  semana: number | null
  iddisenadora: number | null
  idcosturera: number | null
  tipo_ausentismo: string | null
  dias: number | null
  horas_manuales: number | null
  horas_totales: number | null
  comentarios: string | null
  disenadoras: { nombre: string } | null
  costureras: { nombre: string } | null
}

const INIT_VP = { fecha_inicio: undefined as Date | undefined, tipoColaborador: "disenadora" as "disenadora" | "costurera", idColaborador: "", tipo_ausentismo: "", dias: "", horas_manuales: "", comentarios: "" }

function VacacionesPermisosTab({
  disenadoras, costureras, tiposAusentismos, loadingCatalogs, configMissing,
}: {
  disenadoras: Catalog[]
  costureras: Catalog[]
  tiposAusentismos: Catalog[]
  loadingCatalogs: boolean
  configMissing: boolean
}) {
  const [form, setForm] = useState({ ...INIT_VP })
  const [submitting, setSubmitting] = useState(false)
  const [records, setRecords] = useState<VacacionPermiso[]>([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [editTarget, setEditTarget] = useState<VacacionPermiso | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ ...INIT_VP })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<VacacionPermiso | null>(null)
  const [deleting, setDeleting] = useState(false)

  const set = <K extends keyof typeof INIT_VP>(k: K, v: (typeof INIT_VP)[K]) =>
    setForm((p) => ({ ...p, [k]: v }))
  const setE = <K extends keyof typeof INIT_VP>(k: K, v: (typeof INIT_VP)[K]) =>
    setEditForm((p) => ({ ...p, [k]: v }))

  const tipoLower = form.tipo_ausentismo.toLowerCase()
  const showDias = tipoLower.includes("vacacion")
  const showHorasManuales = tipoLower.includes("permiso")

  const editTipoLower = editForm.tipo_ausentismo.toLowerCase()
  const editShowDias = editTipoLower.includes("vacacion")
  const editShowHoras = editTipoLower.includes("permiso")

  const fetchHistory = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoadingRecords(true)
    const { data, error } = await supabase
      .from("vacaciones_permisos")
      .select("id, fecha_inicio, semana, iddisenadora, idcosturera, tipo_ausentismo, dias, horas_manuales, horas_totales, comentarios, disenadoras(nombre), costureras(nombre)")
      .eq("idempresa", IDEMPRESA)
      .order("fecha_inicio", { ascending: false })
    if (!error) setRecords((data ?? []) as unknown as VacacionPermiso[])
    else console.error("[v0] vacaciones fetch:", error)
    setLoadingRecords(false)
  }, [configMissing])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  const handleSubmit = async () => {
    if (!form.fecha_inicio) { toast.error("Campo requerido", { description: "Selecciona la fecha de inicio." }); return }
    if (!form.idColaborador) { toast.error("Campo requerido", { description: `Selecciona ${form.tipoColaborador === "costurera" ? "una costurera" : "una diseñadora"}.` }); return }
    if (!form.tipo_ausentismo) { toast.error("Campo requerido", { description: "Selecciona el tipo de ausentismo." }); return }
    if (showDias && !form.dias) { toast.error("Campo requerido", { description: "Ingresa los días." }); return }
    if (showHorasManuales && !form.horas_manuales) { toast.error("Campo requerido", { description: "Ingresa las horas." }); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSubmitting(true)
    try {
      const { data, error } = await supabase
        .from("vacaciones_permisos")
        .insert({
          idempresa: IDEMPRESA,
          fecha_inicio: format(form.fecha_inicio, "yyyy-MM-dd"),
          iddisenadora: form.tipoColaborador === "disenadora" ? Number(form.idColaborador) : null,
          idcosturera: form.tipoColaborador === "costurera" ? Number(form.idColaborador) : null,
          tipo_ausentismo: form.tipo_ausentismo,
          dias: showDias && form.dias ? Number(form.dias) : null,
          horas_manuales: showHorasManuales && form.horas_manuales ? Number(form.horas_manuales) : null,
          comentarios: form.comentarios.trim() || null,
        })
        .select("*")
        .single()
      if (error) { toast.error("No se pudo registrar", { description: error.message }); return }
      const row = data as Record<string, unknown>
      toast.success("Ausentismo registrado.", { description: `Horas totales: ${row.horas_totales ?? "—"} h` })
      setForm({ ...INIT_VP })
      fetchHistory()
    } finally { setSubmitting(false) }
  }

  const openEdit = (r: VacacionPermiso) => {
    setEditTarget(r)
    const tipoColaborador: "disenadora" | "costurera" = r.idcosturera ? "costurera" : "disenadora"
    setEditForm({
      fecha_inicio: r.fecha_inicio ? new Date(`${r.fecha_inicio}T00:00:00`) : undefined,
      tipoColaborador,
      idColaborador: tipoColaborador === "costurera" ? String(r.idcosturera ?? "") : String(r.iddisenadora ?? ""),
      tipo_ausentismo: r.tipo_ausentismo ?? "",
      dias: r.dias != null ? String(r.dias) : "",
      horas_manuales: r.horas_manuales != null ? String(r.horas_manuales) : "",
      comentarios: r.comentarios ?? "",
    })
    setEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editTarget || !editForm.fecha_inicio) { toast.error("Campo requerido", { description: "Selecciona la fecha de inicio." }); return }
    if (!editForm.idColaborador) { toast.error("Campo requerido", { description: `Selecciona ${editForm.tipoColaborador === "costurera" ? "una costurera" : "una diseñadora"}.` }); return }
    if (!editForm.tipo_ausentismo) { toast.error("Campo requerido", { description: "Selecciona el tipo." }); return }
    if (editShowDias && !editForm.dias) { toast.error("Campo requerido", { description: "Ingresa los días." }); return }
    if (editShowHoras && !editForm.horas_manuales) { toast.error("Campo requerido", { description: "Ingresa las horas." }); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("vacaciones_permisos")
        .update({
          fecha_inicio: format(editForm.fecha_inicio, "yyyy-MM-dd"),
          iddisenadora: editForm.tipoColaborador === "disenadora" ? Number(editForm.idColaborador) : null,
          idcosturera: editForm.tipoColaborador === "costurera" ? Number(editForm.idColaborador) : null,
          tipo_ausentismo: editForm.tipo_ausentismo,
          dias: editShowDias && editForm.dias ? Number(editForm.dias) : null,
          horas_manuales: editShowHoras && editForm.horas_manuales ? Number(editForm.horas_manuales) : null,
          comentarios: editForm.comentarios.trim() || null,
        })
        .eq("id", editTarget.id)
        .eq("idempresa", IDEMPRESA)
      if (error) { toast.error("No se pudo actualizar", { description: error.message }); return }
      toast.success("Registro actualizado.")
      setEditOpen(false)
      fetchHistory()
    } finally { setSaving(false) }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const supabase = getSupabase()
    if (!supabase) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from("vacaciones_permisos")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("idempresa", IDEMPRESA)
      if (error) { toast.error("No se pudo eliminar", { description: error.message }); return }
      setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      toast.success("Registro eliminado.")
      setDeleteTarget(null)
    } finally { setDeleting(false) }
  }

  return (
    <>
      <div className="space-y-5">
        {/* ── Formulario en línea ── */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 ring-1 ring-rose-200">
              <UserMinus className="size-4 text-rose-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Registrar Vacaciones o Permiso</p>
              <p className="text-xs text-muted-foreground">La semana y horas totales se calculan automáticamente.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Fecha de Inicio <span className="text-destructive">*</span></Label>
              <DatePicker value={form.fecha_inicio} onChange={(d) => set("fecha_inicio", d)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tipo de Colaborador</Label>
              <Select value={form.tipoColaborador} onValueChange={(v) => setForm((p) => ({ ...p, tipoColaborador: v as "disenadora" | "costurera", idColaborador: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disenadora">Diseñadora</SelectItem>
                  <SelectItem value="costurera">Costurera</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{form.tipoColaborador === "costurera" ? "Costurera" : "Diseñadora"} <span className="text-destructive">*</span></Label>
              <CatalogSelect value={form.idColaborador} onValueChange={(v) => set("idColaborador", v)} items={form.tipoColaborador === "costurera" ? costureras : disenadoras} loading={loadingCatalogs} placeholder="Seleccionar…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tipo de Ausentismo <span className="text-destructive">*</span></Label>
              <CatalogSelect
                value={form.tipo_ausentismo}
                onValueChange={(v) => setForm((p) => ({ ...p, tipo_ausentismo: v, dias: "", horas_manuales: "" }))}
                items={tiposAusentismos}
                loading={loadingCatalogs}
                placeholder="Seleccionar…"
                useNombre
              />
            </div>
            {showDias && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Días <span className="text-destructive">*</span></Label>
                <Input type="number" min={1} placeholder="Nº de días" value={form.dias} onChange={(e) => set("dias", e.target.value)} />
              </div>
            )}
            {showHorasManuales && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Hrs Manuales <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step={0.5} placeholder="0.0" value={form.horas_manuales} onChange={(e) => set("horas_manuales", e.target.value)} />
              </div>
            )}
          </div>

          <div className="mt-3 flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs font-medium">Comentarios</Label>
              <Input placeholder="Observaciones opcionales…" value={form.comentarios} onChange={(e) => set("comentarios", e.target.value)} />
            </div>
            <Button onClick={handleSubmit} disabled={submitting || configMissing} className="bg-rose-600 hover:bg-rose-700 text-white shrink-0">
              {submitting ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar"}
            </Button>
          </div>
        </div>

        {/* ── Tabla de historial ── */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Historial</p>
            <Button variant="ghost" size="sm" onClick={fetchHistory} disabled={loadingRecords} className="gap-1.5 text-muted-foreground">
              <RefreshCw className={cn("size-3.5", loadingRecords && "animate-spin")} />
              Actualizar
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Fecha Inicio</TableHead>
                  <TableHead className="font-semibold text-right">Semana</TableHead>
                  <TableHead className="font-semibold">Colaborador</TableHead>
                  <TableHead className="font-semibold">Tipo</TableHead>
                  <TableHead className="font-semibold text-right">Días</TableHead>
                  <TableHead className="font-semibold text-right">Hrs Man.</TableHead>
                  <TableHead className="font-semibold text-right">Hrs Totales</TableHead>
                  <TableHead className="font-semibold">Comentarios</TableHead>
                  <TableHead className="font-semibold text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRecords ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 9 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
                  ))
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">Sin registros.</TableCell>
                  </TableRow>
                ) : records.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell className="tabular-nums text-sm">{r.fecha_inicio ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{r.semana ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.costureras?.nombre ?? r.disenadoras?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {r.tipo_ausentismo
                        ? <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">{r.tipo_ausentismo}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{r.dias ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{r.horas_manuales != null ? `${r.horas_manuales} h` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold text-rose-700">{r.horas_totales != null ? `${r.horas_totales} h` : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{r.comentarios ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="gap-1 text-muted-foreground hover:text-foreground">
                          <Pencil className="size-3.5" />
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="gap-1 text-destructive/60 hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="size-3.5" />
                          Eliminar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Dialog Editar ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!saving) setEditOpen(o) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Vacaciones / Permiso</DialogTitle>
            <DialogDescription>Modifica los campos y guarda. Las horas totales se recalculan automáticamente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Fecha de Inicio" required>
                <DatePicker value={editForm.fecha_inicio} onChange={(d) => setE("fecha_inicio", d)} />
              </FormRow>
              <FormRow label="Tipo de Colaborador">
                <Select value={editForm.tipoColaborador} onValueChange={(v) => setEditForm((p) => ({ ...p, tipoColaborador: v as "disenadora" | "costurera", idColaborador: "" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disenadora">Diseñadora</SelectItem>
                    <SelectItem value="costurera">Costurera</SelectItem>
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label={editForm.tipoColaborador === "costurera" ? "Costurera" : "Diseñadora"} required>
                <CatalogSelect value={editForm.idColaborador} onValueChange={(v) => setE("idColaborador", v)} items={editForm.tipoColaborador === "costurera" ? costureras : disenadoras} loading={loadingCatalogs} placeholder="Seleccionar…" />
              </FormRow>
              <FormRow label="Tipo de Ausentismo" required>
                <CatalogSelect
                  value={editForm.tipo_ausentismo}
                  onValueChange={(v) => setEditForm((p) => ({ ...p, tipo_ausentismo: v, dias: "", horas_manuales: "" }))}
                  items={tiposAusentismos}
                  loading={loadingCatalogs}
                  placeholder="Seleccionar…"
                  useNombre
                />
              </FormRow>
              {editShowDias && (
                <FormRow label="Días" required>
                  <Input type="number" min={1} placeholder="Nº de días" value={editForm.dias} onChange={(e) => setE("dias", e.target.value)} />
                </FormRow>
              )}
              {editShowHoras && (
                <FormRow label="Hrs Manuales" required>
                  <Input type="number" min={0} step={0.5} placeholder="0.0" value={editForm.horas_manuales} onChange={(e) => setE("horas_manuales", e.target.value)} />
                </FormRow>
              )}
            </div>
            <FormRow label="Comentarios">
              <Textarea rows={2} placeholder="Observaciones opcionales…" value={editForm.comentarios} onChange={(e) => setE("comentarios", e.target.value)} className="resize-none" />
            </FormRow>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={saving} className="bg-rose-600 hover:bg-rose-700 text-white">
              {saving ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog Eliminar ── */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el ausentismo de{" "}
              <span className="font-medium">{deleteTarget?.costureras?.nombre ?? deleteTarget?.disenadoras?.nombre ?? "—"}</span>{" "}
              del <span className="font-medium">{deleteTarget?.fecha_inicio ?? "—"}</span>.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
    fechaAprobacionDiseno: null as Date | null,
  })

  // Catálogos de multiplicadores para recalcular horas_plan_diseno al evaluar
  const disMultCats = useDisenoMultiplierCatalogs(false)

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
      fechaAprobacionDiseno: record.fecha_aprobacion_diseno
        ? parseISO(record.fecha_aprobacion_diseno)
        : null,
    })
  }, [record])

  const handleSubmit = async () => {
    if (!record) return
    const supabase = getSupabase()
    if (!supabase) return
    setSubmitting(true)
    try {
      // Recalcular horas_plan_diseno desde los catálogos actuales
      const prenda   = disMultCats.prendas.find((p) => p.id === record.idprenda)
      const tipoMult = disMultCats.tipos.find((t) => t.nombre === record.tipo)?.multiplicador ?? 1
      const catMult  = disMultCats.categorias.find((c) => c.nombre === record.categoria_demografica)?.multiplicador ?? 1
      const adicionHoras = disMultCats.adiciones.reduce((s, a) => {
        const k = a.clave as keyof DisenoProgramacion
        return s + ((record as Record<string, unknown>)[k] === true ? Number(a.horas) : 0)
      }, 0)
      const horasPlanCalculadas = prenda
        ? Math.round((prenda.horas_base * tipoMult * catMult + adicionHoras) * 100) / 100
        : record.horas_plan_diseno  // fallback: mantener el valor guardado si no hay catálogo

      // 1. Actualizar diseno_programacion
      const { data, error } = await supabase
        .from("diseno_programacion")
        .update({
          cumplimiento_diseno: form.cumplimientoDiseno,
          cumplimiento_costura: form.cumplimientoCostura,
          rechazo_orden: form.rechazoOrden,
          idcosturera: form.idcosturera && form.idcosturera !== "__none__" ? Number(form.idcosturera) : null,
          comentarios: form.comentarios.trim() || null,
          horas_plan_diseno: horasPlanCalculadas,
          horas_diseno_cumplidas: form.cumplimientoDiseno ? horasPlanCalculadas : null,
        })
        .eq("id", record.id)
        .eq("idempresa", IDEMPRESA)
        .select("*, disenadoras(nombre), costureras(nombre)")
        .single()
      if (error) { console.error("[v0] eval update:", error); toast.error("No se pudo guardar", { description: error.message }); return }

      // 2. Actualizar fecha_aprobacion_diseno en ordenes_produccion
      const nuevaFecha = form.fechaAprobacionDiseno
        ? format(form.fechaAprobacionDiseno, "yyyy-MM-dd")
        : null
      if (record.folio) {
        const { error: aprobError } = await supabase
          .from("ordenes_produccion")
          .update({ fecha_aprobacion_diseno: nuevaFecha })
          .eq("folio", record.folio)
          .eq("idempresa", IDEMPRESA)
        if (aprobError) console.error("[v0] aprobacion update:", aprobError)
      }

      const updated = { ...(data as DisenoProgramacion), fecha_aprobacion_diseno: nuevaFecha }
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

          {/* Aprobación de Diseño */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aprobación de Diseño</p>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Fecha de aprobación del cliente</Label>
                {form.fechaAprobacionDiseno && (
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, fechaAprobacionDiseno: null }))}
                    className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 transition-colors"
                  >
                    <X className="size-3" />
                    Eliminar fecha
                  </button>
                )}
              </div>
              <DatePicker
                value={form.fechaAprobacionDiseno ?? undefined}
                onChange={(d) => setForm((p) => ({ ...p, fechaAprobacionDiseno: d ?? null }))}
              />
              <p className="text-xs text-muted-foreground">
                {form.fechaAprobacionDiseno
                  ? "Al guardar se actualizará la fecha en la orden de producción."
                  : "Sin fecha seleccionada — al guardar se eliminará la aprobación registrada."}
              </p>
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

function AprobacionBadge({ fecha }: { fecha: string | null | undefined }) {
  if (!fecha) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        <Clock className="size-3" />
        Pendiente
      </span>
    )
  }
  const formatted = (() => {
    try {
      const d = new Date(`${fecha}T00:00:00`)
      return format(d, "dd/MM/yyyy")
    } catch {
      return fecha
    }
  })()
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
      <CheckCircle2 className="size-3" />
      {formatted}
    </span>
  )
}

function getStatusKey(row: DisenoProgramacion): string {
  if (row.rechazo_orden) return "rechazado"
  if (row.cumplimiento_diseno && row.cumplimiento_costura) return "completo"
  if (row.cumplimiento_diseno) return "diseno_ok"
  if (row.cumplimiento_costura) return "costura_ok"
  return "pendiente"
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

function DisenadoraCell({
  recordId,
  value,
  disenadoras,
  onSave,
}: {
  recordId: number
  value: number | null
  disenadoras: Catalog[]
  onSave: (id: number | null, nombre: string | null) => void
}) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (v: string) => {
    const id = v === "__none__" ? null : Number(v)
    const nombre = id != null ? (disenadoras.find((d) => d.id === id)?.nombre ?? null) : null
    setSaving(true)
    const supabase = getSupabase()
    if (!supabase) { setSaving(false); return }
    const { error } = await supabase
      .from("diseno_programacion")
      .update({ iddisenadora: id })
      .eq("id", recordId)
      .eq("idempresa", IDEMPRESA)
    setSaving(false)
    if (error) {
      toast.error("No se pudo actualizar la diseñadora", { description: error.message })
      return
    }
    onSave(id, nombre)
    toast.success("Diseñadora actualizada")
  }

  return (
    <Select value={value != null ? String(value) : "__none__"} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger
        className={cn(
          "h-8 min-w-[130px] border-transparent bg-transparent text-xs shadow-none hover:border-border hover:bg-muted/40 focus:ring-1",
          saving && "opacity-60",
        )}
      >
        {saving
          ? <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3 animate-spin" />Guardando…</span>
          : <SelectValue placeholder={<span className="text-muted-foreground">—</span>} />
        }
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          <span className="text-muted-foreground">Sin asignar</span>
        </SelectItem>
        {disenadoras.map((d) => (
          <SelectItem key={d.id} value={String(d.id)}>{d.nombre}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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

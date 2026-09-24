"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, CalendarIcon, RefreshCw, Trash2, ChevronDown, Ban, Pencil, XCircle, RotateCcw, ClipboardList, Plus, DollarSign } from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import type { OrdenProduccion, VwOrdenAvance } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ScheduleDesignSheet } from "@/components/schedule-design-sheet"
import { ScheduleCutDialog } from "@/components/schedule-cut-dialog"
import { AvanceEtapas, EtapasOrdenSheet } from "@/components/etapas-orden-sheet"
import { EtapasTablero } from "@/components/etapas-tablero"
import { EtapasCola } from "@/components/etapas-cola"
import { CrearOrdenDialog } from "@/components/crear-orden-dialog"
import { EditarPreciosDialog } from "@/components/editar-precios-dialog"
import { useFichaTecnica } from "@/components/ficha-tecnica-provider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FolioLink } from "@/components/folio-detail-drawer"
import { RiskBadge } from "@/components/risk-badge"
import { IncomingFilterChip } from "@/components/incoming-filter-chip"
import { usePasswordGate } from "@/components/password-gate-dialog"
import type { ModuleFilter } from "@/lib/module-filter"
import { computeRisk, parseLocalDate } from "@/lib/risk"
import { useReadOnly } from "@/lib/auth-context"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Props = {
  refreshKey: number
  configMissing: boolean
  /** Filtro heredado del inicio (tarjetas de "Atención hoy"). */
  initialFilter?: ModuleFilter | null
}

const PAGE_SIZE = 25

const FASE_STYLES: Record<string, string> = {
  "Por Programar": "bg-slate-100 text-slate-700",
  S1: "bg-blue-100 text-blue-700",
  S2: "bg-indigo-100 text-indigo-700",
  S3: "bg-violet-100 text-violet-700",
  S4: "bg-purple-100 text-purple-700",
  S5: "bg-fuchsia-100 text-fuchsia-700",
  S6: "bg-pink-100 text-pink-700",
  S7: "bg-rose-100 text-rose-700",
  Programada: "bg-emerald-100 text-emerald-700",
}

function FaseBadge({ fase }: { fase: string | null | undefined }) {
  const label = fase ?? "—"
  const cls = FASE_STYLES[label] ?? "bg-gray-100 text-gray-600"
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", cls)}>
      {label}
    </span>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return "-"
  const d = parseLocalDate(iso)
  if (!d) return iso
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "2-digit", day: "2-digit" })
}

export function OrdersTable({ refreshKey, configMissing, initialFilter = null }: Props) {
  const readOnly = useReadOnly()
  const gate = usePasswordGate()
  const [orders, setOrders] = useState<OrdenProduccion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incomingFilter, setIncomingFilter] = useState<ModuleFilter | null>(initialFilter)
  useEffect(() => { setIncomingFilter(initialFilter); setPage(1) }, [initialFilter])
  const [filterCliente, setFilterCliente] = useState("")
  const [filterFolio, setFilterFolio] = useState("")
  const [filterModelo, setFilterModelo] = useState("")
  const [page, setPage] = useState(1)
  const [scheduleId, setScheduleId] = useState<number | string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleCutId, setScheduleCutId] = useState<number | string | null>(null)
  const [scheduleCutOpen, setScheduleCutOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OrdenProduccion | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [skippingId, setSkippingId] = useState<number | string | null>(null)
  const [anularTarget, setAnularTarget] = useState<{ row: OrdenProduccion; tipo: "diseno" | "corte" } | null>(null)
  const [anulando, setAnulando] = useState(false)
  const [savingDateId, setSavingDateId] = useState<number | string | null>(null)
  const [savingConfirmId, setSavingConfirmId] = useState<number | string | null>(null)
  const [editingClienteId, setEditingClienteId] = useState<number | string | null>(null)
  const [editingClienteValue, setEditingClienteValue] = useState("")
  const [savingClienteId, setSavingClienteId] = useState<number | string | null>(null)
  /** Folios cuyo corte ya se registró como cumplido. */
  const [corteCumplido, setCorteCumplido] = useState<Set<string>>(new Set())
  /** Avance por folio. Una fila por folio, no una por etapa. */
  const [avance, setAvance] = useState<Map<string, VwOrdenAvance>>(new Map())
  const [etapasFolio, setEtapasFolio] = useState<string | null>(null)
  const [etapasOpen, setEtapasOpen] = useState(false)
  const [crearOpen, setCrearOpen] = useState(false)
  /** La orden cuyos precios se estan corrigiendo, o null. */
  const [preciosId, setPreciosId] = useState<number | null>(null)
  const ficha = useFichaTecnica()

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return
    // Segunda barrera, además del menú apagado: un folio que ya arrancó
    // maquila tiene tela cortada y gente trabajando. La interfaz sola no
    // basta — el diálogo pudo quedar abierto desde antes del arranque.
    if (deleteTarget.fecha_s1) {
      toast.error("No se puede eliminar", {
        description: `El folio ${deleteTarget.folio} ya arrancó maquila el ${formatDate(deleteTarget.fecha_s1)}.`,
      })
      setDeleteTarget(null)
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setDeleting(true)
    const { error } = await supabase
      .from("ordenes_produccion")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("idempresa", IDEMPRESA)
    setDeleting(false)
    if (error) {
      console.error("delete folio error:", error)
      // 23503: hay recepciones, penalizaciones o pagos colgando del folio
      // (FK con ON DELETE RESTRICT, script 028). Borrarlo dejaría dinero
      // registrado sin orden a la que pertenecer.
      const esReferenciado = error.code === "23503"
      toast.error("No se pudo eliminar el folio", {
        description: esReferenciado
          ? "Tiene movimientos de Pago Maquilas registrados. Elimínalos primero desde ese módulo."
          : error.message,
      })
    } else {
      setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id))
      toast.success(`Folio ${deleteTarget.folio} eliminado.`)
    }
    setDeleteTarget(null)
  }

  // Cambiar fechas requiere contraseña
  const requestFechaCancelacionChange = (row: OrdenProduccion, date: Date | undefined) =>
    gate.request(() => handleFechaCancelacionChange(row, date))
  const requestFechaLimiteConfirmacionChange = (row: OrdenProduccion, date: Date | undefined) =>
    gate.request(() => handleFechaLimiteConfirmacionChange(row, date))

  const handleFechaCancelacionChange = async (row: OrdenProduccion, date: Date | undefined) => {
    if (row.id == null) return
    const supabase = getSupabase()
    if (!supabase) return
    const fechaISO = date ? format(date, "yyyy-MM-dd") : null
    setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, fecha_cancelacion: fechaISO } : o))
    setSavingDateId(row.id)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ fecha_cancelacion: fechaISO })
      .eq("id", row.id)
      .eq("idempresa", IDEMPRESA)
    setSavingDateId(null)
    if (error) {
      setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, fecha_cancelacion: row.fecha_cancelacion } : o))
      toast.error("No se pudo actualizar la fecha", { description: error.message })
    }
  }

  const handleFechaLimiteConfirmacionChange = async (row: OrdenProduccion, date: Date | undefined) => {
    if (row.id == null) return
    const supabase = getSupabase()
    if (!supabase) return
    const fechaISO = date ? format(date, "yyyy-MM-dd") : null
    setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, fecha_limite_confirmacion: fechaISO } : o))
    setSavingConfirmId(row.id)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ fecha_limite_confirmacion: fechaISO })
      .eq("id", row.id)
      .eq("idempresa", IDEMPRESA)
    setSavingConfirmId(null)
    if (error) {
      setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, fecha_limite_confirmacion: row.fecha_limite_confirmacion } : o))
      toast.error("No se pudo actualizar la fecha límite de confirmación", { description: error.message })
    }
  }

  const handleClienteSave = async (row: OrdenProduccion, value: string) => {
    if (row.id == null) return
    const trimmed = value.trim()
    setEditingClienteId(null)
    const prev = row.cliente
    setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, cliente: trimmed || null } : o))
    setSavingClienteId(row.id)
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ cliente: trimmed || null })
      .eq("id", row.id)
      .eq("idempresa", IDEMPRESA)
    setSavingClienteId(null)
    if (error) {
      setOrders((p) => p.map((o) => o.id === row.id ? { ...o, cliente: prev } : o))
      toast.error("No se pudo actualizar el cliente", { description: error.message })
    }
  }

  const handleSkipPhase = async (
    row: OrdenProduccion,
    field: "no_requiere_diseno" | "no_requiere_corte",
    value = true,
  ) => {
    const supabase = getSupabase()
    if (!supabase || row.id == null) return
    setSkippingId(row.id)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ [field]: value })
      .eq("id", row.id)
      .eq("idempresa", IDEMPRESA)
    setSkippingId(null)
    if (error) {
      toast.error("No se pudo actualizar la orden", { description: error.message })
    } else {
      const label = field === "no_requiere_diseno" ? "Diseño" : "Corte"
      if (value) {
        toast.success(`Folio ${row.folio} marcado como: No pasa por ${label}.`)
      } else {
        toast.success(`${label} habilitado para programar`, { description: `Folio ${row.folio}` })
      }
      setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, [field]: value } : o))
    }
  }

  const handleConfirmAnular = async () => {
    if (!anularTarget) return
    const { row, tipo } = anularTarget
    if (row.id == null || row.folio == null) return
    const supabase = getSupabase()
    if (!supabase) return
    setAnulando(true)
    try {
      // RPC transaccional (script 014): borra las filas de programación y
      // resetea el flag de la orden en una sola transacción — sin estados
      // intermedios inconsistentes si algo falla a la mitad.
      const { error } = await supabase.rpc("fn_anular_programacion", {
        p_folio: row.folio,
        p_idempresa: IDEMPRESA,
        p_tipo: tipo,
      })
      if (error) {
        toast.error("No se pudo anular la programación", { description: error.message })
        return
      }
      const field = tipo === "diseno" ? "diseno_programado" : "corte_programado"
      const label = tipo === "diseno" ? "Diseño" : "Corte"
      toast.success(`Programación de ${label} anulada`, { description: `Folio ${row.folio}` })
      setOrders((prev) => prev.map((o) => o.id === row.id ? { ...o, [field]: false } : o))
    } catch (err) {
      toast.error("Error inesperado al anular", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setAnulando(false)
      setAnularTarget(null)
    }
  }

  const fetchOrders = async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    setError(null)
    // Panel General lista TODAS las órdenes, en cualquier fase.
    //
    // Antes se limitaba a "Por Programar" y ocultaba 201 de 552: buscar un
    // folio que ya estaba en maquila no daba resultado aquí aunque el
    // buscador global sí lo encontrara. Para trabajar solo lo pendiente
    // está el filtro `sin-programar` que llega desde Inicio.
    //
    // Las facturadas sí se excluyen: cerraron su ciclo.
    const { data, error } = await fetchAll(() =>
      supabase
        .from("ordenes_produccion")
        .select(
          "id, folio, num_pedido, modelo, familia, cliente, piezas, fecha_pedido, fecha_cancelacion, fecha_limite_confirmacion, tipo_pedido, fase_actual, idempresa, corte_origen, diseno_programado, no_requiere_diseno, no_requiere_corte, corte_programado, fecha_aprobacion_diseno, fecha_facturacion, fecha_s1, precio_venta, precio_publico",
        )
        .eq("idempresa", IDEMPRESA)
        .is("fecha_facturacion", null)
        .order("fecha_cancelacion", { ascending: true, nullsFirst: false }),
    )

    if (error) {
      console.error("Fetch error:", error)
      setError(error.message)
      setOrders([])
      setLoading(false)
      return
    }

    setOrders((data ?? []) as OrdenProduccion[])

    // El corte cumplido vive en corte_programacion, no en la orden. Se piden
    // solo los folios cumplidos (un puñado) en vez de cruzar los ~300 visibles.
    const { data: corteData, error: corteError } = await fetchAll(() =>
      supabase
        .from("corte_programacion")
        .select("folio")
        .eq("idempresa", IDEMPRESA)
        .eq("cumplimiento_corte", "Si"),
    )

    if (corteError) {
      // No bloquea la tabla: solo faltará distinguir "Corte Completado"
      console.error("Fetch corte cumplido error:", corteError)
    } else {
      setCorteCumplido(
        new Set((corteData ?? []).map((c) => (c as { folio: string }).folio).filter(Boolean)),
      )
    }

    // El avance de las etapas: una fila por folio (`vw_orden_avance`), no
    // una por etapa. Traer `vw_orden_etapas` completa serían 5,535 renglones
    // en cada carga de Panel General para pintar un indicador.
    const { data: avanceData, error: avanceError } = await fetchAll<VwOrdenAvance>(() =>
      supabase.from("vw_orden_avance").select("*").eq("idempresa", IDEMPRESA),
    )

    if (avanceError) {
      // No bloquea la tabla: solo faltará la columna de etapas.
      console.error("Fetch avance etapas error:", avanceError)
    } else {
      setAvance(new Map(avanceData.map((a) => [a.folio, a])))
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, configMissing])

  const filtered = useMemo(() => {
    const c = filterCliente.trim().toLowerCase()
    const f = filterFolio.trim().toLowerCase()
    const m = filterModelo.trim().toLowerCase()
    return orders.filter((o) => {
      if (c && !(o.cliente ?? "").toLowerCase().includes(c)) return false
      if (f && !(o.folio ?? "").toLowerCase().includes(f)) return false
      if (m && !(o.modelo ?? "").toLowerCase().includes(m)) return false
      // Filtro heredado del inicio
      if (incomingFilter === "sin-programar" && o.fase_actual !== "Por Programar") return false
      return true
    })
  }, [orders, filterCliente, filterFolio, filterModelo, incomingFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [filterCliente, filterFolio, filterModelo])

  return (
    <div className="space-y-4">
      <Tabs defaultValue="ordenes" className="w-full">
        <TabsList>
          <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
          <TabsTrigger value="etapas">Etapas por folio</TabsTrigger>
          <TabsTrigger value="cola">Folios por etapa</TabsTrigger>
        </TabsList>

        <TabsContent value="ordenes" className="mt-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:flex-1">
          <FilterInput
            placeholder="Filtrar por Cliente"
            value={filterCliente}
            onChange={setFilterCliente}
          />
          <FilterInput
            placeholder="Filtrar por Folio"
            value={filterFolio}
            onChange={setFilterFolio}
          />
          <FilterInput
            placeholder="Filtrar por Modelo"
            value={filterModelo}
            onChange={setFilterModelo}
          />
        </div>
        <div className="flex items-center gap-2 md:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOrders}
            disabled={loading || configMissing}
            className="gap-2 bg-transparent"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Actualizar
          </Button>
          <Button
            size="sm"
            onClick={() => setCrearOpen(true)}
            disabled={readOnly || configMissing}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            Nueva orden
          </Button>
        </div>
      </div>

      {/* Filtro heredado del inicio */}
      {incomingFilter && (
        <IncomingFilterChip filter={incomingFilter} onClear={() => setIncomingFilter(null)} />
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Alto fijo con encabezado pegajoso: la tabla ocupa más pantalla sin empujar el pie */}
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="font-semibold">Folio</TableHead>
                <TableHead className="font-semibold">Modelo</TableHead>
                <TableHead className="font-semibold">Familia</TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                <TableHead className="font-semibold text-right">Piezas</TableHead>
                <TableHead className="font-semibold">Límite de Confirmación</TableHead>
                <TableHead className="font-semibold">Límite de Entrega</TableHead>
                <TableHead className="font-semibold">Riesgo</TableHead>
                <TableHead className="font-semibold">Tipo Pedido</TableHead>
                <TableHead className="font-semibold">Etapas</TableHead>
                <TableHead className="font-semibold text-right">Acciones</TableHead>
                <TableHead className="font-semibold">Fase Maquila</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-24 text-center text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">
                    {orders.length === 0 ? (
                      <span>
                        Sin órdenes registradas aún.{" "}
                        <span className="text-foreground">Sube tu archivo Excel de pedidos en la sección de arriba para comenzar.</span>
                      </span>
                    ) : (
                      "Sin coincidencias para los filtros aplicados."
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row) => (
                  <TableRow key={String(row.id ?? row.folio)} className="hover:bg-muted/30">
                    <TableCell>
                      <FolioLink folio={row.folio} className="text-xs" />
                    </TableCell>
                    <TableCell className="text-sm">{row.modelo ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.familia ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {editingClienteId === row.id ? (
                        <input
                          autoFocus
                          className="w-28 rounded border border-ring bg-background px-1.5 py-0.5 text-sm outline-none ring-1 ring-ring"
                          value={editingClienteValue}
                          onChange={(e) => setEditingClienteValue(e.target.value)}
                          onBlur={() => handleClienteSave(row, editingClienteValue)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleClienteSave(row, editingClienteValue)
                            if (e.key === "Escape") setEditingClienteId(null)
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => { setEditingClienteId(row.id ?? null); setEditingClienteValue(row.cliente ?? "") }}
                          className={cn(
                            "rounded px-1 py-0.5 text-left text-sm transition-colors",
                            readOnly ? "cursor-default" : "hover:bg-muted",
                            savingClienteId === row.id ? "opacity-60" : "",
                            !row.cliente ? "text-muted-foreground italic" : "text-foreground",
                          )}
                        >
                          {savingClienteId === row.id ? <Loader2 className="inline size-3.5 animate-spin" /> : (row.cliente ?? "—")}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.piezas?.toLocaleString("es-MX") ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={readOnly || savingConfirmId === row.id}
                            className={cn(
                              "h-auto gap-1.5 px-2 py-1 text-xs font-normal",
                              savingConfirmId === row.id
                                ? "opacity-60"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {savingConfirmId === row.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <CalendarIcon className="size-3.5" />
                            )}
                            {formatDate(row.fecha_limite_confirmacion ?? null)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={row.fecha_limite_confirmacion ? parseLocalDate(row.fecha_limite_confirmacion) ?? undefined : undefined}
                            onSelect={(d) => requestFechaLimiteConfirmacionChange(row, d)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={readOnly || savingDateId === row.id}
                            className={cn(
                              "h-auto gap-1.5 px-2 py-1 text-xs font-normal",
                              savingDateId === row.id
                                ? "opacity-60"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {savingDateId === row.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <CalendarIcon className="size-3.5" />
                            )}
                            {formatDate(row.fecha_cancelacion)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={row.fecha_cancelacion ? parseLocalDate(row.fecha_cancelacion) ?? undefined : undefined}
                            onSelect={(d) => requestFechaCancelacionChange(row, d)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const { risk, days } = computeRisk(
                          row.fecha_cancelacion,
                          0,
                          row.fase_actual,
                          row.fecha_facturacion,
                        )
                        return <RiskBadge risk={risk} days={days} />
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {row.tipo_pedido ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <AvanceEtapas
                        etapas={avance.get(row.folio)?.etapas_detalle ?? []}
                        disabled={!row.folio}
                        onClick={() => {
                          setEtapasFolio(row.folio)
                          setEtapasOpen(true)
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* ── Registro de etapas ── */}
                        <Button
                          size="sm"
                          variant="outline"
                          title="Registrar el avance de las nueve etapas"
                          className="gap-1.5"
                          disabled={readOnly || !row.folio}
                          onClick={() => {
                            setEtapasFolio(row.folio)
                            setEtapasOpen(true)
                          }}
                        >
                          <ClipboardList className="size-3.5" />
                          Etapas
                        </Button>

                        {/* ── Menú de opciones adicionales ── */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="px-1.5"
                              disabled={readOnly || skippingId === row.id}
                            >
                              {skippingId === row.id
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <ChevronDown className="size-3.5" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {row.diseno_programado && (
                              <DropdownMenuItem
                                onClick={() => setAnularTarget({ row, tipo: "diseno" })}
                                className="text-orange-700 focus:text-orange-700"
                              >
                                <XCircle className="size-3.5 mr-2 shrink-0" />
                                Anular programación de Diseño
                              </DropdownMenuItem>
                            )}
                            {row.corte_programado && (
                              <DropdownMenuItem
                                onClick={() => setAnularTarget({ row, tipo: "corte" })}
                                className="text-orange-700 focus:text-orange-700"
                              >
                                <XCircle className="size-3.5 mr-2 shrink-0" />
                                Anular programación de Corte
                              </DropdownMenuItem>
                            )}
                            {row.no_requiere_diseno && !row.diseno_programado && (
                              <DropdownMenuItem
                                onClick={() => handleSkipPhase(row, "no_requiere_diseno", false)}
                                className="text-indigo-700 focus:text-indigo-700"
                              >
                                <RotateCcw className="size-3.5 mr-2 shrink-0" />
                                Revertir: Habilitar Diseño
                              </DropdownMenuItem>
                            )}
                            {row.no_requiere_corte && !row.corte_programado && (
                              <DropdownMenuItem
                                onClick={() => handleSkipPhase(row, "no_requiere_corte", false)}
                                className="text-indigo-700 focus:text-indigo-700"
                              >
                                <RotateCcw className="size-3.5 mr-2 shrink-0" />
                                Revertir: Habilitar Corte
                              </DropdownMenuItem>
                            )}
                            {/* Una etapa ya completada no puede marcarse como omitida */}
                            {!row.diseno_programado && !row.no_requiere_diseno && !row.fecha_aprobacion_diseno && (
                              <DropdownMenuItem
                                onClick={() => handleSkipPhase(row, "no_requiere_diseno")}
                                className="text-amber-700 focus:text-amber-700"
                              >
                                <Ban className="size-3.5 mr-2 shrink-0" />
                                Marcar: No pasa por Diseño
                              </DropdownMenuItem>
                            )}
                            {!row.corte_programado && !row.no_requiere_corte && !corteCumplido.has(row.folio) && (
                              <DropdownMenuItem
                                onClick={() => handleSkipPhase(row, "no_requiere_corte")}
                                className="text-amber-700 focus:text-amber-700"
                              >
                                <Ban className="size-3.5 mr-2 shrink-0" />
                                Marcar: No pasa por Corte
                              </DropdownMenuItem>
                            )}
                            {/*
                              Los precios se capturan al crear el pedido,
                              pero las 638 ordenes que ya existen nacieron
                              antes de esa regla: sin un sitio donde
                              corregirlos quedarian congeladas.
                            */}
                            <DropdownMenuItem onClick={() => setPreciosId(Number(row.id))}>
                              <DollarSign className="size-3.5 mr-2 shrink-0" />
                              Editar precios
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {/*
                              Un folio que ya arranco maquila no se borra:
                              hay tela cortada y alguien trabajando. Antes
                              de eso todo es reversible —programar una
                              semana se puede deshacer, cortar no— asi que
                              se permite.

                              La opcion se deja VISIBLE pero apagada, con
                              el motivo: si desapareciera, quien la busca no
                              sabria si es un error de la pantalla.
                            */}
                            <DropdownMenuItem
                              onClick={() => {
                                if (row.fecha_s1) return
                                setDeleteTarget(row)
                              }}
                              disabled={Boolean(row.fecha_s1)}
                              title={
                                row.fecha_s1
                                  ? `Ya arrancó maquila el ${formatDate(row.fecha_s1)}: no se puede eliminar`
                                  : undefined
                              }
                              className={cn(
                                !row.fecha_s1 && "text-destructive focus:text-destructive",
                              )}
                            >
                              <Trash2 className="size-3.5 mr-2 shrink-0" />
                              {row.fecha_s1 ? "En producción — no se elimina" : "Eliminar folio"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                    <TableCell>
                      <FaseBadge fase={row.fase_actual} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <p className="text-muted-foreground">
          Mostrando{" "}
          <span className="font-medium text-foreground">
            {pageRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}
            {"–"}
            {(currentPage - 1) * PAGE_SIZE + pageRows.length}
          </span>{" "}
          de <span className="font-medium text-foreground">{filtered.length}</span> órdenes por programar
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      </div>
        </TabsContent>

        {/*
          El tablero extendido carga `vw_orden_etapas` completa (9 filas por
          folio) porque necesita la fecha de cada etapa. Vive en su propia
          pestaña para que ese costo se pague solo cuando alguien la abre.
        */}
        <TabsContent value="etapas" className="mt-4">
          <EtapasTablero configMissing={configMissing} />
        </TabsContent>

        {/*
          La vista inversa del tablero: en vez de «en que punto va este
          folio», responde «que le toca a esta etapa». Es para repartir
          trabajo, no para seguir una orden.
        */}
        <TabsContent value="cola" className="mt-4">
          <EtapasCola configMissing={configMissing} />
        </TabsContent>
      </Tabs>

      <ScheduleDesignSheet
        ordenId={scheduleId}
        open={scheduleOpen}
        onOpenChange={(o) => {
          setScheduleOpen(o)
          if (!o) setScheduleId(null)
        }}
        onScheduled={fetchOrders}
      />

      <ScheduleCutDialog
        open={scheduleCutOpen}
        onOpenChange={(o) => {
          setScheduleCutOpen(o)
          if (!o) setScheduleCutId(null)
        }}
        orden={orders.find((o) => o.id === scheduleCutId) ?? null}
        onSaved={() => {
          setScheduleCutOpen(false)
          setScheduleCutId(null)
          void fetchOrders()
        }}
      />

      {/*
        Al crear, se abre enseguida su ficha tecnica: la orden nace con lo
        minimo y el resto —tallas, materiales, costos— se captura ahi.
      */}
      <CrearOrdenDialog
        open={crearOpen}
        onOpenChange={setCrearOpen}
        onCreada={(folio) => {
          void fetchOrders()
          ficha.registrarRefresco(() => void fetchOrders())
          ficha.abrir(folio)
        }}
      />

      <EditarPreciosDialog
        orden={(() => {
          // Se normaliza el id: `OrdenProduccion.id` puede venir como
          // texto o faltar —la fila puede nacer del Excel— y el diálogo
          // necesita uno concreto para actualizar.
          const o = orders.find((x) => x.id != null && Number(x.id) === preciosId)
          if (!o) return null
          return {
            id: Number(o.id),
            folio: o.folio,
            modelo: o.modelo ?? null,
            // Los precios son opcionales en `OrdenProduccion`: si la
            // consulta no los pidiera llegarian `undefined`, que no es
            // lo mismo que "sin precio".
            precio_venta: o.precio_venta ?? null,
            precio_publico: o.precio_publico ?? null,
          }
        })()}
        onOpenChange={(v) => !v && setPreciosId(null)}
        onGuardado={() => {
          setPreciosId(null)
          void fetchOrders()
        }}
      />

      <EtapasOrdenSheet
        folio={etapasFolio}
        idOrden={Number(orders.find((o) => o.folio === etapasFolio)?.id) || null}
        onProgramarDiseno={() => {
          const o = orders.find((x) => x.folio === etapasFolio)
          if (o?.id == null) return
          setScheduleId(o.id)
          setScheduleOpen(true)
        }}
        onProgramarCorte={() => {
          const o = orders.find((x) => x.folio === etapasFolio)
          if (o?.id == null) return
          setScheduleCutId(o.id)
          setScheduleCutOpen(true)
        }}
        open={etapasOpen}
        onOpenChange={(o) => {
          setEtapasOpen(o)
          if (!o) setEtapasFolio(null)
        }}
        onSaved={fetchOrders}
      />

      <AlertDialog open={anularTarget !== null} onOpenChange={(o) => { if (!o && !anulando) setAnularTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Anular programación de {anularTarget?.tipo === "diseno" ? "Diseño" : "Corte"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el registro de{" "}
              {anularTarget?.tipo === "diseno" ? "diseño" : "corte"} del folio{" "}
              <span className="font-mono font-medium">{anularTarget?.row.folio ?? ""}</span>{" "}
              y el folio quedará disponible para ser programado nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anulando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={handleConfirmAnular}
              disabled={anulando}
            >
              {anulando ? "Anulando…" : "Anular programación"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el folio {deleteTarget?.folio}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente la orden con folio{" "}
              <span className="font-mono font-medium">{deleteTarget?.folio ?? ""}</span>.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {gate.dialog}
    </div>
  )
}

function FilterInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  )
}

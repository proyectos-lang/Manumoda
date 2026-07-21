"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, CalendarIcon, RefreshCw, CheckCircle2, Trash2, ChevronDown, Ban, Pencil, XCircle, RotateCcw } from "lucide-react"
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
import type { OrdenProduccion } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ScheduleDesignSheet } from "@/components/schedule-design-sheet"
import { ScheduleCutDialog } from "@/components/schedule-cut-dialog"
import { FolioLink } from "@/components/folio-detail-drawer"
import { RiskBadge } from "@/components/risk-badge"
import { IncomingFilterChip } from "@/components/incoming-filter-chip"
import type { ModuleFilter } from "@/lib/module-filter"
import { computeRisk } from "@/lib/risk"
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

const PAGE_SIZE = 10

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
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "2-digit", day: "2-digit" })
}

export function OrdersTable({ refreshKey, configMissing, initialFilter = null }: Props) {
  const [orders, setOrders] = useState<OrdenProduccion[]>([])
  const [entregadosOcultos, setEntregadosOcultos] = useState(0)
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

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return
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
      toast.error("No se pudo eliminar el folio", { description: error.message })
    } else {
      setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id))
      toast.success(`Folio ${deleteTarget.folio} eliminado.`)
    }
    setDeleteTarget(null)
  }

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
    // Los pedidos entregados (facturados) cerraron su ciclo y no se listan aquí.
    // Se cuentan aparte para dejar constancia de que existen.
    const [{ data, error }, { count: entregados }] = await Promise.all([
      supabase
        .from("ordenes_produccion")
        .select(
          "id, folio, num_pedido, modelo, familia, cliente, piezas, fecha_pedido, fecha_cancelacion, fecha_limite_confirmacion, tipo_pedido, fase_actual, idempresa, corte_origen, diseno_programado, no_requiere_diseno, no_requiere_corte, corte_programado, fecha_facturacion",
        )
        .eq("idempresa", IDEMPRESA)
        .is("fecha_facturacion", null)
        .order("fecha_cancelacion", { ascending: true, nullsFirst: false }),
      supabase
        .from("ordenes_produccion")
        .select("*", { count: "exact", head: true })
        .eq("idempresa", IDEMPRESA)
        .not("fecha_facturacion", "is", null),
    ])

    if (error) {
      console.error("Fetch error:", error)
      setError(error.message)
      setOrders([])
    } else {
      setOrders((data ?? []) as OrdenProduccion[])
      setEntregadosOcultos(entregados ?? 0)
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
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOrders}
          disabled={loading || configMissing}
          className="gap-2 md:self-auto bg-transparent"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Filtro heredado del inicio */}
      {incomingFilter && (
        <IncomingFilterChip filter={incomingFilter} onClear={() => setIncomingFilter(null)} />
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Folio</TableHead>
                <TableHead className="font-semibold">Modelo</TableHead>
                <TableHead className="font-semibold">Familia</TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                <TableHead className="font-semibold text-right">Piezas</TableHead>
                <TableHead className="font-semibold">Fecha Límite</TableHead>
                <TableHead className="font-semibold">Riesgo</TableHead>
                <TableHead className="font-semibold">Límite Conf.</TableHead>
                <TableHead className="font-semibold">Tipo Pedido</TableHead>
                <TableHead className="font-semibold text-right">Acciones</TableHead>
                <TableHead className="font-semibold">Fase Maquila</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
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
                          onClick={() => { setEditingClienteId(row.id ?? null); setEditingClienteValue(row.cliente ?? "") }}
                          className={cn(
                            "rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-muted",
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
                            disabled={savingDateId === row.id}
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
                            selected={row.fecha_cancelacion ? new Date(row.fecha_cancelacion + "T00:00:00") : undefined}
                            onSelect={(d) => handleFechaCancelacionChange(row, d)}
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
                    <TableCell className="text-sm">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={savingConfirmId === row.id}
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
                            selected={row.fecha_limite_confirmacion ? new Date(row.fecha_limite_confirmacion + "T00:00:00") : undefined}
                            onSelect={(d) => handleFechaLimiteConfirmacionChange(row, d)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {row.tipo_pedido ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* ── Botón Diseño ── */}
                        {row.diseno_programado ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => {
                              if (row.id == null) return
                              setScheduleId(row.id)
                              setScheduleOpen(true)
                            }}
                            disabled={row.id == null}
                          >
                            <Pencil className="size-3.5" />
                            Reprogramar Diseño
                          </Button>
                        ) : row.no_requiere_diseno ? (
                          <Button size="sm" disabled variant="ghost" className="cursor-default gap-1.5 text-muted-foreground line-through opacity-60">
                            <Ban className="size-3.5" />
                            Omitió Diseño
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (row.id == null) return
                              setScheduleId(row.id)
                              setScheduleOpen(true)
                            }}
                            disabled={row.id == null}
                          >
                            Programar en Diseño
                          </Button>
                        )}

                        {/* ── Botón Corte ── */}
                        {row.corte_programado ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => {
                              if (row.id == null) return
                              setScheduleCutId(row.id)
                              setScheduleCutOpen(true)
                            }}
                            disabled={row.id == null}
                          >
                            <Pencil className="size-3.5" />
                            Reprogramar Corte
                          </Button>
                        ) : row.no_requiere_corte ? (
                          <Button size="sm" disabled variant="ghost" className="cursor-default gap-1.5 text-muted-foreground line-through opacity-60">
                            <Ban className="size-3.5" />
                            Omitió Corte
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (row.id == null) return
                              setScheduleCutId(row.id)
                              setScheduleCutOpen(true)
                            }}
                            disabled={row.id == null}
                          >
                            Programar en Corte
                          </Button>
                        )}

                        {/* ── Menú de opciones adicionales ── */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="px-1.5"
                              disabled={skippingId === row.id}
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
                            {!row.diseno_programado && !row.no_requiere_diseno && (
                              <DropdownMenuItem
                                onClick={() => handleSkipPhase(row, "no_requiere_diseno")}
                                className="text-amber-700 focus:text-amber-700"
                              >
                                <Ban className="size-3.5 mr-2 shrink-0" />
                                Marcar: No pasa por Diseño
                              </DropdownMenuItem>
                            )}
                            {!row.corte_programado && !row.no_requiere_corte && (
                              <DropdownMenuItem
                                onClick={() => handleSkipPhase(row, "no_requiere_corte")}
                                className="text-amber-700 focus:text-amber-700"
                              >
                                <Ban className="size-3.5 mr-2 shrink-0" />
                                Marcar: No pasa por Corte
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(row)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="size-3.5 mr-2 shrink-0" />
                              Eliminar folio
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
          de <span className="font-medium text-foreground">{filtered.length}</span> órdenes
          {entregadosOcultos > 0 && (
            <span className="ml-2 text-muted-foreground/70">
              · {entregadosOcultos} entregado{entregadosOcultos === 1 ? "" : "s"} no se{" "}
              {entregadosOcultos === 1 ? "muestra" : "muestran"}
            </span>
          )}
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
            <AlertDialogTitle>¿Eliminar folio?</AlertDialogTitle>
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

"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, Calendar, RefreshCw, CheckCircle2, Trash2 } from "lucide-react"
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
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ScheduleDesignSheet } from "@/components/schedule-design-sheet"
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

type Props = {
  refreshKey: number
  configMissing: boolean
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

export function OrdersTable({ refreshKey, configMissing }: Props) {
  const [orders, setOrders] = useState<OrdenProduccion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCliente, setFilterCliente] = useState("")
  const [filterFolio, setFilterFolio] = useState("")
  const [filterModelo, setFilterModelo] = useState("")
  const [page, setPage] = useState(1)
  const [scheduleId, setScheduleId] = useState<number | string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OrdenProduccion | null>(null)
  const [deleting, setDeleting] = useState(false)

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
      console.error("[v0] delete folio error:", error)
      toast.error("No se pudo eliminar el folio", { description: error.message })
    } else {
      setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id))
      toast.success(`Folio ${deleteTarget.folio} eliminado.`)
    }
    setDeleteTarget(null)
  }

  const fetchOrders = async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from("ordenes_produccion")
      .select(
        "id, folio, num_pedido, modelo, familia, cliente, piezas, fecha_pedido, fecha_cancelacion, tipo_pedido, fase_actual, idempresa, corte_origen, diseno_programado",
      )
      .eq("idempresa", IDEMPRESA)
      .order("fecha_cancelacion", { ascending: true, nullsFirst: false })

    if (error) {
      console.error("[v0] Fetch error:", error)
      setError(error.message)
      setOrders([])
    } else {
      setOrders((data ?? []) as OrdenProduccion[])
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
      return true
    })
  }, [orders, filterCliente, filterFolio, filterModelo])

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

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Folio</TableHead>
                <TableHead className="font-semibold">Pedido</TableHead>
                <TableHead className="font-semibold">Modelo</TableHead>
                <TableHead className="font-semibold">Familia</TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                <TableHead className="font-semibold text-right">Piezas</TableHead>
                <TableHead className="font-semibold">Fecha Límite</TableHead>
                <TableHead className="font-semibold">Tipo Pedido</TableHead>
                <TableHead className="font-semibold">Fase</TableHead>
                <TableHead className="font-semibold text-right">Acciones</TableHead>
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
                    {orders.length === 0
                      ? "Sin órdenes registradas."
                      : "Sin coincidencias para los filtros aplicados."}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row) => (
                  <TableRow key={String(row.id ?? row.folio)} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs font-medium text-foreground">
                      {row.folio}
                    </TableCell>
                    <TableCell className="text-sm">{row.num_pedido ?? "-"}</TableCell>
                    <TableCell className="text-sm">{row.modelo ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.familia ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">{row.cliente ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.piezas?.toLocaleString("es-MX") ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="size-3.5" />
                        {formatDate(row.fecha_cancelacion)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {row.tipo_pedido ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <FaseBadge fase={row.fase_actual} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.diseno_programado ? (
                          <Button
                            size="sm"
                            disabled
                            className="cursor-default gap-1.5 bg-slate-100 text-emerald-700 hover:bg-slate-100 border border-emerald-200"
                          >
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                            Diseño Listo
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => console.log("Pendiente de desarrollo")}
                        >
                          Programar en Corte
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(row)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                          title="Eliminar folio"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
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

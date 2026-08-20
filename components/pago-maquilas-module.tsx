"use client"

/**
 * Pago Maquilas — cuentas por pagar a los maquileros.
 *
 * El dinero se deriva, no se guarda: el costo unitario vive en la orden y
 * el total sale de multiplicarlo por las piezas recibidas (vista
 * `vw_pago_maquilas`, script 028). Lo único guardado son los pagos.
 *
 * Las cuatro pestañas responden a cuatro preguntas distintas:
 *   · Cuentas    — ¿cómo va cada folio?
 *   · Recepciones— ¿qué llegó hoy?           (la captura del día a día)
 *   · Maquileros — ¿a quién le debo y cuánto? (para decidir a quién pagar)
 *   · Lavandería — otro acreedor, otra decisión.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react"
import * as XLSX from "xlsx"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { fmtCurrency } from "@/lib/format"
import { parseLocalDate } from "@/lib/risk"
import type {
  MaquilaPago,
  MaquilaPenalizacion,
  MaquilaRecepcion,
  VwPagoMaquilas,
} from "@/lib/types"
import { cn } from "@/lib/utils"

import { FolioLink } from "@/components/folio-detail-drawer"
import { KpiCard } from "@/components/kpi-card"
import { usePasswordGate } from "@/components/password-gate-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ─── Constantes y helpers ────────────────────────────────────────────────────

/** Tolerancia de centavo: nunca comparar saldos contra 0 exacto. */
const CENTAVO = 0.005

const ESTADO_STYLE: Record<VwPagoMaquilas["estado_pago"], string> = {
  "Sin costo": "border-amber-300 bg-amber-50 text-amber-700",
  "Sin recepción": "border-slate-200 bg-slate-100 text-slate-600",
  Sobrepagado: "border-rose-300 bg-rose-50 text-rose-700",
  Saldado: "border-emerald-300 bg-emerald-50 text-emerald-700",
  Parcial: "border-sky-300 bg-sky-50 text-sky-700",
  Pendiente: "border-violet-300 bg-violet-50 text-violet-700",
}

const hoyISO = () => format(new Date(), "yyyy-MM-dd")

function fmtFecha(iso: string | null | undefined) {
  const d = parseLocalDate(iso)
  return d ? format(d, "dd MMM yy", { locale: es }) : "—"
}

const num = (v: unknown) => Number(v ?? 0)

/**
 * Importe de la etapa. Muestra "Sin costo" en vez de "$0.00" cuando la orden
 * no tiene costo capturado: un cero y un dato faltante no son lo mismo, y
 * confundirlos hace que un maquilero al que se le debe parezca saldado.
 */
function Importe({ valor, capturado }: { valor: number; capturado: boolean }) {
  if (!capturado) {
    return <span className="text-xs font-medium text-amber-600">Sin costo</span>
  }
  return <span className="tabular-nums">{fmtCurrency(valor)}</span>
}

// ─── Módulo ──────────────────────────────────────────────────────────────────

export function PagoMaquilasModule({ configMissing }: { configMissing: boolean }) {
  const [rows, setRows] = useState<VwPagoMaquilas[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)

    const { data, error: e } = await supabase
      .from("vw_pago_maquilas")
      .select("*")
      .eq("idempresa", IDEMPRESA)
      .not("maquilero_nombre", "is", null)
      .order("folio")

    setLoading(false)
    if (e) {
      setError(e.message)
      return
    }
    setRows((data as VwPagoMaquilas[]) ?? [])
  }, [configMissing])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  /** Maquileros de las órdenes que no están en el catálogo. */
  const huerfanos = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((r) => r.idmaquilero == null && r.maquilero_nombre)
            .map((r) => r.maquilero_nombre as string),
        ),
      ),
    [rows],
  )

  return (
    <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-100 ring-1 ring-emerald-200">
          <Banknote className="size-4 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Pago Maquilas</h2>
          <p className="text-xs text-muted-foreground">
            Recepciones, penalizaciones y pagos por folio ·{" "}
            <code className="font-mono">vw_pago_maquilas</code>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {huerfanos.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-900">
            <span className="font-semibold">
              {huerfanos.length === 1
                ? "Un maquilero de las órdenes no está en el catálogo"
                : `${huerfanos.length} maquileros de las órdenes no están en el catálogo`}
              :
            </span>{" "}
            {huerfanos.join(", ")}. Sus folios se agrupan por el nombre del archivo, así
            que una variante de escritura los partiría en dos. Agrégalos en Configuración
            → Maquileros.
          </p>
        </div>
      )}

      <Tabs defaultValue="cuentas" className="w-full">
        <TabsList>
          <TabsTrigger value="cuentas">Cuentas por Pagar</TabsTrigger>
          <TabsTrigger value="recepciones">Recepciones</TabsTrigger>
          <TabsTrigger value="maquileros">Por Maquilero</TabsTrigger>
          <TabsTrigger value="lavanderia">Lavandería</TabsTrigger>
        </TabsList>

        <TabsContent value="cuentas" className="mt-5">
          <CuentasTab rows={rows} loading={loading} onRefresh={fetchRows} />
        </TabsContent>

        <TabsContent value="recepciones" className="mt-5">
          <RecepcionesTab rows={rows} loading={loading} onRefresh={fetchRows} />
        </TabsContent>

        <TabsContent value="maquileros" className="mt-5">
          <MaquilerosTab rows={rows} loading={loading} />
        </TabsContent>

        <TabsContent value="lavanderia" className="mt-5">
          <LavanderiaTab rows={rows} loading={loading} onRefresh={fetchRows} />
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ─── Pestaña 1: Cuentas por Pagar ────────────────────────────────────────────

type TabProps = {
  rows: VwPagoMaquilas[]
  loading: boolean
  onRefresh: () => void
}

function CuentasTab({ rows, loading, onRefresh }: TabProps) {
  const readOnly = useReadOnly()
  const [search, setSearch] = useState("")
  const [filtroMaquilero, setFiltroMaquilero] = useState("__all__")
  const [filtroEstado, setFiltroEstado] = useState("__all__")
  const [expandido, setExpandido] = useState<string | null>(null)

  const maquileros = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.beneficiario).filter(Boolean) as string[])).sort(),
    [rows],
  )

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filtroMaquilero !== "__all__" && r.beneficiario !== filtroMaquilero) return false
      if (filtroEstado !== "__all__" && r.estado_pago !== filtroEstado) return false
      if (q) {
        const heno = `${r.folio} ${r.modelo ?? ""} ${r.cliente ?? ""}`.toLowerCase()
        if (!heno.includes(q)) return false
      }
      return true
    })
  }, [rows, search, filtroMaquilero, filtroEstado])

  const kpis = useMemo(() => {
    let aPagar = 0
    let pagado = 0
    let sinCosto = 0
    let sobrepagos = 0
    for (const r of filtradas) {
      if (!r.costo_capturado) {
        sinCosto++
        continue
      }
      aPagar += num(r.valor_a_pagar)
      pagado += num(r.valor_pagado)
      if (num(r.saldo) < -CENTAVO) sobrepagos += Math.abs(num(r.saldo))
    }
    return { aPagar, pagado, saldo: aPagar - pagado, sinCosto, sobrepagos }
  }, [filtradas])

  const exportar = () => {
    if (filtradas.length === 0) {
      toast.warning("Sin datos para exportar con los filtros aplicados.")
      return
    }
    const datos = filtradas.map((r) => ({
      Folio: r.folio,
      Maquilero: r.beneficiario ?? "",
      Modelo: r.modelo ?? "",
      Cliente: r.cliente ?? "",
      "Piezas orden": r.piezas_orden ?? "",
      Recibidas: r.piezas_recibidas,
      Penalizadas: r.piezas_penalizadas,
      "Costo maquila": r.costo_maquila ?? "",
      "Valor maquila": num(r.valor_maquila),
      Penalizaciones: num(r.valor_penalizaciones),
      "Valor a pagar": num(r.valor_a_pagar),
      Pagado: num(r.valor_pagado),
      Saldo: num(r.saldo),
      Estado: r.estado_pago,
    }))
    const ws = XLSX.utils.json_to_sheet(datos)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Pago Maquilas")
    XLSX.writeFile(wb, `pago_maquilas_${hoyISO()}.xlsx`)
    toast.success(`${datos.length} folios exportados`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Valor a pagar"
          value={kpis.aPagar}
          format={fmtCurrency}
          icon={<Banknote className="size-3.5" />}
          iconBg="bg-violet-100 ring-violet-200"
          iconColor="text-violet-600"
          valueColor="text-violet-700"
        />
        <KpiCard
          label="Pagado"
          value={kpis.pagado}
          format={fmtCurrency}
          icon={<Wallet className="size-3.5" />}
          iconBg="bg-emerald-100 ring-emerald-200"
          iconColor="text-emerald-600"
          valueColor="text-emerald-700"
        />
        <KpiCard
          label="Saldo pendiente"
          value={kpis.saldo}
          format={fmtCurrency}
          icon={<Banknote className="size-3.5" />}
          iconBg="bg-sky-100 ring-sky-200"
          iconColor="text-sky-600"
          valueColor={kpis.saldo > CENTAVO ? "text-sky-700" : "text-foreground"}
        />
        <KpiCard
          label="Sobrepagos"
          value={kpis.sobrepagos}
          format={fmtCurrency}
          icon={<TriangleAlert className="size-3.5" />}
          iconBg="bg-rose-100 ring-rose-200"
          iconColor="text-rose-600"
          valueColor={kpis.sobrepagos > CENTAVO ? "text-rose-600" : "text-foreground"}
        />
        <KpiCard
          label="Folios sin costo"
          value={kpis.sinCosto}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.sinCosto > 0 ? "text-amber-600" : "text-foreground"}
          hint="No se puede pagar sin costo capturado"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Folio, modelo o cliente…"
            className="h-9 w-60 pl-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Select value={filtroMaquilero} onValueChange={setFiltroMaquilero}>
          <SelectTrigger className="h-9 w-52 bg-transparent">
            <SelectValue placeholder="Maquilero" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los maquileros</SelectItem>
            {maquileros.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="h-9 w-44 bg-transparent">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los estados</SelectItem>
            {Object.keys(ESTADO_STYLE).map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filtradas.length} de {rows.length} folios
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={filtradas.length === 0}
            className="gap-1.5 bg-transparent"
          >
            <Download className="size-3.5" />
            Exportar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-8" />
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Maquilero</TableHead>
              <TableHead className="font-semibold text-right">Orden</TableHead>
              <TableHead className="font-semibold text-right">Recibidas</TableHead>
              <TableHead className="font-semibold text-right">Penalizadas</TableHead>
              <TableHead className="font-semibold text-right">Valor a pagar</TableHead>
              <TableHead className="font-semibold text-right">Pagado</TableHead>
              <TableHead className="font-semibold text-right">Saldo</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-28 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Sin órdenes con maquilero asignado."
                    : "Sin folios para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtradas.map((r) => (
                <FolioRow
                  key={r.folio}
                  row={r}
                  expandido={expandido === r.folio}
                  onToggle={() => setExpandido(expandido === r.folio ? null : r.folio)}
                  onRefresh={onRefresh}
                  readOnly={readOnly}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ─── Fila de folio con su detalle ────────────────────────────────────────────

function FolioRow({
  row,
  expandido,
  onToggle,
  onRefresh,
  readOnly,
}: {
  row: VwPagoMaquilas
  expandido: boolean
  onToggle: () => void
  onRefresh: () => void
  readOnly: boolean
}) {
  const saldo = num(row.saldo)
  const sobrepago = saldo < -CENTAVO

  return (
    <>
      <TableRow
        className={cn("cursor-pointer hover:bg-muted/30", expandido && "bg-muted/30")}
        onClick={onToggle}
      >
        <TableCell className="text-muted-foreground">
          {expandido ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <FolioLink folio={row.folio} className="text-xs" />
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.modelo ?? "—"}</p>
        </TableCell>
        <TableCell className="text-sm">{row.beneficiario ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
          {row.piezas_orden?.toLocaleString("es-MX") ?? "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums text-sm">
          {row.piezas_recibidas.toLocaleString("es-MX")}
        </TableCell>
        <TableCell className="text-right tabular-nums text-sm">
          {row.piezas_penalizadas > 0 ? (
            <span
              className={cn(
                row.penalizadas_exceden_recibidas ? "font-semibold text-rose-600" : "text-rose-600",
              )}
              title={
                row.penalizadas_exceden_recibidas
                  ? "Se penalizaron más piezas de las recibidas — probable error de captura"
                  : undefined
              }
            >
              {row.piezas_penalizadas.toLocaleString("es-MX")}
              {row.penalizadas_exceden_recibidas && " ⚠"}
            </span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </TableCell>
        <TableCell className="text-right text-sm font-medium">
          <Importe valor={num(row.valor_a_pagar)} capturado={row.costo_capturado} />
        </TableCell>
        <TableCell className="text-right tabular-nums text-sm text-emerald-700">
          {num(row.valor_pagado) > 0 ? fmtCurrency(num(row.valor_pagado)) : <span className="text-muted-foreground/50">—</span>}
        </TableCell>
        <TableCell
          className={cn(
            "text-right tabular-nums text-sm font-semibold",
            sobrepago ? "text-rose-600" : "text-foreground",
          )}
        >
          {row.costo_capturado ? fmtCurrency(saldo) : "—"}
        </TableCell>
        <TableCell>
          <span
            className={cn(
              "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
              ESTADO_STYLE[row.estado_pago],
            )}
          >
            {row.estado_pago}
          </span>
        </TableCell>
      </TableRow>

      {expandido && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={10} className="p-0">
            <DetalleFolio row={row} onRefresh={onRefresh} readOnly={readOnly} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ─── Detalle: recepciones, penalizaciones y pagos ────────────────────────────

function DetalleFolio({
  row,
  onRefresh,
  readOnly,
}: {
  row: VwPagoMaquilas
  onRefresh: () => void
  readOnly: boolean
}) {
  const { user } = useAuth()
  const gate = usePasswordGate()
  const [recepciones, setRecepciones] = useState<MaquilaRecepcion[]>([])
  const [penalizaciones, setPenalizaciones] = useState<MaquilaPenalizacion[]>([])
  const [pagos, setPagos] = useState<MaquilaPago[]>([])
  const [cargando, setCargando] = useState(true)
  const [dialogo, setDialogo] = useState<"recepcion" | "penalizacion" | "pago" | null>(null)

  const cargar = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const filtro = (t: string) =>
      supabase.from(t).select("*").eq("idempresa", IDEMPRESA).eq("folio", row.folio).order("fecha")
    const [r, p, g] = await Promise.all([
      filtro("maquila_recepciones"),
      filtro("maquila_penalizaciones"),
      filtro("maquila_pagos"),
    ])
    setRecepciones((r.data as MaquilaRecepcion[]) ?? [])
    setPenalizaciones((p.data as MaquilaPenalizacion[]) ?? [])
    setPagos((g.data as MaquilaPago[]) ?? [])
    setCargando(false)
  }, [row.folio])

  useEffect(() => {
    cargar()
  }, [cargar])

  const refrescar = () => {
    cargar()
    onRefresh()
  }

  const borrar = async (tabla: string, id: number, etiqueta: string) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from(tabla)
      .delete()
      .eq("id", id)
      .eq("idempresa", IDEMPRESA)
    if (error) {
      // El trigger del script 028 impide borrar lo que ya sostiene un pago
      toast.error(`No se pudo eliminar ${etiqueta}`, { description: error.message })
      return
    }
    toast.success(`${etiqueta} eliminada`)
    refrescar()
  }

  if (cargando) {
    return (
      <div className="flex justify-center border-t border-border bg-muted/20 py-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4 border-t border-border bg-muted/20 px-5 py-4">
      {gate.dialog}

      {!row.costo_capturado && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <p className="text-[11px] text-amber-900">
            Este folio no tiene <span className="font-semibold">costo de maquila</span> capturado.
            Se pueden registrar recepciones, pero no pagos: no hay contra qué calcularlos. El costo
            viene de la columna <code className="font-mono">Costo Maquila</code> del Excel.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <BloqueDetalle
          titulo="Recepciones"
          total={`${row.piezas_recibidas.toLocaleString("es-MX")} pz`}
          onAgregar={readOnly ? undefined : () => setDialogo("recepcion")}
          vacio="Sin recepciones registradas"
          filas={recepciones.map((r) => ({
            id: r.id,
            izq: fmtFecha(r.fecha),
            centro: `${r.piezas.toLocaleString("es-MX")} pz`,
            der: r.comentarios ?? "",
            onBorrar: readOnly ? undefined : () => borrar("maquila_recepciones", r.id, "La recepción"),
          }))}
        />

        <BloqueDetalle
          titulo="Penalizaciones"
          total={fmtCurrency(num(row.valor_penalizaciones))}
          onAgregar={readOnly ? undefined : () => setDialogo("penalizacion")}
          vacio="Sin penalizaciones"
          filas={penalizaciones.map((p) => ({
            id: p.id,
            izq: fmtFecha(p.fecha),
            centro: `${p.piezas} pz · ${fmtCurrency(p.piezas * num(row.precio_venta))}`,
            der: p.motivo,
            onBorrar: readOnly
              ? undefined
              : () => borrar("maquila_penalizaciones", p.id, "La penalización"),
          }))}
        />

        <BloqueDetalle
          titulo="Pagos"
          total={fmtCurrency(num(row.valor_pagado))}
          onAgregar={
            readOnly || !row.costo_capturado ? undefined : () => setDialogo("pago")
          }
          vacio="Sin pagos registrados"
          filas={pagos.map((g) => ({
            id: g.id,
            izq: fmtFecha(g.fecha),
            centro: fmtCurrency(num(g.monto)),
            der: g.referencia ?? "",
            onBorrar: readOnly ? undefined : () => borrar("maquila_pagos", g.id, "El pago"),
          }))}
        />
      </div>

      {dialogo && (
        <DialogoMovimiento
          tipo={dialogo}
          row={row}
          usuario={user?.username ?? null}
          gate={gate}
          onClose={() => setDialogo(null)}
          onSaved={refrescar}
        />
      )}
    </div>
  )
}

function BloqueDetalle({
  titulo,
  total,
  onAgregar,
  vacio,
  filas,
}: {
  titulo: string
  total: string
  onAgregar?: () => void
  vacio: string
  filas: {
    id: number
    izq: string
    centro: string
    der: string
    onBorrar?: () => void
  }[]
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">{titulo}</p>
          <p className="text-[11px] tabular-nums text-muted-foreground">{total}</p>
        </div>
        {onAgregar && (
          <Button size="sm" variant="outline" onClick={onAgregar} className="h-7 gap-1 text-xs">
            Agregar
          </Button>
        )}
      </div>
      {filas.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground/60">{vacio}</p>
      ) : (
        <ul className="space-y-1">
          {filas.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded border border-border/60 bg-background px-2 py-1 text-[11px]"
            >
              <span className="w-14 shrink-0 text-muted-foreground">{f.izq}</span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">{f.centro}</span>
              <span className="truncate text-muted-foreground">{f.der}</span>
              {f.onBorrar && (
                <button
                  type="button"
                  onClick={f.onBorrar}
                  title="Eliminar"
                  className="ml-auto shrink-0 text-muted-foreground/50 transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Diálogo de alta ─────────────────────────────────────────────────────────

function DialogoMovimiento({
  tipo,
  row,
  usuario,
  gate,
  onClose,
  onSaved,
}: {
  tipo: "recepcion" | "penalizacion" | "pago"
  row: VwPagoMaquilas
  usuario: string | null
  gate: ReturnType<typeof usePasswordGate>
  onClose: () => void
  onSaved: () => void
}) {
  const saldoPendiente = Math.max(0, num(row.saldo))
  const [fecha, setFecha] = useState(hoyISO())
  const [piezas, setPiezas] = useState("")
  // El pago arranca con el saldo exacto: pre-llenarlo es la medida
  // anti-sobrepago más efectiva y no cuesta nada.
  const [monto, setMonto] = useState(tipo === "pago" ? saldoPendiente.toFixed(2) : "")
  const [motivo, setMotivo] = useState("")
  const [referencia, setReferencia] = useState("")
  const [comentarios, setComentarios] = useState("")
  const [guardando, setGuardando] = useState(false)

  const TITULOS = {
    recepcion: "Registrar recepción",
    penalizacion: "Registrar penalización",
    pago: "Registrar pago",
  } as const

  const piezasNum = Number(piezas)
  const montoNum = Number(monto)
  const excedeSaldo = tipo === "pago" && montoNum > saldoPendiente + CENTAVO

  const valido =
    tipo === "pago"
      ? Number.isFinite(montoNum) && montoNum > 0
      : Number.isFinite(piezasNum) &&
        piezasNum > 0 &&
        (tipo !== "penalizacion" || motivo.trim() !== "")

  const guardar = async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)

    const base = { idempresa: IDEMPRESA, folio: row.folio, fecha, capturado_por: usuario }
    const tabla =
      tipo === "recepcion"
        ? "maquila_recepciones"
        : tipo === "penalizacion"
          ? "maquila_penalizaciones"
          : "maquila_pagos"

    // Record<string, unknown>: las tres tablas tienen columnas distintas y el
    // tipado de Supabase no puede resolver la unión desde una sola llamada.
    const payload: Record<string, unknown> =
      tipo === "pago"
        ? {
            ...base,
            monto: Number(montoNum.toFixed(2)),
            referencia: referencia.trim() || null,
            // Deja rastro de con qué costo se pagó, por si el Excel lo cambia
            costo_maquila_aplicado: row.costo_maquila,
            comentarios: comentarios.trim() || null,
          }
        : tipo === "penalizacion"
          ? {
              ...base,
              piezas: Math.trunc(piezasNum),
              motivo: motivo.trim(),
              comentarios: comentarios.trim() || null,
            }
          : { ...base, piezas: Math.trunc(piezasNum), comentarios: comentarios.trim() || null }

    const { error } = await supabase.from(tabla).insert(payload)
    setGuardando(false)

    if (error) {
      toast.error("No se pudo guardar", { description: error.message })
      return
    }
    toast.success(`${TITULOS[tipo].replace("Registrar ", "")} registrada en ${row.folio}`)
    onClose()
    onSaved()
  }

  // Escribir dinero pasa por el gate de contraseña, igual que cambiar fechas
  const confirmar = () => gate.request(guardar)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{TITULOS[tipo]}</DialogTitle>
          <DialogDescription>
            Folio {row.folio} · {row.beneficiario ?? "sin maquilero"}
            {tipo !== "pago" && (
              <>
                {" "}
                · recibidas {row.piezas_recibidas.toLocaleString("es-MX")} de{" "}
                {row.piezas_orden?.toLocaleString("es-MX") ?? "?"}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mov-fecha">Fecha</Label>
            <Input
              id="mov-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>

          {tipo === "pago" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mov-monto">Monto</Label>
                <Input
                  id="mov-monto"
                  type="number"
                  step="0.01"
                  min="0"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Saldo pendiente: {fmtCurrency(saldoPendiente)}
                </p>
                {excedeSaldo && (
                  <p className="flex items-start gap-1 text-[11px] font-medium text-rose-600">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    Excede el saldo en {fmtCurrency(montoNum - saldoPendiente)}. El folio quedará
                    sobrepagado.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mov-ref">Referencia</Label>
                <Input
                  id="mov-ref"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Folio de transferencia, cheque…"
                />
                <p className="text-[11px] text-muted-foreground">
                  Si se repite, el sistema rechaza el pago: casi siempre es una captura doble.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="mov-piezas">Piezas</Label>
              <Input
                id="mov-piezas"
                type="number"
                min="1"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
              />
              {tipo === "penalizacion" && piezasNum > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Se descontarán {fmtCurrency(piezasNum * num(row.precio_venta))} (
                  {piezasNum} × {fmtCurrency(num(row.precio_venta))} de precio de venta)
                  {piezasNum > row.piezas_recibidas && (
                    <span className="block font-medium text-rose-600">
                      Son más piezas de las recibidas ({row.piezas_recibidas}).
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {tipo === "penalizacion" && (
            <div className="space-y-1.5">
              <Label htmlFor="mov-motivo">Motivo</Label>
              <Input
                id="mov-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Costura abierta, manchas, talla incorrecta…"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mov-com">Comentarios</Label>
            <Textarea
              id="mov-com"
              rows={2}
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={!valido || guardando}
            className={cn(
              "gap-1.5",
              excedeSaldo
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-emerald-600 hover:bg-emerald-700",
              "text-white",
            )}
          >
            {guardando && <Loader2 className="size-3.5 animate-spin" />}
            {excedeSaldo ? "Pagar de más" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Pestaña 2: Recepciones ──────────────────────────────────────────────────

function RecepcionesTab({ rows, loading, onRefresh }: TabProps) {
  const readOnly = useReadOnly()
  const { user } = useAuth()
  const gate = usePasswordGate()
  const [search, setSearch] = useState("")
  const [objetivo, setObjetivo] = useState<VwPagoMaquilas | null>(null)

  const candidatos = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows.filter((r) => r.piezas_recibidas < (r.piezas_orden ?? 0)).slice(0, 40)
    return rows
      .filter((r) => `${r.folio} ${r.modelo ?? ""} ${r.beneficiario ?? ""}`.toLowerCase().includes(q))
      .slice(0, 40)
  }, [rows, search])

  return (
    <div className="space-y-4">
      {gate.dialog}

      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-2.5">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-sky-600" />
        <p className="text-xs text-sky-900">
          Busca el folio que llegó y registra las piezas. Sin búsqueda se listan los folios que
          todavía no completan la orden.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar folio, modelo o maquilero…"
          className="h-10 pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Maquilero</TableHead>
              <TableHead className="font-semibold text-right">Recibidas / Orden</TableHead>
              <TableHead className="font-semibold">Última recepción</TableHead>
              <TableHead className="font-semibold text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : candidatos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  Sin coincidencias.
                </TableCell>
              </TableRow>
            ) : (
              candidatos.map((r) => {
                const orden = r.piezas_orden ?? 0
                const completo = orden > 0 && r.piezas_recibidas >= orden
                return (
                  <TableRow key={r.folio} className="hover:bg-muted/30">
                    <TableCell>
                      <FolioLink folio={r.folio} className="text-xs" />
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {r.modelo ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{r.beneficiario ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      <span className={cn(completo ? "text-emerald-600" : "text-foreground")}>
                        {r.piezas_recibidas.toLocaleString("es-MX")}
                      </span>
                      <span className="text-muted-foreground">
                        {" / "}
                        {orden > 0 ? orden.toLocaleString("es-MX") : "—"}
                      </span>
                      {orden > 0 && r.piezas_recibidas > orden && (
                        <span className="ml-1 text-rose-600" title="Se recibió más de lo pedido">
                          ⚠
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtFecha(r.ultima_recepcion)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={readOnly}
                        onClick={() => setObjetivo(r)}
                        className="gap-1.5"
                      >
                        <PackageCheck className="size-3.5" />
                        Recibir
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {objetivo && (
        <DialogoMovimiento
          tipo="recepcion"
          row={objetivo}
          usuario={user?.username ?? null}
          gate={gate}
          onClose={() => setObjetivo(null)}
          onSaved={onRefresh}
        />
      )}
    </div>
  )
}

// ─── Pestaña 3: Por Maquilero ────────────────────────────────────────────────

function MaquilerosTab({ rows, loading }: { rows: VwPagoMaquilas[]; loading: boolean }) {
  const resumen = useMemo(() => {
    const mapa = new Map<
      string,
      { folios: number; aPagar: number; pagado: number; abiertos: number; sinCosto: number }
    >()
    for (const r of rows) {
      const k = r.beneficiario ?? "Sin asignar"
      const a = mapa.get(k) ?? { folios: 0, aPagar: 0, pagado: 0, abiertos: 0, sinCosto: 0 }
      a.folios++
      if (!r.costo_capturado) {
        a.sinCosto++
      } else {
        a.aPagar += num(r.valor_a_pagar)
        a.pagado += num(r.valor_pagado)
        if (num(r.saldo) > CENTAVO) a.abiertos++
      }
      mapa.set(k, a)
    }
    return Array.from(mapa.entries())
      .map(([nombre, v]) => ({ nombre, ...v, saldo: v.aPagar - v.pagado }))
      .sort((a, b) => b.saldo - a.saldo)
  }, [rows])

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="font-semibold">Maquilero</TableHead>
            <TableHead className="font-semibold text-right">Folios</TableHead>
            <TableHead className="font-semibold text-right">Con saldo</TableHead>
            <TableHead className="font-semibold text-right">Sin costo</TableHead>
            <TableHead className="font-semibold text-right">Valor a pagar</TableHead>
            <TableHead className="font-semibold text-right">Pagado</TableHead>
            <TableHead className="font-semibold text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 7 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : resumen.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                Sin maquileros con órdenes.
              </TableCell>
            </TableRow>
          ) : (
            resumen.map((m) => (
              <TableRow key={m.nombre} className="hover:bg-muted/30">
                <TableCell className="font-medium text-foreground">{m.nombre}</TableCell>
                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                  {m.folios}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {m.abiertos > 0 ? m.abiertos : <span className="text-muted-foreground/50">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {m.sinCosto > 0 ? (
                    <span className="text-amber-600">{m.sinCosto}</span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {fmtCurrency(m.aPagar)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-emerald-700">
                  {fmtCurrency(m.pagado)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums text-sm font-semibold",
                    m.saldo < -CENTAVO ? "text-rose-600" : "text-foreground",
                  )}
                >
                  {fmtCurrency(m.saldo)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Pestaña 4: Lavandería ───────────────────────────────────────────────────

function LavanderiaTab({ rows, loading, onRefresh }: TabProps) {
  const readOnly = useReadOnly()
  const gate = usePasswordGate()
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)

  const conLavanderia = useMemo(
    () =>
      rows.filter(
        (r) => r.costo_lavanderia != null && (!soloPendientes || !r.lavanderia_pagada),
      ),
    [rows, soloPendientes],
  )

  const total = useMemo(
    () => conLavanderia.reduce((s, r) => s + num(r.valor_lavanderia), 0),
    [conLavanderia],
  )

  const marcar = async (folio: string, pagar: boolean) => {
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(folio)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ fecha_pago_lavanderia: pagar ? hoyISO() : null })
      .eq("folio", folio)
      .eq("idempresa", IDEMPRESA)
    setGuardando(null)
    if (error) {
      toast.error("No se pudo actualizar", { description: error.message })
      return
    }
    toast.success(pagar ? `Lavandería de ${folio} marcada como pagada` : `Pago revertido en ${folio}`)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {gate.dialog}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={soloPendientes ? "default" : "outline"}
          onClick={() => setSoloPendientes(!soloPendientes)}
          className="h-9"
        >
          {soloPendientes ? "Solo pendientes" : "Todas"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {conLavanderia.length} folios · {fmtCurrency(total)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Cliente</TableHead>
              <TableHead className="font-semibold text-right">Recibidas</TableHead>
              <TableHead className="font-semibold text-right">Costo unit.</TableHead>
              <TableHead className="font-semibold text-right">Total</TableHead>
              <TableHead className="font-semibold">Pago</TableHead>
              <TableHead className="font-semibold text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : conLavanderia.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  {soloPendientes
                    ? "No hay lavandería pendiente de pago."
                    : "Ningún folio tiene costo de lavandería capturado."}
                </TableCell>
              </TableRow>
            ) : (
              conLavanderia.map((r) => (
                <TableRow key={r.folio} className="hover:bg-muted/30">
                  <TableCell>
                    <FolioLink folio={r.folio} className="text-xs" />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.cliente ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {r.piezas_recibidas.toLocaleString("es-MX")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {fmtCurrency(num(r.costo_lavanderia))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {fmtCurrency(num(r.valor_lavanderia))}
                  </TableCell>
                  <TableCell>
                    {r.lavanderia_pagada ? (
                      <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                        Pagada · {fmtFecha(r.fecha_pago_lavanderia)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Pendiente
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={readOnly || guardando === r.folio}
                      onClick={() =>
                        gate.request(() => marcar(r.folio, !r.lavanderia_pagada))
                      }
                      className="gap-1.5"
                    >
                      {guardando === r.folio && <Loader2 className="size-3.5 animate-spin" />}
                      {r.lavanderia_pagada ? "Revertir" : "Marcar pagada"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

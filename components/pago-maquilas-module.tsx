"use client"

/**
 * Pago Maquilas — cuentas por pagar al maquilero y a los servicios externos.
 *
 * FÓRMULA (script 032):
 *
 *   precio final   = piezas recibidas × costo unitario
 *   − no entregadas × precio de venta
 *   − demora        = precio final × 1.5% por semana de atraso
 *   ─────────────────────────────────────────────────────────
 *   = valor a pagar
 *
 * El dinero se deriva, no se guarda: solo los pagos son cifras guardadas.
 * Así un costo corregido en el Excel se refleja sin reescribir históricos.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  AlertTriangle,
  Banknote,
  Clock,
  Download,
  History,
  Loader2,
  PackageCheck,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
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
import {
  SERVICIOS_EXTERNOS,
  type HistorialPago,
  type MaquilaPago,
  type MaquilaPenalizacion,
  type MaquilaRecepcion,
  type ServicioExterno,
  type ServicioPago,
  type VwPagoMaquilas,
  type VwServicioPago,
} from "@/lib/types"
import { cn } from "@/lib/utils"

import { FolioLink } from "@/components/folio-detail-drawer"
import { KpiCard } from "@/components/kpi-card"
import { Button } from "@/components/ui/button"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ─── Constantes y helpers ────────────────────────────────────────────────────

/** Tolerancia de centavo: nunca comparar saldos contra 0 exacto. */
const CENTAVO = 0.005

/** Descuento por cada semana completa de atraso sobre la fecha de entrega. */
const DEMORA_SEMANAL_PCT = 1.5

const ESTADO_STYLE: Record<string, string> = {
  Anticipo: "border-indigo-300 bg-indigo-50 text-indigo-700",
  "Sin costo": "border-amber-300 bg-amber-50 text-amber-700",
  "Sin valor": "border-amber-300 bg-amber-50 text-amber-700",
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

function EstadoPill({ estado }: { estado: string }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        ESTADO_STYLE[estado] ?? "border-slate-200 bg-slate-100 text-slate-600",
      )}
    >
      {estado}
    </span>
  )
}

/**
 * Valor por pieza tal como viene del Excel.
 *
 * Distingue el dato faltante del cero: un folio sin costo capturado no es un
 * folio que valga cero. Si se pintaran igual, un maquilero al que se le debe
 * parecería saldado.
 */
function ValorUnitario({ valor }: { valor: number | null }) {
  if (valor == null) {
    return (
      <span
        className="inline-flex whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
        title="La columna correspondiente del Excel viene vacía para este folio"
      >
        Sin valor
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap tabular-nums font-medium">
      {fmtCurrency(Number(valor))}
      <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">/pz</span>
    </span>
  )
}

// ─── Módulo ──────────────────────────────────────────────────────────────────

export function PagoMaquilasModule({ configMissing }: { configMissing: boolean }) {
  const [rows, setRows] = useState<VwPagoMaquilas[]>([])
  const [servicios, setServicios] = useState<VwServicioPago[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)

    const [maq, serv] = await Promise.all([
      supabase
        .from("vw_pago_maquilas")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .not("maquilero_nombre", "is", null)
        .order("folio"),
      supabase.from("vw_servicios_pago").select("*").eq("idempresa", IDEMPRESA).order("folio"),
    ])

    setLoading(false)
    if (maq.error) {
      setError(maq.error.message)
      return
    }
    setRows((maq.data as VwPagoMaquilas[]) ?? [])
    if (!serv.error) setServicios((serv.data as VwServicioPago[]) ?? [])
  }, [configMissing])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

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
            Recepciones, no entregadas, demora y pagos ·{" "}
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
            {huerfanos.join(", ")}. Sus folios se agrupan por el nombre del archivo, así que
            una variante de escritura los partiría en dos. Agrégalos en Configuración →
            Maquileros.
          </p>
        </div>
      )}

      <Tabs defaultValue="cuentas" className="w-full">
        <TabsList>
          <TabsTrigger value="cuentas">Cuentas por Pagar</TabsTrigger>
          <TabsTrigger value="recepciones">Recepciones</TabsTrigger>
          <TabsTrigger value="maquileros">Por Maquilero</TabsTrigger>
          <TabsTrigger value="servicios">Servicios</TabsTrigger>
          <TabsTrigger value="historial">Historial de Pagos</TabsTrigger>
        </TabsList>

        <TabsContent value="cuentas" className="mt-5">
          <CuentasTab
            rows={rows}
            servicios={servicios}
            loading={loading}
            onRefresh={fetchRows}
          />
        </TabsContent>

        <TabsContent value="recepciones" className="mt-5">
          <RecepcionesTab
            rows={rows}
            servicios={servicios}
            loading={loading}
            onRefresh={fetchRows}
          />
        </TabsContent>

        <TabsContent value="maquileros" className="mt-5">
          <MaquilerosTab rows={rows} loading={loading} />
        </TabsContent>

        <TabsContent value="servicios" className="mt-5">
          <ServiciosTab servicios={servicios} loading={loading} onRefresh={fetchRows} />
        </TabsContent>

        <TabsContent value="historial" className="mt-5">
          <HistorialTab configMissing={configMissing} />
        </TabsContent>
      </Tabs>
    </section>
  )
}

type TabProps = {
  rows: VwPagoMaquilas[]
  servicios: VwServicioPago[]
  loading: boolean
  onRefresh: () => void
}

// ─── Pestaña 1: Cuentas por Pagar ────────────────────────────────────────────

function CuentasTab({ rows, servicios, loading, onRefresh }: TabProps) {
  const readOnly = useReadOnly()
  const [search, setSearch] = useState("")
  const [filtroMaquilero, setFiltroMaquilero] = useState("__all__")
  const [filtroEstado, setFiltroEstado] = useState("__all__")
  const [gestionando, setGestionando] = useState<string | null>(null)

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
        const heno = `${r.folio} ${r.modelo ?? ""} ${r.cliente ?? ""} ${r.familia ?? ""}`
        if (!heno.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, search, filtroMaquilero, filtroEstado])

  const kpis = useMemo(() => {
    let aPagar = 0
    let pagado = 0
    let demora = 0
    let sinCosto = 0
    for (const r of filtradas) {
      if (!r.costo_capturado) {
        sinCosto++
        continue
      }
      aPagar += num(r.valor_a_pagar)
      pagado += num(r.valor_pagado)
      demora += num(r.valor_demora)
    }
    return { aPagar, pagado, saldo: aPagar - pagado, demora, sinCosto }
  }, [filtradas])

  const exportar = () => {
    if (filtradas.length === 0) {
      toast.warning("Sin datos para exportar con los filtros aplicados.")
      return
    }
    const datos = filtradas.map((r) => ({
      Folio: r.folio,
      Familia: r.familia ?? "",
      Maquilero: r.beneficiario ?? "",
      Modelo: r.modelo ?? "",
      Cliente: r.cliente ?? "",
      "Piezas cortadas": r.piezas_cortadas,
      Recibidas: r.piezas_recibidas,
      "Costo unitario": r.costo_maquila ?? "",
      "Precio final": num(r.precio_final),
      "Pzs no entregadas": r.piezas_no_entregadas,
      "Desc. no entregadas": num(r.valor_no_entregadas),
      "Semanas demora": r.semanas_demora,
      "Desc. demora": num(r.valor_demora),
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
          label="Descuento por demora"
          value={kpis.demora}
          format={fmtCurrency}
          icon={<Clock className="size-3.5" />}
          iconBg="bg-rose-100 ring-rose-200"
          iconColor="text-rose-600"
          valueColor={kpis.demora > CENTAVO ? "text-rose-600" : "text-foreground"}
          hint={`${DEMORA_SEMANAL_PCT}% por semana de atraso`}
        />
        <KpiCard
          label="Folios sin costo"
          value={kpis.sinCosto}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.sinCosto > 0 ? "text-amber-600" : "text-foreground"}
          hint="No se puede pagar sin costo unitario"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Folio, modelo, familia o cliente…"
            className="h-9 w-64 pl-8"
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
            {["Anticipo", "Sin costo", "Sin recepción", "Pendiente", "Parcial", "Saldado", "Sobrepagado"].map(
              (e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ),
            )}
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
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Familia</TableHead>
              <TableHead className="font-semibold">Maquilero</TableHead>
              <TableHead className="font-semibold text-right">Piezas cortadas</TableHead>
              <TableHead className="font-semibold text-right">Recibidas</TableHead>
              <TableHead className="font-semibold text-right">Costo unitario</TableHead>
              <TableHead className="font-semibold text-right">Costo lavandería</TableHead>
              <TableHead className="font-semibold text-right">Pzs no entregadas</TableHead>
              <TableHead className="font-semibold text-right">Demora</TableHead>
              <TableHead className="font-semibold text-right">Valor a pagar</TableHead>
              <TableHead className="font-semibold text-right">Pagado</TableHead>
              <TableHead className="font-semibold text-right">Saldo</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
              <TableHead className="font-semibold text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 14 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="h-28 text-center text-sm text-muted-foreground">
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
                  onGestionar={() => setGestionando(r.folio)}
                  readOnly={readOnly}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {gestionando && (
        <GestionFolioDialog
          row={rows.find((r) => r.folio === gestionando)!}
          servicios={servicios.filter((s) => s.folio === gestionando)}
          onClose={() => setGestionando(null)}
          onSaved={onRefresh}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}

// ─── Fila de folio ───────────────────────────────────────────────────────────

function FolioRow({
  row,
  onGestionar,
  readOnly,
}: {
  row: VwPagoMaquilas
  onGestionar: () => void
  readOnly: boolean
}) {
  const saldo = num(row.saldo)
  const sobrepago = saldo < -CENTAVO

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell>
        <FolioLink folio={row.folio} className="text-xs" />
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.modelo ?? "—"}</p>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{row.familia ?? "—"}</TableCell>
      <TableCell className="text-sm">{row.beneficiario ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
        {row.piezas_cortadas > 0 ? (
          row.piezas_cortadas.toLocaleString("es-MX")
        ) : (
          <span
            className="text-muted-foreground/40"
            title="No hay registros de corte para este folio"
          >
            —
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {row.piezas_recibidas.toLocaleString("es-MX")}
      </TableCell>
      <TableCell className="text-right text-sm">
        <ValorUnitario valor={row.costo_maquila} />
      </TableCell>
      <TableCell className="text-right text-sm">
        <ValorUnitario valor={row.costo_lavanderia} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {row.piezas_no_entregadas > 0 ? (
          <span
            className={cn(
              row.no_entregadas_exceden_recibidas
                ? "font-semibold text-rose-600"
                : "text-rose-600",
            )}
            title={
              row.no_entregadas_exceden_recibidas
                ? "Hay más piezas no entregadas que recibidas — probable error de captura"
                : `Descuenta ${fmtCurrency(num(row.valor_no_entregadas))}`
            }
          >
            {row.piezas_no_entregadas.toLocaleString("es-MX")}
            {row.no_entregadas_exceden_recibidas && " ⚠"}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm">
        {row.semanas_demora > 0 ? (
          <span
            className="whitespace-nowrap text-rose-600"
            title={`${row.semanas_demora} semanas × ${DEMORA_SEMANAL_PCT}% = ${fmtCurrency(num(row.valor_demora))}`}
          >
            <span className="tabular-nums font-medium">−{num(row.demora_pct).toFixed(1)}%</span>
            <span className="ml-1 text-[10px] text-muted-foreground">
              {row.semanas_demora} sem
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm font-medium">
        {row.costo_capturado ? (
          <span className="tabular-nums">{fmtCurrency(num(row.valor_a_pagar))}</span>
        ) : (
          <span className="text-xs font-medium text-amber-600">Sin costo</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm text-emerald-700">
        {num(row.valor_pagado) > 0 ? (
          fmtCurrency(num(row.valor_pagado))
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
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
        <EstadoPill estado={row.estado_pago} />
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={onGestionar} className="gap-1.5">
          <Settings2 className="size-3.5" />
          {readOnly ? "Ver" : "Gestionar"}
        </Button>
      </TableCell>
    </TableRow>
  )
}

// ─── Modal de gestión del folio ──────────────────────────────────────────────

/**
 * Todo lo del folio en un solo lugar: el desglose del valor a pagar, el
 * historial de entregas y de pagos, y los servicios externos.
 *
 * Los formularios de alta van EN LÍNEA, no en diálogos anidados: abrir un
 * modal dentro de otro pelea con el foco y obliga a cerrar dos cosas para
 * volver a la tabla.
 */
function GestionFolioDialog({
  row,
  servicios,
  onClose,
  onSaved,
  readOnly,
}: {
  row: VwPagoMaquilas
  servicios: VwServicioPago[]
  onClose: () => void
  onSaved: () => void
  readOnly: boolean
}) {
  const { user } = useAuth()
  const [recepciones, setRecepciones] = useState<MaquilaRecepcion[]>([])
  const [noEntregadas, setNoEntregadas] = useState<MaquilaPenalizacion[]>([])
  const [pagos, setPagos] = useState<MaquilaPago[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const q = (t: string) =>
      supabase.from(t).select("*").eq("idempresa", IDEMPRESA).eq("folio", row.folio).order("fecha")
    const [r, p, g] = await Promise.all([
      q("maquila_recepciones"),
      q("maquila_penalizaciones"),
      q("maquila_pagos"),
    ])
    setRecepciones((r.data as MaquilaRecepcion[]) ?? [])
    setNoEntregadas((p.data as MaquilaPenalizacion[]) ?? [])
    setPagos((g.data as MaquilaPago[]) ?? [])
    setCargando(false)
  }, [row.folio])

  useEffect(() => {
    cargar()
  }, [cargar])

  const refrescar = () => {
    cargar()
    onSaved()
  }

  const guardar = async (tabla: string, payload: Record<string, unknown>, etiqueta: string) => {
    const supabase = getSupabase()
    if (!supabase) return false
    const { error } = await supabase.from(tabla).insert({
      idempresa: IDEMPRESA,
      folio: row.folio,
      capturado_por: user?.username ?? null,
      ...payload,
    })
    if (error) {
      toast.error(`No se pudo registrar ${etiqueta}`, { description: error.message })
      return false
    }
    toast.success(`${etiqueta} registrada en ${row.folio}`)
    refrescar()
    return true
  }

  const borrar = async (tabla: string, id: number, etiqueta: string) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase.from(tabla).delete().eq("id", id).eq("idempresa", IDEMPRESA)
    if (error) {
      // El trigger del script 028 impide borrar lo que ya sostiene un pago
      toast.error(`No se pudo eliminar ${etiqueta}`, { description: error.message })
      return
    }
    toast.success(`${etiqueta} eliminada`)
    refrescar()
  }

  /** El costo unitario se puede corregir desde aquí. */
  const guardarCosto = async (valor: number | null) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ costo_maquila: valor })
      .eq("folio", row.folio)
      .eq("idempresa", IDEMPRESA)
    if (error) {
      toast.error("No se pudo cambiar el costo", { description: error.message })
      return
    }
    toast.success("Costo de maquila actualizado")
    refrescar()
  }

  const saldoPendiente = Math.max(0, num(row.saldo))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-emerald-600" />
            Folio {row.folio}
            <EstadoPill estado={row.estado_pago} />
          </DialogTitle>
          <DialogDescription>
            {row.beneficiario ?? "Sin maquilero"} · {row.familia ?? "sin familia"} ·{" "}
            {row.modelo ?? "sin modelo"} · {row.cliente ?? "sin cliente"}
          </DialogDescription>
        </DialogHeader>

        {/* ── Desglose del valor a pagar ── */}
        <DesgloseValor row={row} readOnly={readOnly} onCambiarCosto={guardarCosto} />

        {cargando ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <SeccionRecepciones
              filas={recepciones}
              row={row}
              readOnly={readOnly}
              onGuardar={guardar}
              onBorrar={borrar}
            />
            <SeccionNoEntregadas
              filas={noEntregadas}
              row={row}
              readOnly={readOnly}
              onGuardar={guardar}
              onBorrar={borrar}
            />
            <div className="lg:col-span-2">
              <SeccionPagos
                filas={pagos}
                row={row}
                readOnly={readOnly}
                saldoPendiente={saldoPendiente}
                onGuardar={guardar}
                onBorrar={borrar}
              />
            </div>
            <div className="lg:col-span-2">
              <SeccionServicios
                folio={row.folio}
                piezasOrden={row.piezas_orden}
                piezasRecibidas={row.piezas_recibidas}
                servicios={servicios}
                readOnly={readOnly}
                onSaved={refrescar}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * El cálculo, línea por línea.
 *
 * Se muestra desglosado y no solo el total porque cada resta viene de una
 * fuente distinta —recepciones, no entregadas, fecha de entrega— y cuando
 * una cifra no cuadra hay que poder ver de dónde salió.
 */
function DesgloseValor({
  row,
  readOnly,
  onCambiarCosto,
}: {
  row: VwPagoMaquilas
  readOnly: boolean
  onCambiarCosto: (v: number | null) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-1.5">
          <Linea
            etiqueta={
              <>
                Precio final
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                  {row.piezas_recibidas.toLocaleString("es-MX")} recibidas ×{" "}
                  <CostoEditable
                    valor={row.costo_maquila}
                    disabled={readOnly}
                    onSave={onCambiarCosto}
                  />
                </span>
              </>
            }
            valor={row.costo_capturado ? fmtCurrency(num(row.precio_final)) : "Sin costo"}
            tono={row.costo_capturado ? "text-foreground" : "text-amber-600"}
          />
          <Linea
            etiqueta={
              <>
                Pzs no entregadas
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                  {row.piezas_no_entregadas} × {fmtCurrency(num(row.precio_venta))} de venta
                </span>
              </>
            }
            valor={
              num(row.valor_no_entregadas) > 0
                ? `− ${fmtCurrency(num(row.valor_no_entregadas))}`
                : "—"
            }
            tono={num(row.valor_no_entregadas) > 0 ? "text-rose-600" : "text-muted-foreground/60"}
          />
          <Linea
            etiqueta={
              <>
                Demora en entrega
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                  {row.semanas_demora > 0
                    ? `${row.semanas_demora} sem × ${DEMORA_SEMANAL_PCT}% = ${num(row.demora_pct).toFixed(1)}%`
                    : "sin atraso"}
                </span>
              </>
            }
            valor={num(row.valor_demora) > 0 ? `− ${fmtCurrency(num(row.valor_demora))}` : "—"}
            tono={num(row.valor_demora) > 0 ? "text-rose-600" : "text-muted-foreground/60"}
          />
          <div className="mt-1 border-t border-border pt-1.5">
            <Linea
              etiqueta={<span className="font-semibold">Valor a pagar</span>}
              valor={row.costo_capturado ? fmtCurrency(num(row.valor_a_pagar)) : "—"}
              tono="text-foreground"
              destacado
            />
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <Linea
            etiqueta="Piezas cortadas"
            valor={row.piezas_cortadas > 0 ? row.piezas_cortadas.toLocaleString("es-MX") : "—"}
            tono="text-muted-foreground"
          />
          <Linea
            etiqueta="Fecha de entrega"
            valor={fmtFecha(row.fecha_cancelacion)}
            tono="text-muted-foreground"
          />
          <Linea
            etiqueta="Última recepción"
            valor={fmtFecha(row.ultima_recepcion)}
            tono="text-muted-foreground"
          />
          <div className="mt-1 border-t border-border pt-1.5">
            <Linea
              etiqueta="Pagado"
              valor={fmtCurrency(num(row.valor_pagado))}
              tono="text-emerald-700"
            />
            <Linea
              etiqueta={<span className="font-semibold">Saldo</span>}
              valor={row.costo_capturado ? fmtCurrency(num(row.saldo)) : "—"}
              tono={num(row.saldo) < -CENTAVO ? "text-rose-600" : "text-foreground"}
              destacado
            />
          </div>
        </div>
      </div>

      {row.semanas_demora > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-rose-700">
          <Clock className="mt-0.5 size-3 shrink-0" />
          {row.ultima_recepcion
            ? `Se recibió ${row.semanas_demora} semanas después de la fecha de entrega.`
            : `Han pasado ${row.semanas_demora} semanas de la fecha de entrega y no se ha recibido nada; el descuento sigue creciendo.`}
        </p>
      )}
    </div>
  )
}

function Linea({
  etiqueta,
  valor,
  tono,
  destacado,
}: {
  etiqueta: React.ReactNode
  valor: string
  tono?: string
  destacado?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          destacado ? "text-base font-bold" : "text-sm font-medium",
          tono,
        )}
      >
        {valor}
      </span>
    </div>
  )
}

/** Costo unitario editable en línea, dentro del desglose. */
function CostoEditable({
  valor,
  disabled,
  onSave,
}: {
  valor: number | null
  disabled: boolean
  onSave: (v: number | null) => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(valor != null ? String(valor) : "")

  useEffect(() => {
    if (!editando) setTexto(valor != null ? String(valor) : "")
  }, [valor, editando])

  const confirmar = () => {
    setEditando(false)
    const t = texto.trim()
    const n = t === "" ? null : Number(t)
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setTexto(valor != null ? String(valor) : "")
      return
    }
    if (n !== valor) onSave(n)
  }

  if (editando) {
    return (
      <Input
        autoFocus
        type="number"
        step="0.01"
        min="0"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmar()
          if (e.key === "Escape") {
            setTexto(valor != null ? String(valor) : "")
            setEditando(false)
          }
        }}
        className="inline-block h-6 w-24 px-1.5 py-0 text-[11px]"
      />
    )
  }

  if (disabled) {
    return <span className="font-medium">{valor != null ? fmtCurrency(valor) : "sin costo"}</span>
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      title="Clic para cambiar el costo de maquila"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:bg-muted",
        valor == null && "text-amber-600",
      )}
    >
      {valor != null ? fmtCurrency(valor) : "sin costo"}
      <Pencil className="size-2.5 text-muted-foreground/60" />
    </button>
  )
}

// ─── Secciones del modal ─────────────────────────────────────────────────────

type GuardarFn = (
  tabla: string,
  payload: Record<string, unknown>,
  etiqueta: string,
) => Promise<boolean>
type BorrarFn = (tabla: string, id: number, etiqueta: string) => void

function Seccion({
  titulo,
  total,
  children,
  formulario,
}: {
  titulo: string
  total: string
  children: React.ReactNode
  formulario?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <p className="text-xs font-semibold text-foreground">{titulo}</p>
        <p className="text-xs font-medium tabular-nums text-muted-foreground">{total}</p>
      </div>
      <div className="max-h-44 divide-y divide-border/60 overflow-y-auto">{children}</div>
      {formulario && <div className="border-t border-border bg-muted/20 p-2">{formulario}</div>}
    </div>
  )
}

function FilaMovimiento({
  fecha,
  principal,
  detalle,
  onBorrar,
}: {
  fecha: string
  principal: string
  detalle?: string | null
  onBorrar?: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{fmtFecha(fecha)}</span>
      <span className="w-28 shrink-0 font-medium tabular-nums text-foreground">{principal}</span>
      <span className="truncate text-muted-foreground">{detalle ?? ""}</span>
      {onBorrar && (
        <button
          type="button"
          onClick={onBorrar}
          title="Eliminar"
          className="ml-auto shrink-0 text-muted-foreground/50 transition-colors hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="px-3 py-3 text-center text-[11px] text-muted-foreground/60">{texto}</p>
}

function CampoMini({
  label,
  ancho,
  children,
}: {
  label: string
  ancho: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1", ancho)}>
      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Interruptor de "pago adelantado", compartido por maquila y servicios. */
function CheckAdelanto({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 cursor-pointer rounded border-border accent-indigo-600"
      />
      Pago adelantado (sin recibir)
    </label>
  )
}

// ── Recepciones (histórico de entregas) ──

function SeccionRecepciones({
  filas,
  row,
  readOnly,
  onGuardar,
  onBorrar,
}: {
  filas: MaquilaRecepcion[]
  row: VwPagoMaquilas
  readOnly: boolean
  onGuardar: GuardarFn
  onBorrar: BorrarFn
}) {
  const [fecha, setFecha] = useState(hoyISO())
  const [piezas, setPiezas] = useState("")
  const [guardando, setGuardando] = useState(false)

  const n = Number(piezas)
  const valido = Number.isFinite(n) && n > 0
  const base = row.piezas_cortadas || row.piezas_orden || 0
  const excede = valido && base > 0 && row.piezas_recibidas + n > base

  const enviar = async () => {
    setGuardando(true)
    const ok = await onGuardar(
      "maquila_recepciones",
      { fecha, piezas: Math.trunc(n) },
      "La recepción",
    )
    setGuardando(false)
    if (ok) setPiezas("")
  }

  return (
    <Seccion
      titulo="Entregas recibidas"
      total={`${row.piezas_recibidas.toLocaleString("es-MX")} de ${
        base > 0 ? base.toLocaleString("es-MX") : "?"
      } pz`}
      formulario={
        readOnly ? undefined : (
          <div className="flex flex-wrap items-end gap-2">
            <CampoMini label="Fecha" ancho="w-32">
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8" />
            </CampoMini>
            <CampoMini label="Piezas" ancho="w-24">
              <Input
                type="number"
                min="1"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
                className="h-8"
              />
            </CampoMini>
            <Button
              size="sm"
              onClick={enviar}
              disabled={!valido || guardando}
              className="h-8 gap-1.5 bg-sky-600 text-white hover:bg-sky-700"
            >
              {guardando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PackageCheck className="size-3.5" />
              )}
              Recibir
            </Button>
            {excede && (
              <p className="w-full text-[11px] font-medium text-amber-600">
                Se supera lo cortado ({base.toLocaleString("es-MX")} pz).
              </p>
            )}
          </div>
        )
      }
    >
      {filas.length === 0 ? (
        <Vacio texto="Sin entregas registradas" />
      ) : (
        filas.map((r) => (
          <FilaMovimiento
            key={r.id}
            fecha={r.fecha}
            principal={`${r.piezas.toLocaleString("es-MX")} pz`}
            detalle={r.comentarios}
            onBorrar={
              readOnly ? undefined : () => onBorrar("maquila_recepciones", r.id, "La recepción")
            }
          />
        ))
      )}
    </Seccion>
  )
}

// ── Piezas no entregadas ──

function SeccionNoEntregadas({
  filas,
  row,
  readOnly,
  onGuardar,
  onBorrar,
}: {
  filas: MaquilaPenalizacion[]
  row: VwPagoMaquilas
  readOnly: boolean
  onGuardar: GuardarFn
  onBorrar: BorrarFn
}) {
  const [fecha, setFecha] = useState(hoyISO())
  const [piezas, setPiezas] = useState("")
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)

  const n = Number(piezas)
  const valido = Number.isFinite(n) && n > 0 && motivo.trim() !== ""
  const importe = valido ? n * num(row.precio_venta) : 0

  const enviar = async () => {
    setGuardando(true)
    const ok = await onGuardar(
      "maquila_penalizaciones",
      { fecha, piezas: Math.trunc(n), motivo: motivo.trim() },
      "Las piezas no entregadas",
    )
    setGuardando(false)
    if (ok) {
      setPiezas("")
      setMotivo("")
    }
  }

  return (
    <Seccion
      titulo="Piezas no entregadas"
      total={
        row.precio_venta == null
          ? "Sin precio de venta"
          : `${row.piezas_no_entregadas} pz · ${fmtCurrency(num(row.valor_no_entregadas))}`
      }
      formulario={
        readOnly ? undefined : (
          <div className="flex flex-wrap items-end gap-2">
            <CampoMini label="Fecha" ancho="w-32">
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8" />
            </CampoMini>
            <CampoMini label="Piezas" ancho="w-20">
              <Input
                type="number"
                min="1"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
                className="h-8"
              />
            </CampoMini>
            <CampoMini label="Motivo" ancho="flex-1 min-w-32">
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Faltante, defecto…"
                className="h-8"
              />
            </CampoMini>
            <Button
              size="sm"
              onClick={enviar}
              disabled={!valido || guardando}
              className="h-8 gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {guardando && <Loader2 className="size-3.5 animate-spin" />}
              Registrar
            </Button>
            {valido && (
              <p className="w-full text-[11px] text-muted-foreground">
                {row.precio_venta == null ? (
                  <span className="font-medium text-amber-600">
                    Sin precio de venta: se registra pero descuenta $0.
                  </span>
                ) : (
                  <>Descuenta {fmtCurrency(importe)}</>
                )}
              </p>
            )}
          </div>
        )
      }
    >
      {filas.length === 0 ? (
        <Vacio texto="Sin piezas no entregadas" />
      ) : (
        filas.map((p) => (
          <FilaMovimiento
            key={p.id}
            fecha={p.fecha}
            principal={`${p.piezas} pz · ${fmtCurrency(p.piezas * num(row.precio_venta))}`}
            detalle={p.motivo}
            onBorrar={
              readOnly
                ? undefined
                : () => onBorrar("maquila_penalizaciones", p.id, "El registro")
            }
          />
        ))
      )}
    </Seccion>
  )
}

// ── Pagos al maquilero (histórico de pagos) ──

function SeccionPagos({
  filas,
  row,
  readOnly,
  saldoPendiente,
  onGuardar,
  onBorrar,
}: {
  filas: MaquilaPago[]
  row: VwPagoMaquilas
  readOnly: boolean
  saldoPendiente: number
  onGuardar: GuardarFn
  onBorrar: BorrarFn
}) {
  const [fecha, setFecha] = useState(hoyISO())
  const [monto, setMonto] = useState(saldoPendiente > 0 ? saldoPendiente.toFixed(2) : "")
  const [referencia, setReferencia] = useState("")
  const [adelanto, setAdelanto] = useState(row.piezas_recibidas === 0)
  const [guardando, setGuardando] = useState(false)

  const n = Number(monto)
  const valido = Number.isFinite(n) && n > 0
  const excede = valido && !adelanto && n > saldoPendiente + CENTAVO

  const enviar = async () => {
    setGuardando(true)
    const ok = await onGuardar(
      "maquila_pagos",
      {
        fecha,
        monto: Number(n.toFixed(2)),
        referencia: referencia.trim() || null,
        es_adelanto: adelanto,
        costo_maquila_aplicado: row.costo_maquila,
      },
      adelanto ? "El adelanto" : "El pago",
    )
    setGuardando(false)
    if (ok) {
      setMonto("")
      setReferencia("")
    }
  }

  return (
    <Seccion
      titulo="Historial de pagos"
      total={`${fmtCurrency(num(row.valor_pagado))} pagados${
        num(row.valor_adelantos) > 0
          ? ` · ${fmtCurrency(num(row.valor_adelantos))} en adelantos`
          : ""
      }`}
      formulario={
        readOnly ? undefined : !row.costo_capturado && !adelanto ? (
          <p className="text-[11px] text-muted-foreground">
            Sin costo unitario no hay contra qué calcular un pago. Puedes registrar un{" "}
            <button
              type="button"
              onClick={() => setAdelanto(true)}
              className="font-medium text-indigo-600 underline"
            >
              adelanto
            </button>
            , que no depende del costo.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <CampoMini label="Fecha" ancho="w-32">
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8" />
            </CampoMini>
            <CampoMini label="Monto" ancho="w-32">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="h-8"
              />
            </CampoMini>
            <CampoMini label="Referencia" ancho="flex-1 min-w-40">
              <Input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Transferencia, cheque…"
                className="h-8"
              />
            </CampoMini>
            <Button
              size="sm"
              onClick={enviar}
              disabled={!valido || guardando}
              className={cn(
                "h-8 gap-1.5 text-white",
                excede
                  ? "bg-rose-600 hover:bg-rose-700"
                  : adelanto
                    ? "bg-indigo-600 hover:bg-indigo-700"
                    : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {guardando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wallet className="size-3.5" />
              )}
              {excede ? "Pagar de más" : adelanto ? "Adelantar" : "Pagar"}
            </Button>
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
              <CheckAdelanto checked={adelanto} onChange={setAdelanto} />
              <p className="text-[11px] text-muted-foreground">
                {adelanto
                  ? "Pago sin recibir: queda registrado como anticipo."
                  : `Saldo pendiente: ${fmtCurrency(saldoPendiente)}`}
                {excede && (
                  <span className="ml-2 font-medium text-rose-600">
                    Excede en {fmtCurrency(n - saldoPendiente)}. Márcalo como adelanto si es
                    deliberado.
                  </span>
                )}
              </p>
            </div>
          </div>
        )
      }
    >
      {filas.length === 0 ? (
        <Vacio texto="Sin pagos registrados" />
      ) : (
        filas.map((g) => (
          <FilaMovimiento
            key={g.id}
            fecha={g.fecha}
            principal={fmtCurrency(num(g.monto))}
            detalle={(g.es_adelanto ? "Adelanto · " : "") + (g.referencia ?? "")}
            onBorrar={readOnly ? undefined : () => onBorrar("maquila_pagos", g.id, "El pago")}
          />
        ))
      )}
    </Seccion>
  )
}

// ─── Servicios externos ──────────────────────────────────────────────────────

/**
 * Los cinco servicios de un folio, dentro del modal.
 *
 * Cada uno es un acreedor distinto con su propio saldo: se le paga por las
 * piezas que devolvió, no por las que se le mandaron.
 */
function SeccionServicios({
  folio,
  piezasOrden,
  piezasRecibidas,
  servicios,
  readOnly,
  onSaved,
}: {
  folio: string
  piezasOrden: number | null
  piezasRecibidas: number
  servicios: VwServicioPago[]
  readOnly: boolean
  onSaved: () => void
}) {
  const [pagando, setPagando] = useState<ServicioExterno | null>(null)

  const guardarPiezas = async (
    servicio: ServicioExterno,
    campo: "piezas_enviadas" | "piezas_recibidas",
    piezas: number | null,
  ) => {
    const supabase = getSupabase()
    if (!supabase) return
    // upsert: la fila (folio, servicio) puede no existir todavía
    const { error } = await supabase
      .from("servicio_unidades")
      .upsert(
        { idempresa: IDEMPRESA, folio, servicio, [campo]: piezas },
        { onConflict: "idempresa,folio,servicio" },
      )
    if (error) {
      toast.error("No se pudieron guardar las unidades", { description: error.message })
      return
    }
    onSaved()
  }

  if (servicios.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Este folio no tiene costos de servicios externos capturados en el Excel
          (lavandería, estampado, bordado, corte externo u otro).
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <p className="text-xs font-semibold text-foreground">Servicios externos</p>
        <p className="text-xs text-muted-foreground">
          Se paga por las piezas que devolvieron
        </p>
      </div>
      <div className="divide-y divide-border/60">
        {servicios.map((s) => (
          <div key={s.servicio} className="space-y-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="w-28 shrink-0">
                <p className="text-xs font-semibold text-foreground">{s.servicio}</p>
                <EstadoPill estado={s.estado} />
              </div>

              <div className="flex items-end gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Costo
                  </p>
                  <p className="text-xs font-medium tabular-nums">
                    {s.costo_unitario != null ? (
                      <>
                        {fmtCurrency(num(s.costo_unitario))}
                        <span className="text-[10px] font-normal text-muted-foreground">/pz</span>
                      </>
                    ) : (
                      <span className="text-amber-600">sin valor</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Enviadas
                  </p>
                  <PiezasEditable
                    valor={s.piezas_enviadas}
                    sugerido={piezasRecibidas || piezasOrden || 0}
                    etiquetaSugerido="Usar las piezas recibidas del maquilero"
                    disabled={readOnly}
                    onSave={(v) => guardarPiezas(s.servicio, "piezas_enviadas", v)}
                  />
                </div>
                <div>
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Recibidas
                  </p>
                  <PiezasEditable
                    valor={s.piezas_recibidas}
                    sugerido={s.piezas_enviadas || piezasRecibidas || 0}
                    etiquetaSugerido="Usar las piezas enviadas"
                    disabled={readOnly}
                    onSave={(v) => guardarPiezas(s.servicio, "piezas_recibidas", v)}
                  />
                </div>
                {s.merma > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Merma
                    </p>
                    <p className="text-xs font-medium tabular-nums text-amber-600">
                      {s.merma.toLocaleString("es-MX")}
                    </p>
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-end gap-3">
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Valor
                  </p>
                  <p className="text-xs font-semibold tabular-nums">{fmtCurrency(num(s.valor))}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Saldo
                  </p>
                  <p
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      num(s.saldo) < -CENTAVO ? "text-rose-600" : "text-foreground",
                    )}
                  >
                    {fmtCurrency(num(s.saldo))}
                  </p>
                </div>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPagando(pagando === s.servicio ? null : s.servicio)}
                    className="h-7 gap-1 text-xs"
                  >
                    <Wallet className="size-3" />
                    Pagos
                  </Button>
                )}
              </div>
            </div>

            {pagando === s.servicio && (
              <PagosServicio servicio={s} onSaved={onSaved} readOnly={readOnly} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Historial y alta de pagos de un servicio, desplegable dentro de su fila. */
function PagosServicio({
  servicio,
  onSaved,
  readOnly,
}: {
  servicio: VwServicioPago
  onSaved: () => void
  readOnly: boolean
}) {
  const { user } = useAuth()
  const [pagos, setPagos] = useState<ServicioPago[]>([])
  const [cargando, setCargando] = useState(true)
  const saldoPendiente = Math.max(0, num(servicio.saldo))
  const [fecha, setFecha] = useState(hoyISO())
  const [monto, setMonto] = useState(saldoPendiente > 0 ? saldoPendiente.toFixed(2) : "")
  const [referencia, setReferencia] = useState("")
  const [adelanto, setAdelanto] = useState(servicio.piezas_recibidas === 0)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const { data } = await supabase
      .from("servicio_pagos")
      .select("*")
      .eq("idempresa", IDEMPRESA)
      .eq("folio", servicio.folio)
      .eq("servicio", servicio.servicio)
      .order("fecha")
    setPagos((data as ServicioPago[]) ?? [])
    setCargando(false)
  }, [servicio.folio, servicio.servicio])

  useEffect(() => {
    cargar()
  }, [cargar])

  const n = Number(monto)
  const valido = Number.isFinite(n) && n > 0
  const excede = valido && !adelanto && n > saldoPendiente + CENTAVO

  const pagar = async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)
    const { error } = await supabase.from("servicio_pagos").insert({
      idempresa: IDEMPRESA,
      folio: servicio.folio,
      servicio: servicio.servicio,
      fecha,
      monto: Number(n.toFixed(2)),
      referencia: referencia.trim() || null,
      es_adelanto: adelanto,
      capturado_por: user?.username ?? null,
    })
    setGuardando(false)
    if (error) {
      toast.error("No se pudo registrar el pago", { description: error.message })
      return
    }
    toast.success(`Pago a ${servicio.servicio} registrado`)
    setMonto("")
    setReferencia("")
    cargar()
    onSaved()
  }

  const borrar = async (id: number) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("servicio_pagos")
      .delete()
      .eq("id", id)
      .eq("idempresa", IDEMPRESA)
    if (error) {
      toast.error("No se pudo eliminar el pago", { description: error.message })
      return
    }
    toast.success("Pago eliminado")
    cargar()
    onSaved()
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      {cargando ? (
        <div className="flex justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {pagos.length === 0 ? (
            <Vacio texto={`Sin pagos a ${servicio.servicio}`} />
          ) : (
            <div className="mb-2 divide-y divide-border/60">
              {pagos.map((g) => (
                <FilaMovimiento
                  key={g.id}
                  fecha={g.fecha}
                  principal={fmtCurrency(num(g.monto))}
                  detalle={(g.es_adelanto ? "Adelanto · " : "") + (g.referencia ?? "")}
                  onBorrar={readOnly ? undefined : () => borrar(g.id)}
                />
              ))}
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
              <CampoMini label="Fecha" ancho="w-32">
                <Input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-8"
                />
              </CampoMini>
              <CampoMini label="Monto" ancho="w-28">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  className="h-8"
                />
              </CampoMini>
              <CampoMini label="Referencia" ancho="flex-1 min-w-32">
                <Input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  className="h-8"
                />
              </CampoMini>
              <Button
                size="sm"
                onClick={pagar}
                disabled={!valido || guardando}
                className={cn(
                  "h-8 gap-1.5 text-white",
                  excede
                    ? "bg-rose-600 hover:bg-rose-700"
                    : adelanto
                      ? "bg-indigo-600 hover:bg-indigo-700"
                      : "bg-emerald-600 hover:bg-emerald-700",
                )}
              >
                {guardando && <Loader2 className="size-3.5 animate-spin" />}
                {excede ? "Pagar de más" : adelanto ? "Adelantar" : "Pagar"}
              </Button>
              <div className="flex w-full items-center gap-3">
                <CheckAdelanto checked={adelanto} onChange={setAdelanto} />
                <p className="text-[11px] text-muted-foreground">
                  Saldo: {fmtCurrency(saldoPendiente)}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Cantidad de piezas editable en línea, con atajo para copiar un sugerido. */
function PiezasEditable({
  valor,
  sugerido,
  etiquetaSugerido,
  disabled,
  onSave,
}: {
  valor: number
  sugerido: number
  etiquetaSugerido: string
  disabled: boolean
  onSave: (v: number | null) => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(String(valor || ""))

  useEffect(() => {
    if (!editando) setTexto(String(valor || ""))
  }, [valor, editando])

  const confirmar = () => {
    setEditando(false)
    const t = texto.trim()
    const n = t === "" ? null : Math.trunc(Number(t))
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setTexto(String(valor || ""))
      return
    }
    if (n !== (valor || null)) onSave(n)
  }

  if (disabled) {
    return (
      <span className="tabular-nums text-sm">
        {valor > 0 ? (
          valor.toLocaleString("es-MX")
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </span>
    )
  }

  if (editando) {
    return (
      <Input
        autoFocus
        type="number"
        min="0"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmar()
          if (e.key === "Escape") {
            setTexto(String(valor || ""))
            setEditando(false)
          }
        }}
        className="h-7 w-24 text-right"
      />
    )
  }

  // Sin cantidad todavía: la celda tiene que verse capturable. Un guion
  // suelto se lee como "no hay nada que hacer aquí" y el dato nunca se captura.
  if (valor === 0) {
    return (
      <div className="flex items-center gap-1">
        {sugerido > 0 && (
          <button
            type="button"
            onClick={() => onSave(sugerido)}
            title={etiquetaSugerido}
            className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-1 text-[10px] font-medium text-sky-700 transition-colors hover:border-sky-400 hover:bg-sky-100"
          >
            {sugerido.toLocaleString("es-MX")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditando(true)}
          title="Capturar cantidad"
          className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
        >
          <Pencil className="size-3" />
          Capturar
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      title="Clic para editar"
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium tabular-nums text-foreground transition-colors hover:bg-muted"
    >
      {valor.toLocaleString("es-MX")}
      <Pencil className="size-3 text-muted-foreground/50" />
    </button>
  )
}

// ─── Pestaña 2: Recepciones ──────────────────────────────────────────────────

function RecepcionesTab({ rows, servicios, loading, onRefresh }: TabProps) {
  const readOnly = useReadOnly()
  const [search, setSearch] = useState("")
  const [objetivo, setObjetivo] = useState<string | null>(null)

  const candidatos = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) {
      // Sin búsqueda: lo que falta por recibir, primero lo más atrasado
      return rows
        .filter((r) => {
          const base = r.piezas_cortadas || r.piezas_orden || 0
          return base === 0 || r.piezas_recibidas < base
        })
        .sort((a, b) => b.semanas_demora - a.semanas_demora)
        .slice(0, 40)
    }
    return rows
      .filter((r) =>
        `${r.folio} ${r.modelo ?? ""} ${r.beneficiario ?? ""} ${r.familia ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 40)
  }, [rows, search])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-2.5">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-sky-600" />
        <p className="text-xs text-sky-900">
          Busca el folio que llegó y registra las piezas. Sin búsqueda se listan los que
          faltan por completar, empezando por los más atrasados.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar folio, modelo, familia o maquilero…"
          className="h-10 pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Maquilero</TableHead>
              <TableHead className="font-semibold text-right">Recibidas / Cortadas</TableHead>
              <TableHead className="font-semibold">Última entrega</TableHead>
              <TableHead className="font-semibold text-right">Demora</TableHead>
              <TableHead className="font-semibold text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : candidatos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  Sin coincidencias.
                </TableCell>
              </TableRow>
            ) : (
              candidatos.map((r) => {
                const base = r.piezas_cortadas || r.piezas_orden || 0
                const completo = base > 0 && r.piezas_recibidas >= base
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
                        {base > 0 ? base.toLocaleString("es-MX") : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtFecha(r.ultima_recepcion)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.semanas_demora > 0 ? (
                        <span className="whitespace-nowrap text-rose-600">
                          {r.semanas_demora} sem
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={readOnly}
                        onClick={() => setObjetivo(r.folio)}
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
        <GestionFolioDialog
          row={rows.find((r) => r.folio === objetivo)!}
          servicios={servicios.filter((s) => s.folio === objetivo)}
          onClose={() => setObjetivo(null)}
          onSaved={onRefresh}
          readOnly={readOnly}
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
      { folios: number; aPagar: number; pagado: number; demora: number; abiertos: number; sinCosto: number }
    >()
    for (const r of rows) {
      const k = r.beneficiario ?? "Sin asignar"
      const a =
        mapa.get(k) ?? { folios: 0, aPagar: 0, pagado: 0, demora: 0, abiertos: 0, sinCosto: 0 }
      a.folios++
      if (!r.costo_capturado) {
        a.sinCosto++
      } else {
        a.aPagar += num(r.valor_a_pagar)
        a.pagado += num(r.valor_pagado)
        a.demora += num(r.valor_demora)
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
            <TableHead className="font-semibold text-right">Desc. demora</TableHead>
            <TableHead className="font-semibold text-right">Valor a pagar</TableHead>
            <TableHead className="font-semibold text-right">Pagado</TableHead>
            <TableHead className="font-semibold text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 8 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : resumen.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
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
                <TableCell className="text-right tabular-nums text-sm text-rose-600">
                  {m.demora > CENTAVO ? (
                    fmtCurrency(m.demora)
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

// ─── Pestaña 4: Servicios ────────────────────────────────────────────────────

function ServiciosTab({
  servicios,
  loading,
  onRefresh,
}: {
  servicios: VwServicioPago[]
  loading: boolean
  onRefresh: () => void
}) {
  const readOnly = useReadOnly()
  const [filtroServicio, setFiltroServicio] = useState("__all__")
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [search, setSearch] = useState("")

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return servicios.filter((s) => {
      if (filtroServicio !== "__all__" && s.servicio !== filtroServicio) return false
      if (soloPendientes && s.estado === "Saldado") return false
      if (q && !`${s.folio} ${s.cliente ?? ""} ${s.familia ?? ""}`.toLowerCase().includes(q))
        return false
      return true
    })
  }, [servicios, filtroServicio, soloPendientes, search])

  const kpis = useMemo(() => {
    let valor = 0
    let pagado = 0
    let sinRecibir = 0
    for (const s of filtrados) {
      valor += num(s.valor)
      pagado += num(s.pagado)
      if (s.piezas_recibidas === 0) sinRecibir++
    }
    return { valor, pagado, saldo: valor - pagado, sinRecibir }
  }, [filtrados])

  /** Totales por servicio: a quién se le debe más. */
  const porServicio = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of filtrados) m.set(s.servicio, (m.get(s.servicio) ?? 0) + num(s.saldo))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [filtrados])

  const guardarPiezas = async (
    folio: string,
    servicio: ServicioExterno,
    campo: "piezas_enviadas" | "piezas_recibidas",
    piezas: number | null,
  ) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("servicio_unidades")
      .upsert(
        { idempresa: IDEMPRESA, folio, servicio, [campo]: piezas },
        { onConflict: "idempresa,folio,servicio" },
      )
    if (error) {
      toast.error("No se pudieron guardar las unidades", { description: error.message })
      return
    }
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Valor servicios"
          value={kpis.valor}
          format={fmtCurrency}
          icon={<Sparkles className="size-3.5" />}
          iconBg="bg-cyan-100 ring-cyan-200"
          iconColor="text-cyan-600"
          valueColor="text-cyan-700"
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
          label="Sin recibir"
          value={kpis.sinRecibir}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.sinRecibir > 0 ? "text-amber-600" : "text-foreground"}
          hint="Falta marcar lo que regresó"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Folio, familia o cliente…"
            className="h-9 w-56 pl-8"
          />
        </div>
        <Select value={filtroServicio} onValueChange={setFiltroServicio}>
          <SelectTrigger className="h-9 w-44 bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los servicios</SelectItem>
            {SERVICIOS_EXTERNOS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={soloPendientes ? "default" : "outline"}
          onClick={() => setSoloPendientes(!soloPendientes)}
          className="h-9"
        >
          {soloPendientes ? "Solo pendientes" : "Todos"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{filtrados.length} registros</span>
      </div>

      {porServicio.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {porServicio.map(([nombre, saldo]) => (
            <button
              key={nombre}
              type="button"
              onClick={() => setFiltroServicio(nombre)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-left transition-colors hover:border-cyan-300"
            >
              <p className="text-[11px] text-muted-foreground">{nombre}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {fmtCurrency(saldo)}
              </p>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Servicio</TableHead>
              <TableHead className="font-semibold">Cliente</TableHead>
              <TableHead className="font-semibold text-right">Costo</TableHead>
              <TableHead className="font-semibold text-right">Enviadas</TableHead>
              <TableHead className="font-semibold text-right">Recibidas</TableHead>
              <TableHead className="font-semibold text-right">Merma</TableHead>
              <TableHead className="font-semibold text-right">Valor</TableHead>
              <TableHead className="font-semibold text-right">Pagado</TableHead>
              <TableHead className="font-semibold text-right">Saldo</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                  {servicios.length === 0
                    ? "Ningún folio tiene costos de servicios capturados en el Excel."
                    : "Sin registros para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((s) => (
                <TableRow key={`${s.folio}-${s.servicio}`} className="hover:bg-muted/30">
                  <TableCell>
                    <FolioLink folio={s.folio} className="text-xs" />
                  </TableCell>
                  <TableCell className="text-sm font-medium">{s.servicio}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.cliente ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm">
                    <ValorUnitario valor={s.costo_unitario} />
                  </TableCell>
                  <TableCell className="text-right">
                    <PiezasEditable
                      valor={s.piezas_enviadas}
                      sugerido={s.piezas_orden ?? 0}
                      etiquetaSugerido="Usar las piezas de la orden"
                      disabled={readOnly}
                      onSave={(v) => guardarPiezas(s.folio, s.servicio, "piezas_enviadas", v)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <PiezasEditable
                      valor={s.piezas_recibidas}
                      sugerido={s.piezas_enviadas}
                      etiquetaSugerido="Usar las piezas enviadas"
                      disabled={readOnly}
                      onSave={(v) => guardarPiezas(s.folio, s.servicio, "piezas_recibidas", v)}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {s.merma > 0 ? (
                      <span className="text-amber-600">{s.merma.toLocaleString("es-MX")}</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {fmtCurrency(num(s.valor))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-emerald-700">
                    {num(s.pagado) > 0 ? (
                      fmtCurrency(num(s.pagado))
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums text-sm font-semibold",
                      num(s.saldo) < -CENTAVO ? "text-rose-600" : "text-foreground",
                    )}
                  >
                    {fmtCurrency(num(s.saldo))}
                  </TableCell>
                  <TableCell>
                    <EstadoPill estado={s.estado} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Los pagos de cada servicio se registran desde el botón <strong>Gestionar</strong> del
        folio, en la pestaña de Cuentas por Pagar.
      </p>
    </div>
  )
}

// ─── Pestaña 5: Historial de pagos ───────────────────────────────────────────

/**
 * Todo lo pagado en una sola línea de tiempo, de maquila y de servicios.
 *
 * El libro mayor responde "¿cómo va este folio?"; esta pestaña responde
 * "¿qué le he pagado a esta persona y cuándo?", que es la pregunta que se
 * hace al cuadrar cuentas con un maquilero.
 */
function HistorialTab({ configMissing }: { configMissing: boolean }) {
  const [pagos, setPagos] = useState<HistorialPago[]>([])
  const [loading, setLoading] = useState(false)
  const [beneficiario, setBeneficiario] = useState("__all__")
  const [tipo, setTipo] = useState("__all__")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [search, setSearch] = useState("")

  const fetchPagos = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from("vw_historial_pagos")
      .select("*")
      .eq("idempresa", IDEMPRESA)
      .order("fecha", { ascending: false })
    setLoading(false)
    if (error) {
      toast.error("No se pudo cargar el historial", { description: error.message })
      return
    }
    setPagos((data as HistorialPago[]) ?? [])
  }, [configMissing])

  useEffect(() => {
    fetchPagos()
  }, [fetchPagos])

  const beneficiarios = useMemo(
    () => Array.from(new Set(pagos.map((p) => p.beneficiario).filter(Boolean) as string[])).sort(),
    [pagos],
  )
  const tipos = useMemo(
    () => Array.from(new Set(pagos.map((p) => p.tipo))).sort(),
    [pagos],
  )

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pagos.filter((p) => {
      if (beneficiario !== "__all__" && p.beneficiario !== beneficiario) return false
      if (tipo !== "__all__" && p.tipo !== tipo) return false
      if (desde && p.fecha < desde) return false
      if (hasta && p.fecha > hasta) return false
      if (q && !`${p.folio} ${p.referencia ?? ""} ${p.cliente ?? ""}`.toLowerCase().includes(q))
        return false
      return true
    })
  }, [pagos, beneficiario, tipo, desde, hasta, search])

  const kpis = useMemo(() => {
    let total = 0
    let adelantos = 0
    for (const p of filtrados) {
      total += num(p.monto)
      if (p.es_adelanto) adelantos += num(p.monto)
    }
    return { total, adelantos, movimientos: filtrados.length }
  }, [filtrados])

  const porBeneficiario = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of filtrados) {
      const k = p.beneficiario ?? "—"
      m.set(k, (m.get(k) ?? 0) + num(p.monto))
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [filtrados])

  const exportar = () => {
    if (filtrados.length === 0) {
      toast.warning("Sin pagos para exportar con los filtros aplicados.")
      return
    }
    const datos = filtrados.map((p) => ({
      Fecha: p.fecha,
      Tipo: p.tipo,
      Beneficiario: p.beneficiario ?? "",
      Folio: p.folio,
      Modelo: p.modelo ?? "",
      Cliente: p.cliente ?? "",
      Monto: num(p.monto),
      Adelanto: p.es_adelanto ? "Sí" : "No",
      Referencia: p.referencia ?? "",
      "Capturado por": p.capturado_por ?? "",
    }))
    const ws = XLSX.utils.json_to_sheet(datos)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Historial de pagos")
    XLSX.writeFile(wb, `historial_pagos_${hoyISO()}.xlsx`)
    toast.success(`${datos.length} pagos exportados`)
  }

  const limpiar = () => {
    setBeneficiario("__all__")
    setTipo("__all__")
    setDesde("")
    setHasta("")
    setSearch("")
  }

  const hayFiltros =
    beneficiario !== "__all__" || tipo !== "__all__" || desde !== "" || hasta !== "" || search !== ""

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="Total pagado"
          value={kpis.total}
          format={fmtCurrency}
          icon={<Wallet className="size-3.5" />}
          iconBg="bg-emerald-100 ring-emerald-200"
          iconColor="text-emerald-600"
          valueColor="text-emerald-700"
        />
        <KpiCard
          label="En adelantos"
          value={kpis.adelantos}
          format={fmtCurrency}
          icon={<Banknote className="size-3.5" />}
          iconBg="bg-indigo-100 ring-indigo-200"
          iconColor="text-indigo-600"
          valueColor={kpis.adelantos > 0 ? "text-indigo-700" : "text-foreground"}
          hint="Pagos hechos antes de recibir"
        />
        <KpiCard
          label="Movimientos"
          value={kpis.movimientos}
          icon={<History className="size-3.5" />}
          iconBg="bg-slate-100 ring-slate-200"
          iconColor="text-slate-600"
          valueColor="text-foreground"
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <CampoMini label="Beneficiario" ancho="w-52">
          <Select value={beneficiario} onValueChange={setBeneficiario}>
            <SelectTrigger className="h-9 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {beneficiarios.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoMini>
        <CampoMini label="Tipo" ancho="w-40">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-9 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {tipos.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoMini>
        <CampoMini label="Desde" ancho="w-36">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9" />
        </CampoMini>
        <CampoMini label="Hasta" ancho="w-36">
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-9" />
        </CampoMini>
        <CampoMini label="Buscar" ancho="w-52">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Folio o referencia…"
            className="h-9"
          />
        </CampoMini>

        <div className="ml-auto flex items-center gap-2">
          {hayFiltros && (
            <button
              type="button"
              onClick={limpiar}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Limpiar
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={filtrados.length === 0}
            className="h-9 gap-1.5 bg-transparent"
          >
            <Download className="size-3.5" />
            Exportar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPagos}
            disabled={loading}
            className="h-9 gap-1.5 bg-transparent"
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

      {porBeneficiario.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {porBeneficiario.map(([nombre, total]) => (
            <button
              key={nombre}
              type="button"
              onClick={() => setBeneficiario(nombre)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-left transition-colors hover:border-emerald-300"
            >
              <p className="text-[11px] text-muted-foreground">{nombre}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {fmtCurrency(total)}
              </p>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Fecha</TableHead>
              <TableHead className="font-semibold">Tipo</TableHead>
              <TableHead className="font-semibold">Beneficiario</TableHead>
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Cliente</TableHead>
              <TableHead className="font-semibold text-right">Monto</TableHead>
              <TableHead className="font-semibold">Referencia</TableHead>
              <TableHead className="font-semibold">Capturó</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-28 text-center text-sm text-muted-foreground">
                  {pagos.length === 0
                    ? "Todavía no se ha registrado ningún pago."
                    : "Sin pagos para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((p) => (
                <TableRow key={p.clave} className="hover:bg-muted/30">
                  <TableCell className="whitespace-nowrap text-sm">{fmtFecha(p.fecha)}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        p.tipo === "Maquila"
                          ? "border-violet-300 bg-violet-50 text-violet-700"
                          : "border-cyan-300 bg-cyan-50 text-cyan-700",
                      )}
                    >
                      {p.tipo}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{p.beneficiario ?? "—"}</TableCell>
                  <TableCell>
                    <FolioLink folio={p.folio} className="text-xs" />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.cliente ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm">
                    <span className="font-semibold tabular-nums">{fmtCurrency(num(p.monto))}</span>
                    {p.es_adelanto && (
                      <span
                        className="ml-1.5 rounded-full border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"
                        title="Pago hecho antes de recibir la mercancía"
                      >
                        adelanto
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.referencia ?? p.comentarios ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.capturado_por ?? "—"}
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

"use client"

/**
 * Pago Maquilas — cuentas por pagar al maquilero y a los servicios externos.
 *
 * FÓRMULA (script 032):
 *
 *   costo final    = piezas recibidas × costo unitario
 *   − no entregadas × precio de venta   (orden − recibidas, automático)
 *   − demora        = costo final × 1.5% por semana de atraso
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
  PROCESOS_LAVANDERIA,
  SERVICIOS_EXTERNOS,
  type HistorialPago,
  type MaquilaPago,
  type MaquilaRecepcion,
  type ProcesoLavanderia,
  type ServicioExterno,
  type VwPagoMaquilas,
  type VwServicioPago,
} from "@/lib/types"
import { cn } from "@/lib/utils"

import { FolioLink } from "@/components/folio-detail-drawer"
import { KpiCard } from "@/components/kpi-card"
import { PagoMaquilaDetalle } from "@/components/pago-maquilas-detalle"
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

/** Descuento por cada semana completa de atraso sobre el plazo. */
const DEMORA_SEMANAL_PCT = 1.5

/** De dónde sale el costo de cada proceso en una fila de la vista. */
const COSTO_DEL_SERVICIO: Record<ServicioExterno, (r: VwPagoMaquilas) => number | null> = {
  "Lavandería": (r) => r.costo_lavanderia,
  Estampado: (r) => r.costo_estampado,
  Bordado: (r) => r.costo_bordado,
  "Corte Externo": (r) => r.costo_corte_externo,
  Otro: (r) => r.costo_otro,
}

/** Columna de `ordenes_produccion` donde vive el costo de cada servicio. */
const COLUMNA_COSTO: Record<ServicioExterno, string> = {
  "Lavandería": "costo_lavanderia",
  Estampado: "costo_estampado",
  Bordado: "costo_bordado",
  "Corte Externo": "costo_corte_externo",
  Otro: "costo_otro",
}

/**
 * Días que tiene el maquilero para entregar desde que arranca maquila (S1).
 * Espeja `fn_plazo_maquilero` del script 035 — si cambia allá, cambiar aquí.
 */
const DEMORA_PLAZO_DIAS = 45

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
  /** Folio abierto en la vista de gestión. Null = se ve el listado. */
  const [folioActivo, setFolioActivo] = useState<string | null>(null)
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

  const rowActiva = folioActivo ? rows.find((r) => r.folio === folioActivo) : undefined

  // La gestión toma la pantalla completa: son seis bloques de información y
  // en un diálogo obligaba a desplazarse dentro de una ventana dentro de otra.
  if (rowActiva) {
    return (
      <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
        <PagoMaquilaDetalle
          row={rowActiva}
          servicios={servicios.filter((x) => x.folio === rowActiva.folio)}
          onVolver={() => setFolioActivo(null)}
          onSaved={fetchRows}
        />
      </section>
    )
  }

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
          <TabsTrigger value="servicios">Lavandería</TabsTrigger>
          <TabsTrigger value="historial">Historial de Pagos</TabsTrigger>
        </TabsList>

        <TabsContent value="cuentas" className="mt-5">
          <CuentasTab
            rows={rows}
            servicios={servicios}
            loading={loading}
            onRefresh={fetchRows}
            onGestionar={setFolioActivo}
          />
        </TabsContent>

        <TabsContent value="recepciones" className="mt-5">
          <RecepcionesTab
            rows={rows}
            servicios={servicios}
            loading={loading}
            onRefresh={fetchRows}
            onGestionar={setFolioActivo}
          />
        </TabsContent>

        <TabsContent value="maquileros" className="mt-5">
          <MaquilerosTab rows={rows} loading={loading} />
        </TabsContent>

        <TabsContent value="servicios" className="mt-5">
          <LavanderiaTab
            rows={rows}
            servicios={servicios}
            loading={loading}
            onRefresh={fetchRows}
            onGestionar={setFolioActivo}
          />
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
  /** Abre la vista de gestión del folio, que sustituye al listado. */
  onGestionar: (folio: string) => void
}

// ─── Pestaña 1: Cuentas por Pagar ────────────────────────────────────────────

function CuentasTab({ rows, loading, onRefresh, onGestionar }: TabProps) {
  const readOnly = useReadOnly()
  const [search, setSearch] = useState("")
  const [filtroMaquilero, setFiltroMaquilero] = useState("__all__")
  const [filtroEstado, setFiltroEstado] = useState("__all__")

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
      "Precio venta": r.precio_venta ?? "",
      "Costo final": num(r.costo_final),
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
              <TableHead className="font-semibold text-right">Precio venta</TableHead>
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
                  {Array.from({ length: 15 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="h-28 text-center text-sm text-muted-foreground">
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
                  onGestionar={() => onGestionar(r.folio)}
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
        <ValorUnitario valor={row.precio_venta} />
      </TableCell>
      <TableCell className="text-right text-sm">
        <ValorUnitario valor={row.costo_lavanderia} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {row.piezas_no_entregadas > 0 ? (
          <span
            className="text-rose-600"
            title={`${row.piezas_orden ?? 0} de la orden − ${row.piezas_recibidas} recibidas · descuenta ${fmtCurrency(num(row.valor_no_entregadas))}`}
          >
            {row.piezas_no_entregadas.toLocaleString("es-MX")}
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

/** Etiqueta + control, para los formularios en línea de las pestañas. */
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
      <label className="block text-[13px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

// ─── Pestaña 2: Recepciones ──────────────────────────────────────────────────

function RecepcionesTab({ rows, loading, onGestionar }: TabProps) {
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
                        onClick={() => onGestionar(r.folio)}
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

// ─── Pestaña 4: Lavandería ───────────────────────────────────────────────────

/**
 * El proceso de lavandería, con su propio flujo de pago.
 *
 * Solo lavandería: los otros servicios externos se costean dentro del folio,
 * en Gestionar. Aquí importa lo que la lavandería alcanzó a procesar, que no
 * siempre es todo lo que devolvió el maquilero, y su costo va sobre esa
 * cantidad —no sobre las recibidas—.
 */
function LavanderiaTab({ rows, servicios, loading, onRefresh, onGestionar }: TabProps) {
  const readOnly = useReadOnly()
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [search, setSearch] = useState("")

  const lavanderia = useMemo(
    () => servicios.filter((s) => s.servicio === "Lavandería"),
    [servicios],
  )

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lavanderia.filter((s) => {
      if (soloPendientes && s.procesadas_capturadas) return false
      if (q && !`${s.folio} ${s.cliente ?? ""} ${s.familia ?? ""}`.toLowerCase().includes(q))
        return false
      return true
    })
  }, [lavanderia, soloPendientes, search])

  const kpis = useMemo(() => {
    let valor = 0
    let piezas = 0
    let sinProcesar = 0
    let sinCosto = 0
    for (const s of filtrados) {
      valor += num(s.valor)
      piezas += s.piezas_procesadas
      if (!s.procesadas_capturadas) sinProcesar++
      if (s.costo_unitario == null) sinCosto++
    }
    return { valor, piezas, sinProcesar, sinCosto, folios: filtrados.length }
  }, [filtrados])

  /** El tipo de lavado. Vive en servicio_unidades, junto a las procesadas. */
  const guardarProceso = async (folio: string, proceso: ProcesoLavanderia | null) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("servicio_unidades")
      .upsert(
        { idempresa: IDEMPRESA, folio, servicio: "Lavandería", proceso },
        { onConflict: "idempresa,folio,servicio" },
      )
    if (error) {
      toast.error("No se pudo guardar el proceso", { description: error.message })
      return
    }
    onRefresh()
  }

  /** Las piezas que la lavandería trabajó. Vacío = las recibidas del maquilero. */
  const guardarProcesadas = async (folio: string, valor: number | null) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("servicio_unidades")
      .upsert(
        { idempresa: IDEMPRESA, folio, servicio: "Lavandería", piezas_procesadas: valor },
        { onConflict: "idempresa,folio,servicio" },
      )
    if (error) {
      toast.error("No se pudieron guardar las piezas procesadas", {
        description: error.message,
      })
      return
    }
    toast.success(
      valor == null ? "Vuelve a seguir las piezas recibidas" : "Piezas procesadas guardadas",
    )
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Valor lavandería"
          value={kpis.valor}
          format={fmtCurrency}
          icon={<Sparkles className="size-3.5" />}
          iconBg="bg-cyan-100 ring-cyan-200"
          iconColor="text-cyan-600"
          valueColor="text-cyan-700"
        />
        <KpiCard
          label="Piezas procesadas"
          value={kpis.piezas}
          icon={<PackageCheck className="size-3.5" />}
          iconBg="bg-slate-100 ring-slate-200"
          iconColor="text-slate-600"
          valueColor="text-foreground"
          hint={`En ${kpis.folios} folios`}
        />
        <KpiCard
          label="Sin capturar"
          value={kpis.sinProcesar}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.sinProcesar > 0 ? "text-amber-600" : "text-foreground"}
          hint="Se cobran sobre las recibidas"
        />
        <KpiCard
          label="Sin costo"
          value={kpis.sinCosto}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.sinCosto > 0 ? "text-amber-600" : "text-foreground"}
          hint="No suman al valor a pagar"
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
        <Button
          size="sm"
          variant={soloPendientes ? "default" : "outline"}
          onClick={() => setSoloPendientes(!soloPendientes)}
          className="h-9"
        >
          {soloPendientes ? "Solo sin capturar" : "Todos"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{filtrados.length} folios</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Cliente</TableHead>
              <TableHead className="font-semibold">Familia</TableHead>
              <TableHead className="font-semibold">Proceso</TableHead>
              <TableHead className="font-semibold text-right">Piezas cortadas</TableHead>
              <TableHead className="font-semibold text-right">Piezas procesadas</TableHead>
              <TableHead className="font-semibold text-right">Costo unitario</TableHead>
              <TableHead className="font-semibold text-right">Costo total</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">
                  {lavanderia.length === 0
                    ? "Ningún folio tiene costo de lavandería capturado en el Excel."
                    : "Sin folios para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((s) => {
                const gestionable = rows.some((r) => r.folio === s.folio)
                return (
                  <TableRow key={s.folio} className="hover:bg-muted/30">
                    <TableCell>
                      <FolioLink folio={s.folio} className="text-xs" />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.cliente ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.familia ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ProcesoSelect
                        servicio={s.servicio}
                        valor={s.proceso}
                        disabled={readOnly}
                        onSave={(v) => guardarProceso(s.folio, v)}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {s.piezas_cortadas > 0 ? s.piezas_cortadas.toLocaleString("es-MX") : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <ProcesadasEditable
                        valor={s.piezas_procesadas}
                        deRecibidas={s.piezas_recibidas}
                        capturado={s.procesadas_capturadas}
                        disabled={readOnly}
                        onSave={(v) => guardarProcesadas(s.folio, v)}
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <ValorUnitario valor={s.costo_unitario} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {fmtCurrency(num(s.valor))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={!gestionable}
                        title={
                          gestionable
                            ? "Costos, entregas y pagos del folio"
                            : "El folio no tiene maquilero asignado"
                        }
                        onClick={() => onGestionar(s.folio)}
                      >
                        <Settings2 className="size-3.5" />
                        Gestionar
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        El costo de lavandería se calcula sobre las <strong>piezas procesadas</strong>; si no
        se capturan, se usan las piezas que recibió el maquilero. Ese importe ya está dentro
        del costo final del folio, así que los pagos se registran en <strong>Gestionar</strong>.
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

/**
 * Tipo de lavado del folio.
 *
 * Solo aplica a Lavandería; en los demás servicios la celda queda vacía en
 * vez de ofrecer un desplegable que no significa nada ahí.
 */
function ProcesoSelect({
  servicio,
  valor,
  disabled,
  onSave,
}: {
  servicio: ServicioExterno
  valor: ProcesoLavanderia | null
  disabled: boolean
  onSave: (v: ProcesoLavanderia | null) => void
}) {
  if (servicio !== "Lavandería") {
    return <span className="text-sm text-muted-foreground/40">—</span>
  }

  if (disabled) {
    return (
      <span className="text-sm">
        {valor ?? <span className="text-muted-foreground/50">—</span>}
      </span>
    )
  }

  return (
    <Select
      value={valor ?? "__none__"}
      onValueChange={(v) => onSave(v === "__none__" ? null : (v as ProcesoLavanderia))}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-36 bg-transparent text-sm",
          !valor && "border-dashed text-muted-foreground",
        )}
      >
        <SelectValue placeholder="Elegir…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Sin proceso</SelectItem>
        {PROCESOS_LAVANDERIA.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Piezas que un proceso trabajó realmente. Vacío = las que recibió el
 * maquilero, para que el folio siga a las entregas si mañana cambian.
 */
function ProcesadasEditable({
  valor,
  deRecibidas,
  capturado,
  disabled,
  onSave,
}: {
  valor: number
  deRecibidas: number
  capturado: boolean
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
    // Igualar las recibidas se guarda como null: no es lo mismo "procesó
    // justo lo que llegó" que "quedó fijado en ese número para siempre".
    const limpio = n === deRecibidas ? null : n
    if (limpio !== (capturado ? valor : null)) onSave(limpio)
  }

  if (disabled) {
    return <span className="tabular-nums">{valor.toLocaleString("es-MX")}</span>
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
        className="ml-auto h-9 w-28 text-right text-base"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      title={
        capturado
          ? `Capturadas a mano · el maquilero entregó ${deRecibidas.toLocaleString("es-MX")}`
          : `Sin capturar · se usan las ${deRecibidas.toLocaleString("es-MX")} recibidas`
      }
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 tabular-nums transition-colors hover:bg-muted",
        capturado ? "font-semibold text-cyan-700" : "text-muted-foreground",
      )}
    >
      {valor.toLocaleString("es-MX")}
      <Pencil className="size-3.5 text-muted-foreground/50" />
    </button>
  )
}

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
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
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
              <TableHead className="font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Maquilero</TableHead>
              <TableHead className="font-semibold text-right">Orden</TableHead>
              <TableHead className="font-semibold text-right">Recibidas</TableHead>
              <TableHead className="font-semibold text-right">Valor Maquila</TableHead>
              <TableHead className="font-semibold text-right">Valor Lavandería</TableHead>
              <TableHead className="font-semibold text-right">Penalizadas</TableHead>
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
                  {Array.from({ length: 12 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="h-28 text-center text-sm text-muted-foreground">
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
          row={filtradas.find((r) => r.folio === gestionando) ?? rows.find((r) => r.folio === gestionando)!}
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
      <TableCell className="text-sm">{row.beneficiario ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
        {row.piezas_orden?.toLocaleString("es-MX") ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {row.piezas_recibidas.toLocaleString("es-MX")}
      </TableCell>

      {/* Valores por pieza tal como vienen del Excel. Poder verlos de un
          vistazo es la pregunta que el usuario necesita responder. */}
      <TableCell className="text-right text-sm">
        <ValorUnitario valor={row.costo_maquila} />
      </TableCell>
      <TableCell className="text-right text-sm">
        <ValorUnitario valor={row.costo_lavanderia} etiquetaVacia="Sin valor" />
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
        <span
          className={cn(
            "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
            ESTADO_STYLE[row.estado_pago],
          )}
        >
          {row.estado_pago}
        </span>
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

/**
 * Valor por pieza tal como viene del Excel (Costo Maquila / Costo Lavandería).
 *
 * Distingue el dato faltante del cero: un folio sin valor capturado no es un
 * folio que valga cero. Si se pintaran igual, un maquilero al que se le debe
 * parecería saldado.
 */
function ValorUnitario({
  valor,
  etiquetaVacia = "Sin valor",
}: {
  valor: number | null
  etiquetaVacia?: string
}) {
  if (valor == null) {
    return (
      <span
        className="inline-flex whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
        title="La columna correspondiente del Excel viene vacía para este folio"
      >
        {etiquetaVacia}
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

// ─── Modal de gestión del folio ──────────────────────────────────────────────

/**
 * Todo lo que se puede hacer con un folio, en un solo lugar: ver sus costos
 * unitarios, registrar recepciones, penalizaciones y pagos.
 *
 * Los formularios de alta van EN LÍNEA, no en diálogos anidados: abrir un
 * modal dentro de otro pelea con el foco y obliga a cerrar dos cosas para
 * volver a la tabla.
 */
function GestionFolioDialog({
  row,
  onClose,
  onSaved,
  readOnly,
}: {
  row: VwPagoMaquilas
  onClose: () => void
  onSaved: () => void
  readOnly: boolean
}) {
  const { user } = useAuth()
  const [recepciones, setRecepciones] = useState<MaquilaRecepcion[]>([])
  const [penalizaciones, setPenalizaciones] = useState<MaquilaPenalizacion[]>([])
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
    setPenalizaciones((p.data as MaquilaPenalizacion[]) ?? [])
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
    const { error } = await supabase
      .from(tabla)
      .insert({ idempresa: IDEMPRESA, folio: row.folio, capturado_por: user?.username ?? null, ...payload })
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

  const saldoPendiente = Math.max(0, num(row.saldo))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-emerald-600" />
            Folio {row.folio}
          </DialogTitle>
          <DialogDescription>
            {row.beneficiario ?? "Sin maquilero"} · {row.modelo ?? "sin modelo"} ·{" "}
            {row.cliente ?? "sin cliente"}
          </DialogDescription>
        </DialogHeader>

        {/* Costos unitarios del folio, tal como vinieron del Excel */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-4">
          <DatoUnitario label="Valor maquila" valor={row.costo_maquila} destacado />
          <DatoUnitario label="Valor lavandería" valor={row.costo_lavanderia} />
          <DatoUnitario label="Precio venta" valor={row.precio_venta} />
          <DatoUnitario label="Precio público" valor={row.precio_publico} />
        </div>

        {!row.costo_capturado && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <p className="text-[11px] text-amber-900">
              Sin <span className="font-semibold">costo de maquila</span>, la columna{" "}
              <code className="font-mono">Costo Maquila</code> del Excel viene vacía para este
              folio. Se pueden registrar recepciones, pero no pagos: no hay contra qué calcularlos.
            </p>
          </div>
        )}

        {/* Resumen del dinero */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-5">
          <Resumen
            label="Recibidas"
            valor={`${row.piezas_recibidas.toLocaleString("es-MX")} / ${
              row.piezas_orden?.toLocaleString("es-MX") ?? "—"
            }`}
          />
          <Resumen
            label="Lavandería"
            valor={
              row.piezas_lavanderia > 0
                ? `${row.piezas_lavanderia.toLocaleString("es-MX")} pz · ${fmtCurrency(num(row.valor_lavanderia))}`
                : "Sin unidades"
            }
          />
          <Resumen label="Valor a pagar" valor={row.costo_capturado ? fmtCurrency(num(row.valor_a_pagar)) : "—"} />
          <Resumen label="Pagado" valor={fmtCurrency(num(row.valor_pagado))} tono="text-emerald-700" />
          <Resumen
            label="Saldo"
            valor={row.costo_capturado ? fmtCurrency(num(row.saldo)) : "—"}
            tono={num(row.saldo) < -CENTAVO ? "text-rose-600" : "text-foreground"}
          />
        </div>

        {cargando ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <SeccionRecepciones
              filas={recepciones}
              row={row}
              readOnly={readOnly}
              onGuardar={guardar}
              onBorrar={borrar}
            />
            <SeccionPenalizaciones
              filas={penalizaciones}
              row={row}
              readOnly={readOnly}
              onGuardar={guardar}
              onBorrar={borrar}
            />
            <SeccionPagos
              filas={pagos}
              row={row}
              readOnly={readOnly}
              saldoPendiente={saldoPendiente}
              onGuardar={guardar}
              onBorrar={borrar}
            />
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

function DatoUnitario({
  label,
  valor,
  destacado,
}: {
  label: string
  valor: number | null
  destacado?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {valor == null ? (
        <p className="text-sm font-medium text-amber-600">Sin dato</p>
      ) : (
        <p className={cn("text-sm font-semibold tabular-nums", destacado && "text-emerald-700")}>
          {fmtCurrency(Number(valor))}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">/pz</span>
        </p>
      )}
    </div>
  )
}

function Resumen({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", tono ?? "text-foreground")}>{valor}</p>
    </div>
  )
}

type GuardarFn = (
  tabla: string,
  payload: Record<string, unknown>,
  etiqueta: string,
) => Promise<boolean>
type BorrarFn = (tabla: string, id: number, etiqueta: string) => void

/** Contenedor de una sección del modal: título, total y lista. */
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
      <div className="divide-y divide-border/60">{children}</div>
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

// ── Sección: recepciones ──

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
  const [comentarios, setComentarios] = useState("")
  const [guardando, setGuardando] = useState(false)

  const n = Number(piezas)
  const valido = Number.isFinite(n) && n > 0
  const excede = valido && row.piezas_orden != null && row.piezas_recibidas + n > row.piezas_orden

  const enviar = async () => {
    setGuardando(true)
    const ok = await onGuardar(
      "maquila_recepciones",
      { fecha, piezas: Math.trunc(n), comentarios: comentarios.trim() || null },
      "La recepción",
    )
    setGuardando(false)
    if (ok) {
      setPiezas("")
      setComentarios("")
    }
  }

  return (
    <Seccion
      titulo="Recepciones"
      total={`${row.piezas_recibidas.toLocaleString("es-MX")} pz recibidas`}
      formulario={
        readOnly ? undefined : (
          <div className="flex flex-wrap items-end gap-2">
            <CampoMini label="Fecha" ancho="w-36">
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
            <CampoMini label="Comentario" ancho="flex-1 min-w-40">
              <Input
                value={comentarios}
                onChange={(e) => setComentarios(e.target.value)}
                className="h-8"
              />
            </CampoMini>
            <Button
              size="sm"
              onClick={enviar}
              disabled={!valido || guardando}
              className="h-8 gap-1.5 bg-sky-600 text-white hover:bg-sky-700"
            >
              {guardando ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}
              Recibir
            </Button>
            {excede && (
              <p className="w-full text-[11px] font-medium text-amber-600">
                Con esta recepción se supera la cantidad de la orden (
                {row.piezas_orden?.toLocaleString("es-MX")} pz).
              </p>
            )}
          </div>
        )
      }
    >
      {filas.length === 0 ? (
        <Vacio texto="Sin recepciones registradas" />
      ) : (
        filas.map((r) => (
          <FilaMovimiento
            key={r.id}
            fecha={r.fecha}
            principal={`${r.piezas.toLocaleString("es-MX")} pz`}
            detalle={r.comentarios}
            onBorrar={readOnly ? undefined : () => onBorrar("maquila_recepciones", r.id, "La recepción")}
          />
        ))
      )}
    </Seccion>
  )
}

// ── Sección: penalizaciones ──

function SeccionPenalizaciones({
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
  const excede = valido && n > row.piezas_recibidas

  const enviar = async () => {
    setGuardando(true)
    const ok = await onGuardar(
      "maquila_penalizaciones",
      { fecha, piezas: Math.trunc(n), motivo: motivo.trim() },
      "La penalización",
    )
    setGuardando(false)
    if (ok) {
      setPiezas("")
      setMotivo("")
    }
  }

  return (
    <Seccion
      titulo="Penalizaciones"
      total={
        row.precio_venta == null
          ? "Sin precio de venta"
          : `${row.piezas_penalizadas} pz · ${fmtCurrency(num(row.valor_penalizaciones))}`
      }
      formulario={
        readOnly ? undefined : (
          <div className="flex flex-wrap items-end gap-2">
            <CampoMini label="Fecha" ancho="w-36">
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8" />
            </CampoMini>
            <CampoMini label="Piezas malas" ancho="w-28">
              <Input
                type="number"
                min="1"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
                className="h-8"
              />
            </CampoMini>
            <CampoMini label="Motivo" ancho="flex-1 min-w-40">
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Costura abierta, manchas…"
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
              Penalizar
            </Button>
            {valido && (
              <p className="w-full text-[11px] text-muted-foreground">
                {row.precio_venta == null ? (
                  <span className="font-medium text-amber-600">
                    Este folio no tiene precio de venta: la penalización se registrará pero
                    descontará $0.
                  </span>
                ) : (
                  <>
                    Descuenta {fmtCurrency(importe)} ({n} × {fmtCurrency(num(row.precio_venta))} de
                    precio de venta)
                  </>
                )}
                {excede && (
                  <span className="block font-medium text-rose-600">
                    Son más piezas de las recibidas ({row.piezas_recibidas}).
                  </span>
                )}
              </p>
            )}
          </div>
        )
      }
    >
      {filas.length === 0 ? (
        <Vacio texto="Sin penalizaciones" />
      ) : (
        filas.map((p) => (
          <FilaMovimiento
            key={p.id}
            fecha={p.fecha}
            principal={`${p.piezas} pz · ${fmtCurrency(p.piezas * num(row.precio_venta))}`}
            detalle={p.motivo}
            onBorrar={
              readOnly ? undefined : () => onBorrar("maquila_penalizaciones", p.id, "La penalización")
            }
          />
        ))
      )}
    </Seccion>
  )
}

// ── Sección: pagos ──

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
  // Pre-llenar el saldo exacto es la medida anti-sobrepago más efectiva
  const [monto, setMonto] = useState(saldoPendiente > 0 ? saldoPendiente.toFixed(2) : "")
  const [referencia, setReferencia] = useState("")
  const [guardando, setGuardando] = useState(false)

  const n = Number(monto)
  const valido = Number.isFinite(n) && n > 0
  const excede = valido && n > saldoPendiente + CENTAVO

  const enviar = async () => {
    setGuardando(true)
    const ok = await onGuardar(
      "maquila_pagos",
      {
        fecha,
        monto: Number(n.toFixed(2)),
        referencia: referencia.trim() || null,
        // Deja rastro de con qué costo se calculó, por si el Excel lo cambia
        costo_maquila_aplicado: row.costo_maquila,
      },
      "El pago",
    )
    setGuardando(false)
    if (ok) {
      setMonto("")
      setReferencia("")
    }
  }

  return (
    <Seccion
      titulo="Pagos"
      total={`${fmtCurrency(num(row.valor_pagado))} pagados`}
      formulario={
        readOnly ? undefined : !row.costo_capturado ? (
          <p className="text-[11px] text-muted-foreground">
            No se pueden registrar pagos sin costo de maquila capturado.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <CampoMini label="Fecha" ancho="w-36">
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
                excede ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {guardando ? <Loader2 className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />}
              {excede ? "Pagar de más" : "Pagar"}
            </Button>
            <p className="w-full text-[11px] text-muted-foreground">
              Saldo pendiente: {fmtCurrency(saldoPendiente)}
              {excede && (
                <span className="ml-2 font-medium text-rose-600">
                  Excede en {fmtCurrency(n - saldoPendiente)}: el folio quedará sobrepagado.
                </span>
              )}
            </p>
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
            detalle={g.referencia}
            onBorrar={readOnly ? undefined : () => onBorrar("maquila_pagos", g.id, "El pago")}
          />
        ))
      )}
    </Seccion>
  )
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

// ─── Pestaña 2: Recepciones ──────────────────────────────────────────────────

function RecepcionesTab({ rows, loading, onRefresh }: TabProps) {
  const readOnly = useReadOnly()
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
        <GestionFolioDialog
          row={objetivo}
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

  const guardarUnidades = async (folio: string, piezas: number | null) => {
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(folio)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ piezas_lavanderia: piezas })
      .eq("folio", folio)
      .eq("idempresa", IDEMPRESA)
    setGuardando(null)
    if (error) {
      toast.error("No se pudieron guardar las unidades", { description: error.message })
      return
    }
    onRefresh()
  }

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
              <TableHead className="font-semibold text-right">Valor Maquila</TableHead>
              <TableHead className="font-semibold text-right">Valor Lavandería</TableHead>
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
                  <TableCell className="text-right">
                    <UnidadesLavanderia
                      valor={r.piezas_lavanderia}
                      sugerido={r.piezas_recibidas}
                      disabled={readOnly || guardando === r.folio}
                      onSave={(v) => guardarUnidades(r.folio, v)}
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <ValorUnitario valor={r.costo_lavanderia} />
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

/**
 * Unidades enviadas a lavandería, editables en línea.
 *
 * Es un campo propio del folio: la lavandería recibe un lote que no tiene
 * por qué coincidir con lo que devolvió el maquilero. Se ofrece lo recibido
 * como atajo, pero quien captura decide.
 */
function UnidadesLavanderia({
  valor,
  sugerido,
  disabled,
  onSave,
}: {
  valor: number
  sugerido: number
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
        {valor > 0 ? valor.toLocaleString("es-MX") : <span className="text-muted-foreground/50">—</span>}
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
        className="ml-auto h-7 w-24 text-right"
      />
    )
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {valor === 0 && sugerido > 0 && (
        <button
          type="button"
          onClick={() => onSave(sugerido)}
          title={`Usar las ${sugerido} piezas recibidas del maquilero`}
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-sky-300 hover:text-sky-700"
        >
          usar {sugerido.toLocaleString("es-MX")}
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditando(true)}
        className={cn(
          "rounded px-1.5 py-0.5 text-sm tabular-nums transition-colors hover:bg-muted",
          valor > 0 ? "font-medium text-foreground" : "text-muted-foreground/60",
        )}
      >
        {valor > 0 ? valor.toLocaleString("es-MX") : "—"}
      </button>
    </div>
  )
}

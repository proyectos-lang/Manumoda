"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CircleDollarSign,
  Clock,
  DollarSign,
  Info,
  Loader2,
  PackageCheck,
  Pencil,
  Settings2,
  Trash2,
} from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { fmtCurrency } from "@/lib/format"
import { parseLocalDate } from "@/lib/risk"
import { cn } from "@/lib/utils"
import type {
  CatPenalizacionMaquila,
  MaquilaPago,
  MaquilaPenalizacionFija,
  MaquilaRecepcion,
  ServicioExterno,
  VwPagoMaquilas,
  VwServicioPago,
} from "@/lib/types"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ─── Constantes compartidas con el módulo ────────────────────────────────────

const CENTAVO = 0.005
const DEMORA_SEMANAL_PCT = 1.5
const DEMORA_PLAZO_DIAS = 45

const METODOS_PAGO = ["Transferencia", "Efectivo", "Cheque", "Otro"] as const

const SERVICIOS_EXTERNOS: ServicioExterno[] = [
  "Lavandería",
  "Estampado",
  "Bordado",
  "Corte Externo",
  "Otro",
]

/** Dónde vive el costo unitario de cada proceso en `ordenes_produccion`. */
const COLUMNA_COSTO: Record<ServicioExterno, string> = {
  "Lavandería": "costo_lavanderia",
  Estampado: "costo_estampado",
  Bordado: "costo_bordado",
  "Corte Externo": "costo_corte_externo",
  Otro: "costo_otro",
}

const COSTO_DEL_SERVICIO: Record<ServicioExterno, (r: VwPagoMaquilas) => number | null> = {
  "Lavandería": (r) => r.costo_lavanderia,
  Estampado: (r) => r.costo_estampado,
  Bordado: (r) => r.costo_bordado,
  "Corte Externo": (r) => r.costo_corte_externo,
  Otro: (r) => r.costo_otro,
}

const num = (v: unknown) => Number(v ?? 0)
const hoyISO = () => format(new Date(), "yyyy-MM-dd")

function fmtFecha(iso: string | null | undefined) {
  const d = parseLocalDate(iso)
  return d ? format(d, "dd/MMM/yyyy") : "—"
}

const ESTADO_STYLE: Record<string, string> = {
  Saldado: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  Parcial: "bg-sky-100 text-sky-700 ring-sky-200",
  Pendiente: "bg-amber-100 text-amber-700 ring-amber-200",
  Sobrepagado: "bg-rose-100 text-rose-700 ring-rose-200",
  "Sin costo": "bg-amber-100 text-amber-700 ring-amber-200",
  "Sin recepción": "bg-slate-100 text-slate-600 ring-slate-200",
  Anticipo: "bg-violet-100 text-violet-700 ring-violet-200",
}

// ─── Vista de detalle ────────────────────────────────────────────────────────

/**
 * La gestión de un folio, de punta a punta, en una sola pantalla.
 *
 * El orden de los bloques es el del proceso, no el del cálculo: primero se
 * cuadran las piezas, luego lo que se descuenta, luego el dinero. Discutir
 * el importe antes de saber sobre cuántas piezas salió no lleva a ningún
 * lado.
 */
export function PagoMaquilaDetalle({
  row,
  servicios,
  onVolver,
  onSaved,
}: {
  row: VwPagoMaquilas
  servicios: VwServicioPago[]
  onVolver: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const readOnly = useReadOnly()

  const [recepciones, setRecepciones] = useState<MaquilaRecepcion[]>([])
  const [pagos, setPagos] = useState<MaquilaPago[]>([])
  const [catPenal, setCatPenal] = useState<CatPenalizacionMaquila[]>([])
  const [penalFijas, setPenalFijas] = useState<MaquilaPenalizacionFija[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const porFolio = (t: string) =>
      supabase.from(t).select("*").eq("idempresa", IDEMPRESA).eq("folio", row.folio).order("fecha")
    const [r, g, cat, pf] = await Promise.all([
      porFolio("maquila_recepciones"),
      porFolio("maquila_pagos"),
      supabase
        .from("cat_penalizaciones_maquila")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("activo", true)
        .order("orden"),
      supabase
        .from("maquila_penalizaciones_fijas")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", row.folio),
    ])
    setRecepciones((r.data as MaquilaRecepcion[]) ?? [])
    setPagos((g.data as MaquilaPago[]) ?? [])
    setCatPenal((cat.data as CatPenalizacionMaquila[]) ?? [])
    setPenalFijas((pf.data as MaquilaPenalizacionFija[]) ?? [])
    setCargando(false)
  }, [row.folio])

  useEffect(() => {
    cargar()
  }, [cargar])

  const refrescar = () => {
    cargar()
    onSaved()
  }

  // ── Escrituras ────────────────────────────────────────────────────────────

  const registrarEntrega = async (fecha: string, piezas: number) => {
    const supabase = getSupabase()
    if (!supabase) return false
    const { error } = await supabase.from("maquila_recepciones").insert({
      idempresa: IDEMPRESA,
      folio: row.folio,
      capturado_por: user?.username ?? null,
      fecha,
      piezas,
    })
    if (error) {
      toast.error("No se pudo registrar la entrega", { description: error.message })
      return false
    }
    toast.success(`Entrega de ${piezas.toLocaleString("es-MX")} pzs registrada`)
    refrescar()
    return true
  }

  const borrarFila = async (tabla: string, id: number, etiqueta: string) => {
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

  const registrarPago = async (p: {
    fecha: string
    monto: number
    metodo: string
    referencia: string | null
    comentarios: string | null
    esAdelanto: boolean
  }) => {
    const supabase = getSupabase()
    if (!supabase) return false
    const { error } = await supabase.from("maquila_pagos").insert({
      idempresa: IDEMPRESA,
      folio: row.folio,
      capturado_por: user?.username ?? null,
      fecha: p.fecha,
      monto: p.monto,
      referencia: p.referencia,
      comentarios: [p.metodo, p.comentarios].filter(Boolean).join(" · ") || null,
      costo_maquila_aplicado: row.costo_maquila,
      es_adelanto: p.esAdelanto,
    })
    if (error) {
      toast.error("No se pudo registrar el pago", { description: error.message })
      return false
    }
    toast.success(`Pago de ${fmtCurrency(p.monto)} registrado`)
    refrescar()
    return true
  }

  /** Actualiza una columna de la orden. Todo el costeo se deriva de ellas. */
  const guardarEnOrden = async (
    campo: string,
    valor: number | null,
    exito: string,
  ) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ [campo]: valor })
      .eq("folio", row.folio)
      .eq("idempresa", IDEMPRESA)
    if (error) {
      toast.error("No se pudo guardar", { description: error.message })
      return
    }
    toast.success(exito)
    refrescar()
  }

  /** Marcar o desmarcar un concepto: la fila existe = la penalización aplica. */
  const togglePenalizacion = async (cat: CatPenalizacionMaquila, aplicar: boolean) => {
    const supabase = getSupabase()
    if (!supabase) return
    const existente = penalFijas.find((p) => p.idpenalizacion === cat.id)

    if (aplicar && !existente) {
      const { error } = await supabase.from("maquila_penalizaciones_fijas").insert({
        idempresa: IDEMPRESA,
        folio: row.folio,
        idpenalizacion: cat.id,
        // Se congela el monto vigente: subirlo después no reescribe este folio
        monto_aplicado: cat.monto,
        capturado_por: user?.username ?? null,
      })
      if (error) {
        toast.error("No se pudo aplicar la penalización", { description: error.message })
        return
      }
      toast.success(`${cat.nombre} · −${fmtCurrency(Number(cat.monto))}`)
    } else if (!aplicar && existente) {
      const { error } = await supabase
        .from("maquila_penalizaciones_fijas")
        .delete()
        .eq("id", existente.id)
        .eq("idempresa", IDEMPRESA)
      if (error) {
        toast.error("No se pudo quitar la penalización", { description: error.message })
        return
      }
      toast.success(`${cat.nombre} ya no aplica`)
    }
    refrescar()
  }

  // ── Derivados ─────────────────────────────────────────────────────────────

  const recibidas = row.piezas_recibidas
  const saldo = num(row.saldo)
  const saldoPendiente = Math.max(0, saldo)

  const procesos = useMemo(() => {
    const filaDe = (s: ServicioExterno) => servicios.find((x) => x.servicio === s) ?? null
    const lista: {
      nombre: string
      unitario: number | null
      piezas: number
      subtotal: number
      campo: string
    }[] = [
      {
        nombre: "Maquila (Confección)",
        unitario: row.costo_maquila,
        piezas: recibidas,
        subtotal: recibidas * num(row.costo_maquila),
        campo: "costo_maquila",
      },
    ]
    // Los cinco procesos se listan SIEMPRE, tengan costo o no: un renglón
    // vacío es lo que permite capturar el costo que falta.
    for (const s of SERVICIOS_EXTERNOS) {
      const unitario = COSTO_DEL_SERVICIO[s](row)
      const fila = filaDe(s)
      const piezas = fila?.piezas_procesadas ?? recibidas
      lista.push({
        nombre: s,
        unitario,
        piezas,
        subtotal: fila ? num(fila.valor) : piezas * num(unitario),
        campo: COLUMNA_COSTO[s],
      })
    }
    return lista
  }, [row, servicios, recibidas])

  if (cargando) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Encabezado ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">
          Pago de Maquilas
        </h2>
        <Button variant="outline" onClick={onVolver} className="gap-1.5">
          <ArrowLeft className="size-4" />
          Volver al listado
        </Button>
      </div>

      <div className="grid gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <DatoCabecera etiqueta="Orden" valor={row.folio} mono />
        <DatoCabecera etiqueta="Maquilero" valor={row.beneficiario ?? "Sin asignar"} />
        <DatoCabecera etiqueta="Fecha orden" valor={fmtFecha(row.fecha_pedido)} />
        <DatoCabecera etiqueta="Límite de entrega (cliente)" valor={fmtFecha(row.fecha_cancelacion)} />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Estatus</p>
          <span
            className={cn(
              "mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ring-inset",
              ESTADO_STYLE[row.estado_pago] ?? "bg-slate-100 text-slate-600 ring-slate-200",
            )}
          >
            {row.estado_pago}
          </span>
        </div>
      </div>

      {/* ── 1. Relación de entrega ── */}
      <Bloque numero={1} titulo="Relación de entrega" icono={<Boxes className="size-4" />}>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta>
            <Renglon etiqueta="Orden original" valor={`${(row.piezas_orden ?? 0).toLocaleString("es-MX")} pzs`} />
            <Renglon
              etiqueta="Piezas cortadas"
              valor={`${row.piezas_cortadas.toLocaleString("es-MX")} pzs`}
            />
            <Renglon
              etiqueta="Piezas recibidas"
              valor={`${recibidas.toLocaleString("es-MX")} pzs`}
              tono="text-emerald-600 font-semibold"
            />
            <Renglon
              etiqueta="Piezas no entregadas"
              valor={`${row.piezas_no_entregadas.toLocaleString("es-MX")} pzs`}
              tono={row.piezas_no_entregadas > 0 ? "text-rose-600 font-semibold" : undefined}
            />
          </Tarjeta>

          <PanelEntregas
            recepciones={recepciones}
            row={row}
            readOnly={readOnly}
            onRegistrar={registrarEntrega}
            onBorrar={(id) => borrarFila("maquila_recepciones", id, "La entrega")}
          />

          <PanelNoEntregadas row={row} />

          <Tarjeta>
            <Renglon etiqueta="Arranque de maquila (S1)" valor={fmtFecha(row.fecha_s1)} negrita />
            <Renglon
              etiqueta={`Plazo (S1 + ${DEMORA_PLAZO_DIAS} días)`}
              valor={fmtFecha(row.fecha_limite_maquilero)}
              negrita
              tono={row.semanas_demora > 0 ? "text-rose-600" : undefined}
            />
            <Renglon
              etiqueta="Entrega real (última parcialidad)"
              valor={
                row.sin_entrega ? "Sin entregar" : fmtFecha(row.fecha_entrega_maquilero)
              }
              negrita
              tono={row.sin_entrega ? "text-rose-600" : undefined}
            />
            {row.entrega_corregida && (
              <Renglon
                etiqueta="Corregida a mano"
                valor={fmtFecha(row.fecha_entrega_corregida)}
                tono="text-amber-600"
              />
            )}
            <Renglon
              etiqueta="Según el Excel (S5)"
              valor={fmtFecha(row.fecha_entrega_s5)}
              tono="text-muted-foreground/70"
            />
          </Tarjeta>
        </div>
      </Bloque>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 2. Penalizaciones ── */}
        <Bloque
          numero={2}
          titulo="Penalizaciones"
          icono={<AlertTriangle className="size-4" />}
          tono="rose"
        >
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 text-xs font-semibold">Penalización</TableHead>
                <TableHead className="h-9 text-xs font-semibold">Tipo</TableHead>
                <TableHead className="h-9 text-center text-xs font-semibold">Aplica</TableHead>
                <TableHead className="h-9 text-right text-xs font-semibold">Descuento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <FilaPenalAutomatica
                nombre="Entrega fuera de tiempo"
                aplica={num(row.valor_demora) > 0}
                descuento={num(row.valor_demora)}
                detalle={
                  row.semanas_demora > 0
                    ? `${row.semanas_demora} sem × ${DEMORA_SEMANAL_PCT}%${
                        row.sin_entrega ? " · sigue corriendo, no ha entregado" : ""
                      }`
                    : row.fecha_s1
                      ? "dentro del plazo"
                      : "sin S1, no corre plazo"
                }
              />
              <FilaPenalAutomatica
                nombre="Piezas no entregadas"
                aplica={num(row.valor_no_entregadas) > 0}
                descuento={num(row.valor_no_entregadas)}
                detalle={
                  row.precio_venta == null
                    ? "sin precio de venta"
                    : `${row.piezas_no_entregadas} × ${fmtCurrency(num(row.precio_venta))}`
                }
              />
              <FilaPenalAutomatica
                nombre="Entrega en más de 3 parcialidades"
                aplica={num(row.valor_parcialidades) > 0}
                descuento={num(row.valor_parcialidades)}
                detalle={
                  row.parcialidades === 0
                    ? "sin entregas registradas"
                    : row.parcialidades_excedentes > 0
                      ? `${row.parcialidades} entregas − 3 = ${row.parcialidades_excedentes} × ${fmtCurrency(num(row.monto_parcialidad))}`
                      : `${row.parcialidades} ${row.parcialidades === 1 ? "entrega" : "entregas"}, dentro de las 3`
                }
              />

              {catPenal.map((c) => {
                const marcada = penalFijas.find((p) => p.idpenalizacion === c.id)
                return (
                  <TableRow key={c.id} className="hover:bg-muted/20">
                    <TableCell className="py-2 text-sm">{c.nombre}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      Manual (check)
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Checkbox
                        checked={Boolean(marcada)}
                        disabled={readOnly}
                        onCheckedChange={(v) => togglePenalizacion(c, v === true)}
                        aria-label={c.nombre}
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2 text-right text-sm tabular-nums",
                        marcada ? "font-medium text-rose-600" : "text-muted-foreground/60",
                      )}
                    >
                      −{fmtCurrency(Number(marcada?.monto_aplicado ?? c.monto))}
                    </TableCell>
                  </TableRow>
                )
              })}

              <TableRow className="border-t border-border hover:bg-muted/20">
                <TableCell className="py-2 text-sm">
                  Penalización negociada
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    lo acordado con el maquilero
                  </span>
                </TableCell>
                <TableCell className="py-2 text-xs text-muted-foreground">Manual</TableCell>
                <TableCell className="py-2 text-center">
                  <span
                    className={cn(
                      "inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold",
                      row.penalizacion_es_negociada
                        ? "border-violet-300 bg-violet-50 text-violet-700"
                        : "border-border text-muted-foreground/50",
                    )}
                  >
                    {row.penalizacion_es_negociada ? "SÍ" : "NO"}
                  </span>
                </TableCell>
                <TableCell className="py-2 text-right text-sm">
                  <CostoEditable
                    valor={row.penalizacion_negociada}
                    disabled={readOnly}
                    vacio="Sin negociar"
                    onSave={(v) =>
                      guardarEnOrden(
                        "penalizacion_negociada",
                        v,
                        v == null
                          ? "Vuelve a aplicarse lo calculado"
                          : `Penalización negociada en ${fmtCurrency(v)}`,
                      )
                    }
                  />
                </TableCell>
              </TableRow>

              {row.penalizacion_es_negociada && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-1.5 text-right text-xs text-muted-foreground">
                    Por regla salían {fmtCurrency(num(row.valor_penalizaciones_calculado))}; manda
                    lo negociado.
                  </TableCell>
                </TableRow>
              )}

              <TableRow className="border-t-2 border-border bg-rose-50/60 hover:bg-rose-50/60">
                <TableCell colSpan={3} className="py-2 text-sm font-bold uppercase text-rose-700">
                  Total penalizaciones
                </TableCell>
                <TableCell className="py-2 text-right text-base font-bold tabular-nums text-rose-700">
                  {num(row.valor_penalizaciones) > 0
                    ? `−${fmtCurrency(num(row.valor_penalizaciones))}`
                    : fmtCurrency(0)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
          <p className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Las automáticas se calculan solas. Las manuales congelan su monto al marcarlas:
            cambiar el catálogo después no reescribe este folio.
          </p>
        </Bloque>

        {/* ── 3. Resumen financiero ── */}
        <div className="space-y-4">
          <Bloque
            numero={3}
            titulo="Resumen financiero"
            icono={<CircleDollarSign className="size-4" />}
          >
            <div className="space-y-2 p-4">
              <LineaTotal
                etiqueta="Costo generado (de procesos)"
                valor={row.costo_capturado ? fmtCurrency(num(row.costo_final)) : "Sin costo"}
                tono={row.costo_capturado ? "text-foreground" : "text-amber-600"}
              />
              <LineaTotal
                etiqueta="(−) Total penalizaciones"
                valor={
                  num(row.valor_penalizaciones) > 0
                    ? `−${fmtCurrency(num(row.valor_penalizaciones))}`
                    : fmtCurrency(0)
                }
                tono={num(row.valor_penalizaciones) > 0 ? "text-rose-600" : "text-muted-foreground"}
              />
              <div className="rounded-lg bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-200">
                <LineaTotal
                  etiqueta="Total autorizado a pagar"
                  valor={row.costo_capturado ? fmtCurrency(num(row.valor_a_pagar)) : "—"}
                  tono="text-emerald-700"
                  destacado
                />
              </div>
              <LineaTotal
                etiqueta="Pagado"
                valor={fmtCurrency(num(row.valor_pagado))}
                tono="text-emerald-700"
              />
              <div className="rounded-lg bg-sky-50 px-3 py-2.5 ring-1 ring-inset ring-sky-200">
                <LineaTotal
                  etiqueta="Saldo por pagar"
                  valor={row.costo_capturado ? fmtCurrency(saldo) : "—"}
                  tono={saldo < -CENTAVO ? "text-rose-600" : "text-sky-800"}
                  destacado
                />
              </div>
            </div>
          </Bloque>

          {/* ── 5. Registrar pago ── */}
          <Bloque numero={5} titulo="Registrar pago" icono={<DollarSign className="size-4" />}>
            <FormularioPago
              saldoPendiente={saldoPendiente}
              recibidas={recibidas}
              readOnly={readOnly}
              onRegistrar={registrarPago}
            />
          </Bloque>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 4. Costo por proceso ── */}
        <Bloque numero={4} titulo="Costo por proceso" icono={<Settings2 className="size-4" />}>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 text-xs font-semibold">Proceso</TableHead>
                <TableHead className="h-9 text-right text-xs font-semibold">Costo unitario</TableHead>
                <TableHead className="h-9 text-right text-xs font-semibold">Piezas</TableHead>
                <TableHead className="h-9 text-right text-xs font-semibold">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {procesos.map((p) => (
                <TableRow
                  key={p.nombre}
                  className={cn("hover:bg-muted/20", p.unitario == null && "opacity-60")}
                >
                  <TableCell className="py-2 text-sm font-medium">{p.nombre}</TableCell>
                  <TableCell className="py-2 text-right text-sm">
                    <CostoEditable
                      valor={p.unitario}
                      disabled={readOnly}
                      onSave={(v) =>
                        guardarEnOrden(
                          p.campo,
                          v,
                          v == null ? `${p.nombre} ya no aplica` : `Costo de ${p.nombre} guardado`,
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="py-2 text-right text-sm tabular-nums text-muted-foreground">
                    {p.piezas.toLocaleString("es-MX")} pzs
                  </TableCell>
                  <TableCell className="py-2 text-right text-sm font-medium tabular-nums">
                    {fmtCurrency(p.subtotal)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-border bg-sky-50/60 hover:bg-sky-50/60">
                <TableCell colSpan={3} className="py-2 text-sm font-bold uppercase text-sky-800">
                  Total costo generado
                </TableCell>
                <TableCell className="py-2 text-right text-base font-bold tabular-nums text-sky-800">
                  {fmtCurrency(num(row.costo_final))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            La maquila va sobre las piezas recibidas; cada servicio, sobre las que ese proceso
            trabajó. Clic sobre un costo para cambiarlo; dejarlo vacío hace que ese proceso
            deje de aplicar.
          </p>
        </Bloque>

        {/* ── 6. Historial de pagos ── */}
        <Bloque numero={6} titulo="Historial de pagos" icono={<Clock className="size-4" />}>
          {pagos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Sin pagos registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 text-xs font-semibold">Fecha</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Monto</TableHead>
                  <TableHead className="h-9 text-xs font-semibold">Referencia</TableHead>
                  <TableHead className="h-9 text-xs font-semibold">Observaciones</TableHead>
                  <TableHead className="h-9 w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagos.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/20">
                    <TableCell className="py-2 text-sm tabular-nums">{fmtFecha(p.fecha)}</TableCell>
                    <TableCell className="py-2 text-right text-sm font-medium tabular-nums">
                      {fmtCurrency(num(p.monto))}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {p.referencia ?? "—"}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {p.es_adelanto && (
                        <span className="mr-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                          Adelanto
                        </span>
                      )}
                      {p.comentarios ?? "—"}
                    </TableCell>
                    <TableCell className="py-2">
                      {!readOnly && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive/50 hover:text-destructive"
                          onClick={() => borrarFila("maquila_pagos", p.id, "El pago")}
                          title="Eliminar pago"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </Bloque>
      </div>

      {/* ── Aviso de sobrepago / adelanto ── */}
      {(saldo < -CENTAVO || (num(row.valor_pagado) > 0 && recibidas === 0)) && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm",
            saldo < -CENTAVO
              ? "border-rose-300 bg-rose-50 text-rose-800"
              : "border-violet-300 bg-violet-50 text-violet-800",
          )}
        >
          <Info className="size-4 shrink-0" />
          {recibidas === 0 ? (
            <span>
              <strong>Pago adelantado (sin recibir).</strong> Todavía no hay entregas
              registradas en este folio.
            </span>
          ) : (
            <span>
              <strong>Sobrepagado en {fmtCurrency(Math.abs(saldo))}.</strong> Se le pagó más de
              lo autorizado; márcalo como adelanto si fue deliberado.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Piezas del layout ───────────────────────────────────────────────────────

function Bloque({
  numero,
  titulo,
  icono,
  tono = "sky",
  children,
}: {
  numero: number
  titulo: string
  icono: React.ReactNode
  tono?: "sky" | "rose"
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className={cn(tono === "rose" ? "text-rose-600" : "text-sky-600")}>{icono}</span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
          {numero}. {titulo}
        </h3>
      </div>
      {children}
    </section>
  )
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5 rounded-lg border border-border p-4">{children}</div>
}

function Renglon({
  etiqueta,
  valor,
  tono,
  negrita,
}: {
  etiqueta: string
  valor: string
  tono?: string
  negrita?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className={cn("shrink-0 tabular-nums", negrita && "font-semibold", tono)}>{valor}</span>
    </div>
  )
}

function DatoCabecera({
  etiqueta,
  valor,
  mono,
}: {
  etiqueta: string
  valor: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      <p className={cn("mt-0.5 truncate text-sm font-semibold text-foreground", mono && "font-mono")}>
        {valor}
      </p>
    </div>
  )
}

function LineaTotal({
  etiqueta,
  valor,
  tono,
  destacado,
}: {
  etiqueta: string
  valor: string
  tono?: string
  destacado?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={cn(
          destacado
            ? "text-sm font-bold uppercase tracking-wide"
            : "text-sm text-muted-foreground",
          destacado && tono,
        )}
      >
        {etiqueta}
      </span>
      <span className={cn("shrink-0 tabular-nums", destacado ? "text-xl font-bold" : "text-base font-medium", tono)}>
        {valor}
      </span>
    </div>
  )
}

function FilaPenalAutomatica({
  nombre,
  aplica,
  descuento,
  detalle,
}: {
  nombre: string
  aplica: boolean
  descuento: number
  detalle: string
}) {
  return (
    <TableRow className="hover:bg-muted/20">
      <TableCell className="py-2 text-sm">
        {nombre}
        <span className="ml-1.5 text-xs text-muted-foreground">{detalle}</span>
      </TableCell>
      <TableCell className="py-2 text-xs text-muted-foreground">Automática</TableCell>
      <TableCell className="py-2 text-center">
        <span
          className={cn(
            "inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold",
            aplica
              ? "border-rose-300 bg-rose-50 text-rose-600"
              : "border-border text-muted-foreground/50",
          )}
        >
          {aplica ? "SÍ" : "NO"}
        </span>
      </TableCell>
      <TableCell
        className={cn(
          "py-2 text-right text-sm tabular-nums",
          aplica ? "font-medium text-rose-600" : "text-muted-foreground/60",
        )}
      >
        {aplica ? `−${fmtCurrency(descuento)}` : "—"}
      </TableCell>
    </TableRow>
  )
}

/**
 * Importe editable en línea. Vacío guarda null, que cada campo interpreta:
 * un proceso deja de aplicar, una negociación vuelve a lo calculado.
 */
function CostoEditable({
  valor,
  disabled,
  onSave,
  vacio = "Sin costo",
}: {
  valor: number | null
  disabled: boolean
  onSave: (v: number | null) => void
  vacio?: string
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(valor == null ? "" : String(valor))

  useEffect(() => {
    if (!editando) setTexto(valor == null ? "" : String(valor))
  }, [valor, editando])

  const confirmar = () => {
    setEditando(false)
    const t = texto.trim()
    const n = t === "" ? null : Number(t)
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setTexto(valor == null ? "" : String(valor))
      return
    }
    if (n !== valor) onSave(n)
  }

  if (disabled) {
    return (
      <span className={cn("tabular-nums", valor == null && "text-amber-600")}>
        {valor == null ? vacio : fmtCurrency(Number(valor))}
      </span>
    )
  }

  if (editando) {
    return (
      <Input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmar()
          if (e.key === "Escape") {
            setTexto(valor == null ? "" : String(valor))
            setEditando(false)
          }
        }}
        className="ml-auto h-8 w-28 text-right text-sm"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      title="Clic para editar · vacío lo deja sin aplicar"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 tabular-nums transition-colors hover:bg-muted",
        valor == null ? "text-amber-600" : "font-medium text-foreground",
      )}
    >
      {valor == null ? vacio : fmtCurrency(Number(valor))}
      <Pencil className="size-3 text-muted-foreground/50" />
    </button>
  )
}

// ─── Panel de entregas ───────────────────────────────────────────────────────

function PanelEntregas({
  recepciones,
  row,
  readOnly,
  onRegistrar,
  onBorrar,
}: {
  recepciones: MaquilaRecepcion[]
  row: VwPagoMaquilas
  readOnly: boolean
  onRegistrar: (fecha: string, piezas: number) => Promise<boolean>
  onBorrar: (id: number) => void
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
    const ok = await onRegistrar(fecha, Math.trunc(n))
    setGuardando(false)
    if (ok) setPiezas("")
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-foreground">
          Entregas recibidas
        </p>
        <p className="text-xs font-medium tabular-nums text-muted-foreground">
          {row.piezas_recibidas.toLocaleString("es-MX")} de{" "}
          {base > 0 ? base.toLocaleString("es-MX") : "?"} pzs
        </p>
      </div>

      {/* A partir de la cuarta, cada entrega cuesta dinero: conviene saberlo
          ANTES de registrar una más, no al ver el total. */}
      {recepciones.length >= 3 && (
        <p
          className={cn(
            "border-b border-border px-3 py-1.5 text-[11px] font-medium",
            row.parcialidades_excedentes > 0
              ? "bg-rose-50 text-rose-700"
              : "bg-amber-50 text-amber-700",
          )}
        >
          {row.parcialidades_excedentes > 0
            ? `${row.parcialidades} parcialidades · ${row.parcialidades_excedentes} de más × ${fmtCurrency(num(row.monto_parcialidad))} = ${fmtCurrency(num(row.valor_parcialidades))} de penalización`
            : `Van 3 parcialidades. La siguiente penaliza ${fmtCurrency(num(row.monto_parcialidad))}.`}
        </p>
      )}

      <div className="max-h-40 divide-y divide-border/60 overflow-y-auto">
        {recepciones.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            Sin entregas registradas
          </p>
        ) : (
          recepciones.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2">
              <PackageCheck className="size-4 shrink-0 text-emerald-600" />
              <span className="text-sm tabular-nums">{fmtFecha(r.fecha)}</span>
              <span className="ml-auto text-sm font-medium tabular-nums">
                {r.piezas.toLocaleString("es-MX")} pzs
              </span>
              {!readOnly && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-destructive/50 hover:text-destructive"
                  onClick={() => onBorrar(r.id)}
                  title="Eliminar entrega"
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {!readOnly && (
        <div className="space-y-2 border-t border-border bg-muted/20 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Registrar nueva entrega
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Fecha</label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Piezas</label>
              <Input
                type="number"
                min="1"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
                placeholder="0"
                className="h-9 w-24"
              />
            </div>
            <Button
              size="sm"
              onClick={enviar}
              disabled={!valido || guardando}
              className="h-9 gap-1.5 bg-sky-700 text-white hover:bg-sky-800"
            >
              {guardando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PackageCheck className="size-3.5" />
              )}
              Registrar entrega
            </Button>
          </div>
          {excede && (
            <p className="text-xs font-medium text-amber-600">
              Se supera lo cortado ({base.toLocaleString("es-MX")} pzs).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Las piezas no entregadas se derivan de `orden − recibidas`.
 *
 * De solo lectura a propósito: si además se pudieran capturar a mano, esas
 * piezas se descontarían dos veces contra el cálculo automático.
 */
function PanelNoEntregadas({ row }: { row: VwPagoMaquilas }) {
  const sinPrecio = row.precio_venta == null
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-foreground">
          Piezas no entregadas
        </p>
        <p
          className={cn(
            "text-sm font-bold tabular-nums",
            row.piezas_no_entregadas > 0 ? "text-rose-600" : "text-muted-foreground",
          )}
        >
          {row.piezas_no_entregadas.toLocaleString("es-MX")} pzs
        </p>
      </div>
      <div className="space-y-2 p-3">
        <Renglon
          etiqueta="Orden original"
          valor={(row.piezas_orden ?? 0).toLocaleString("es-MX")}
        />
        <Renglon etiqueta="(−) Recibidas" valor={row.piezas_recibidas.toLocaleString("es-MX")} />
        <div className="border-t border-border pt-2">
          <Renglon
            etiqueta="No entregadas"
            valor={`${row.piezas_no_entregadas.toLocaleString("es-MX")} pzs`}
            tono={row.piezas_no_entregadas > 0 ? "text-rose-600" : undefined}
            negrita
          />
        </div>
        {row.piezas_no_entregadas > 0 && (
          <div className="border-t border-border pt-2">
            <Renglon
              etiqueta={
                sinPrecio
                  ? "Descuento"
                  : `Descuento · ${row.piezas_no_entregadas} × ${fmtCurrency(num(row.precio_venta))}`
              }
              valor={
                sinPrecio ? "Sin precio de venta" : `−${fmtCurrency(num(row.valor_no_entregadas))}`
              }
              tono={sinPrecio ? "text-amber-600" : "text-rose-600"}
              negrita
            />
          </div>
        )}
        <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          Se calcula solo. Para corregirlo hay que registrar las entregas que falten.
        </p>
      </div>
    </div>
  )
}

// ─── Formulario de pago ──────────────────────────────────────────────────────

function FormularioPago({
  saldoPendiente,
  recibidas,
  readOnly,
  onRegistrar,
}: {
  saldoPendiente: number
  recibidas: number
  readOnly: boolean
  onRegistrar: (p: {
    fecha: string
    monto: number
    metodo: string
    referencia: string | null
    comentarios: string | null
    esAdelanto: boolean
  }) => Promise<boolean>
}) {
  const [monto, setMonto] = useState(saldoPendiente > 0 ? saldoPendiente.toFixed(2) : "")
  const [metodo, setMetodo] = useState<string>("Transferencia")
  const [fecha, setFecha] = useState(hoyISO())
  const [referencia, setReferencia] = useState("")
  const [comentarios, setComentarios] = useState("")
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setMonto(saldoPendiente > 0 ? saldoPendiente.toFixed(2) : "")
  }, [saldoPendiente])

  const m = Number(monto)
  const valido = Number.isFinite(m) && m > 0
  // Sin entregas registradas, cualquier pago es por definición un adelanto
  const esAdelanto = recibidas === 0
  const excede = valido && m > saldoPendiente + CENTAVO

  const enviar = async () => {
    setGuardando(true)
    const ok = await onRegistrar({
      fecha,
      monto: m,
      metodo,
      referencia: referencia.trim() || null,
      comentarios: comentarios.trim() || null,
      esAdelanto,
    })
    setGuardando(false)
    if (ok) {
      setReferencia("")
      setComentarios("")
    }
  }

  if (readOnly) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        Tu usuario es de solo lectura.
      </p>
    )
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Monto a pagar</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="h-9 pl-6 text-right tabular-nums"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Método de pago</label>
          <Select value={metodo} onValueChange={setMetodo}>
            <SelectTrigger className="h-9 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METODOS_PAGO.map((x) => (
                <SelectItem key={x} value={x}>
                  {x}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Fecha de pago</label>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="Referencia, cheque, etc."
          className="h-9"
        />
        <Input
          value={comentarios}
          onChange={(e) => setComentarios(e.target.value)}
          placeholder="Observaciones (opcional)"
          className="h-9"
        />
      </div>

      {excede && (
        <p className="text-xs font-medium text-amber-600">
          Excede el saldo en {fmtCurrency(m - saldoPendiente)}. Quedará como sobrepago.
        </p>
      )}
      {esAdelanto && (
        <p className="text-xs font-medium text-violet-600">
          Sin entregas registradas: se guardará como pago adelantado.
        </p>
      )}

      <Button
        onClick={enviar}
        disabled={!valido || guardando}
        className="w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
      >
        {guardando ? <Loader2 className="size-4 animate-spin" /> : <DollarSign className="size-4" />}
        Registrar pago
      </Button>
    </div>
  )
}

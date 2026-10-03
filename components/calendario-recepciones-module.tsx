"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, PackageCheck, Truck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { CronogramaDia, type EntregaDia } from "@/components/cronograma-dia"

/**
 * El calendario de recepciones de almacén.
 *
 * QUÉ RESUELVE:
 *   Almacén necesita saber cuántas entregas le caen cada día para
 *   repartir gente. Hasta ahora eso vivía disperso en las fechas de
 *   cada folio y había que sacarlo a mano.
 *
 * DOS CAPAS, NO UNA SUMA:
 *   · Programación — lo que de verdad pasa ese día en almacén: las
 *     ENTREGAS de los maquileros (día apartado) y los DESPACHOS al
 *     cliente (etapa 11). Van en la misma rejilla con distinto color,
 *     porque compiten por la misma gente y el mismo andén.
 *   · Límite   — la fecha tope pactada con el cliente. No es una
 *     entrega programada: es cuándo, a más tardar, debería estar.
 *
 *   Las capas se muestran por separado y NO se suman. Un folio puede
 *   tener las dos fechas, y sumarlas lo contaría dos veces; además
 *   significan cosas distintas —una es promesa del maquilero, la otra
 *   obligación con el cliente— y juntarlas daría un número que no
 *   responde a ninguna pregunta.
 *
 *   Dentro de la programación, entrega y despacho SÍ se cuentan por
 *   separado: un folio que entra por la mañana y sale por la tarde son
 *   dos movimientos de almacén, no uno.
 *
 * LO FACTURADO NO CUENTA:
 *   Ya se entregó y se cobró: mostrarlo como recepción pendiente haría
 *   planear trabajo que no existe.
 */

type OrdenCalendario = {
  folio: string
  cliente: string | null
  modelo: string | null
  piezas: number | null
  fase_actual: string | null
  maquilero: string | null
  fecha_apartada_entrega: string | null
  /** "HH:MM:SS". Solo la trae el apartado, no el límite. */
  hora_apartada_entrega: string | null
  /** El despacho al cliente, etapa 11. Misma forma que el apartado. */
  fecha_despacho_cliente: string | null
  hora_despacho_cliente: string | null
  fecha_cancelacion: string | null
}

/**
 * Un movimiento del día. La misma orden puede aparecer dos veces el
 * mismo día —entra del maquilero y sale al cliente— y por eso el
 * movimiento, no la orden, es la unidad que se cuenta.
 */
type Movimiento = {
  orden: OrdenCalendario
  tipo: "entrega" | "despacho"
  hora: string | null
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** Lunes primero: es como se lee una semana de trabajo. */
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

/**
 * "aaaa-mm-dd" de una fecha local.
 *
 * Se arma a mano en vez de usar toISOString(): esa convierte a UTC y en
 * México devuelve el día anterior a partir de las 18:00.
 */
function claveDia(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dia = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${dia}`
}

/** Solo la parte de fecha, por si viene con hora. */
function soloFecha(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null
}

export function CalendarioRecepcionesModule({
  configMissing,
}: {
  configMissing: boolean
}) {
  const [ordenes, setOrdenes] = useState<OrdenCalendario[]>([])
  const [cargando, setCargando] = useState(false)
  const [mes, setMes] = useState(() => {
    const hoy = new Date()
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  })
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)
  /** Qué capa se está viendo. Las dos a la vez saturan el cuadro. */
  const [capa, setCapa] = useState<"programacion" | "limite">("programacion")

  const cargar = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const { data, error } = await fetchAll(() =>
      supabase
        .from("ordenes_produccion")
        .select(
          "folio, cliente, modelo, piezas, fase_actual, maquilero, fecha_apartada_entrega, hora_apartada_entrega, fecha_despacho_cliente, hora_despacho_cliente, fecha_cancelacion",
        )
        .eq("idempresa", IDEMPRESA)
        // Lo facturado ya se entregó: no es una recepción por venir.
        .is("fecha_facturacion", null),
    )
    if (error) {
      toast.error("No se pudo cargar el calendario", {
        description: error.message,
      })
    } else {
      setOrdenes((data ?? []) as OrdenCalendario[])
    }
    setCargando(false)
  }, [configMissing])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Los movimientos de cada día, por capa. */
  const porDia = useMemo(() => {
    const programacion = new Map<string, Movimiento[]>()
    const limite = new Map<string, Movimiento[]>()
    const meter = (mapa: Map<string, Movimiento[]>, dia: string, m: Movimiento) =>
      mapa.set(dia, [...(mapa.get(dia) ?? []), m])

    let entregas = 0
    let despachos = 0
    for (const o of ordenes) {
      const a = soloFecha(o.fecha_apartada_entrega)
      if (a) {
        meter(programacion, a, { orden: o, tipo: "entrega", hora: o.hora_apartada_entrega })
        entregas++
      }
      const d = soloFecha(o.fecha_despacho_cliente)
      if (d) {
        meter(programacion, d, { orden: o, tipo: "despacho", hora: o.hora_despacho_cliente })
        despachos++
      }
      const l = soloFecha(o.fecha_cancelacion)
      if (l) meter(limite, l, { orden: o, tipo: "entrega", hora: null })
    }
    return { programacion, limite, entregas, despachos }
  }, [ordenes])

  const mapaActivo = capa === "programacion" ? porDia.programacion : porDia.limite

  /**
   * Las celdas del mes, empezando en lunes.
   *
   * Se rellenan los huecos del principio y del final para que la
   * rejilla siempre tenga semanas completas: si no, los días bailan de
   * columna y cuesta leer "todos los martes".
   */
  const celdas = useMemo(() => {
    const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
    const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0)
    // getDay() da 0 para domingo; se corre para que lunes sea 0.
    const desplazamiento = (primero.getDay() + 6) % 7
    const out: { fecha: Date; delMes: boolean }[] = []
    for (let i = desplazamiento; i > 0; i--) {
      out.push({
        fecha: new Date(mes.getFullYear(), mes.getMonth(), 1 - i),
        delMes: false,
      })
    }
    for (let d = 1; d <= ultimo.getDate(); d++) {
      out.push({ fecha: new Date(mes.getFullYear(), mes.getMonth(), d), delMes: true })
    }
    while (out.length % 7 !== 0) {
      const sig = out.length - desplazamiento - ultimo.getDate() + 1
      out.push({
        fecha: new Date(mes.getFullYear(), mes.getMonth() + 1, sig),
        delMes: false,
      })
    }
    return out
  }, [mes])

  /** El total del mes visible, para el encabezado. */
  const totalMes = useMemo(() => {
    let entregas = 0
    let despachos = 0
    let piezas = 0
    for (const c of celdas) {
      if (!c.delMes) continue
      for (const m of mapaActivo.get(claveDia(c.fecha)) ?? []) {
        if (m.tipo === "despacho") despachos++
        else entregas++
        piezas += Number(m.orden.piezas ?? 0)
      }
    }
    return { entregas, despachos, piezas }
  }, [celdas, mapaActivo])

  const sinProgramacion = porDia.entregas === 0 && porDia.despachos === 0
  const hoy = claveDia(new Date())
  const detalle = diaAbierto ? (mapaActivo.get(diaAbierto) ?? []) : []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Calendario de recepciones
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cuántas entregas y despachos caen cada día, para repartir el
          trabajo de almacén. Haz clic en un día para ver qué folios son.
        </p>
      </div>

      {/* ── Qué capa se mira ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <Button
            size="sm"
            variant={capa === "programacion" ? "secondary" : "ghost"}
            className="h-7 text-xs"
            onClick={() => {
              setCapa("programacion")
              setDiaAbierto(null)
            }}
          >
            Programación del día
          </Button>
          <Button
            size="sm"
            variant={capa === "limite" ? "secondary" : "ghost"}
            className="h-7 text-xs"
            onClick={() => {
              setCapa("limite")
              setDiaAbierto(null)
            }}
          >
            Límite de entrega
          </Button>
        </div>

        {capa === "programacion" ? (
          /*
            La leyenda va junto al selector y no dentro de la rejilla:
            los dos colores aparecen en celdas distintas y sin la
            leyenda a la vista habria que adivinar cual es cual.
          */
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm bg-emerald-400" />
              Entrega del maquilero
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm bg-violet-400" />
              Despacho al cliente
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            La fecha tope pactada con el cliente, no una entrega programada.
          </p>
        )}
      </div>

      {/*
        Las dos capas NO se suman: un folio puede tener las dos fechas y
        sumarlas lo contaria dos veces. Ademas significan cosas
        distintas, y el numero resultante no responderia a nada.
      */}
      {capa === "programacion" && sinProgramacion && !cargando && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-900">
            Ninguna orden pendiente tiene apartado de entrega ni despacho
            programado. El apartado se registra en Seguimiento Maquila y el
            despacho en la etapa 11 del Panel General; mientras tanto, el{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => setCapa("limite")}
            >
              límite de entrega
            </button>{" "}
            da una idea de la carga.
          </p>
        </div>
      )}

      {/* ── Navegación del mes ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => {
              setMes((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
              setDiaAbierto(null)
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => {
              setMes((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
              setDiaAbierto(null)
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-semibold capitalize">
            {MESES[mes.getMonth()]} {mes.getFullYear()}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-1 h-7 text-xs"
            onClick={() => {
              const h = new Date()
              setMes(new Date(h.getFullYear(), h.getMonth(), 1))
              setDiaAbierto(null)
            }}
          >
            Hoy
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {cargando ? (
            <Skeleton className="h-4 w-32" />
          ) : capa === "programacion" ? (
            <>
              <span className="font-medium text-foreground">{totalMes.entregas}</span>{" "}
              {totalMes.entregas === 1 ? "entrega" : "entregas"} ·{" "}
              <span className="font-medium text-foreground">{totalMes.despachos}</span>{" "}
              {totalMes.despachos === 1 ? "despacho" : "despachos"} este mes ·{" "}
              {totalMes.piezas.toLocaleString("es-MX")} piezas
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{totalMes.entregas}</span>{" "}
              {totalMes.entregas === 1 ? "límite" : "límites"} este mes ·{" "}
              {totalMes.piezas.toLocaleString("es-MX")} piezas
            </>
          )}
        </p>
      </div>

      {/* ── La rejilla ── */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border bg-muted">
          {DIAS.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {celdas.map(({ fecha, delMes }, i) => {
            const clave = claveDia(fecha)
            const delDia = mapaActivo.get(clave) ?? []
            const entregas = delDia.filter((m) => m.tipo === "entrega").length
            const despachos = delDia.filter((m) => m.tipo === "despacho").length
            const esHoy = clave === hoy
            const abierto = clave === diaAbierto
            const piezas = delDia.reduce((s, m) => s + Number(m.orden.piezas ?? 0), 0)
            return (
              <button
                key={i}
                type="button"
                disabled={delDia.length === 0}
                onClick={() => setDiaAbierto(abierto ? null : clave)}
                className={cn(
                  "min-h-[84px] border-b border-r border-border p-1.5 text-left transition-colors",
                  // La última columna y la última fila no llevan borde doble
                  (i + 1) % 7 === 0 && "border-r-0",
                  !delMes && "bg-muted/30",
                  delDia.length > 0 && "hover:bg-muted/50",
                  delDia.length === 0 && "cursor-default",
                  abierto && "bg-sky-50 ring-1 ring-inset ring-sky-300",
                )}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      !delMes && "text-muted-foreground/40",
                      delMes && "text-muted-foreground",
                      esHoy &&
                        "inline-flex size-5 items-center justify-center rounded-full bg-foreground font-semibold text-background",
                    )}
                  >
                    {fecha.getDate()}
                  </span>
                </div>

                {delDia.length > 0 && (
                  <div className="mt-1">
                    {/*
                      Dos insignias y no una suma: entrada y salida son
                      trabajos distintos de almacen, y una sola cifra
                      esconderia que un dia es todo despachos.
                    */}
                    <div className="flex flex-wrap gap-1">
                      {entregas > 0 && (
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold",
                            capa === "programacion"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-sky-100 text-sky-800",
                          )}
                          title={
                            capa === "programacion"
                              ? `${entregas} entrega(s) de maquilero`
                              : `${entregas} límite(s) de entrega`
                          }
                        >
                          <PackageCheck className="size-3" />
                          {entregas}
                        </div>
                      )}
                      {despachos > 0 && (
                        <div
                          className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800"
                          title={`${despachos} despacho(s) al cliente`}
                        >
                          <Truck className="size-3" />
                          {despachos}
                        </div>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {piezas.toLocaleString("es-MX")} pzs
                    </p>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── El detalle del día ── */}
      {diaAbierto && detalle.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-3 py-2">
            <p className="text-sm font-semibold">
              {(() => {
                const [a, m, d] = diaAbierto.split("-")
                return `${d} de ${MESES[Number(m) - 1]} de ${a}`
              })()}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {detalle.length}{" "}
                {capa === "programacion"
                  ? detalle.length === 1 ? "movimiento" : "movimientos"
                  : detalle.length === 1 ? "límite" : "límites"}
              </span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setDiaAbierto(null)}
            >
              Cerrar
            </Button>
          </div>
          {/*
            En la capa de PROGRAMACION se muestra el cronograma: es la
            que trae hora y la que sirve para repartir el dia. Entregas
            y despachos van en la misma linea de tiempo, cada uno de su
            color, porque compiten por la misma gente.

            La capa de LIMITE no lleva hora —es una fecha tope pactada
            con el cliente, no una cita— asi que se queda en la tabla
            llana: un cronograma con todo "sin hora" no diria nada.
          */}
          {capa === "programacion" && (
            <div className="p-3">
              <CronogramaDia
                entregas={detalle.map(
                  (m): EntregaDia => ({
                    folio: m.orden.folio,
                    cliente: m.orden.cliente,
                    modelo: m.orden.modelo,
                    piezas: m.orden.piezas,
                    maquilero: m.orden.maquilero,
                    fase_actual: m.orden.fase_actual,
                    hora: m.hora,
                    tipo: m.tipo,
                  }),
                )}
              />
            </div>
          )}

          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {capa === "programacion" && (
                  <>
                    <th className="px-3 py-1.5 font-medium">Hora</th>
                    <th className="px-3 py-1.5 font-medium">Movimiento</th>
                  </>
                )}
                <th className="px-3 py-1.5 font-medium">Folio</th>
                <th className="px-3 py-1.5 font-medium">Cliente</th>
                <th className="px-3 py-1.5 font-medium">Modelo</th>
                <th className="px-3 py-1.5 font-medium">Maquilero</th>
                <th className="px-3 py-1.5 font-medium">Fase</th>
                <th className="px-3 py-1.5 text-right font-medium">Piezas</th>
              </tr>
            </thead>
            <tbody>
              {detalle.map((m) => (
                <tr key={`${m.tipo}-${m.orden.folio}`} className="border-t border-border">
                  {capa === "programacion" && (
                    <>
                      <td className="px-3 py-1.5 tabular-nums">
                        {m.hora ? (
                          m.hora.slice(0, 5)
                        ) : (
                          <span className="text-xs text-muted-foreground/60">
                            sin hora
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                            m.tipo === "despacho"
                              ? "bg-violet-100 text-violet-800"
                              : "bg-emerald-100 text-emerald-800",
                          )}
                        >
                          {m.tipo === "despacho" ? (
                            <>
                              <Truck className="size-3" /> Despacho
                            </>
                          ) : (
                            <>
                              <PackageCheck className="size-3" /> Entrega
                            </>
                          )}
                        </span>
                      </td>
                    </>
                  )}
                  <td className="px-3 py-1.5 font-medium tabular-nums">
                    {m.orden.folio}
                  </td>
                  <td className="px-3 py-1.5">{m.orden.cliente ?? "—"}</td>
                  <td className="px-3 py-1.5">{m.orden.modelo ?? "—"}</td>
                  <td className="px-3 py-1.5">{m.orden.maquilero ?? "—"}</td>
                  <td className="px-3 py-1.5">{m.orden.fase_actual ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {Number(m.orden.piezas ?? 0).toLocaleString("es-MX")}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/50">
              <tr>
                <td
                  colSpan={capa === "programacion" ? 7 : 5}
                  className="px-3 py-1.5 text-right font-semibold"
                >
                  Total
                </td>
                <td className="px-3 py-1.5 text-right font-bold tabular-nums">
                  {detalle
                    .reduce((s, m) => s + Number(m.orden.piezas ?? 0), 0)
                    .toLocaleString("es-MX")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {cargando && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Cargando órdenes…
        </p>
      )}
    </div>
  )
}

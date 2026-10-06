"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, PackageCheck, Truck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { CronogramaDia, type EntregaDia } from "@/components/cronograma-dia"
import { DistribucionDespacho } from "@/components/distribucion-despacho"

/**
 * El calendario de recepciones de almacén.
 *
 * QUÉ RESUELVE:
 *   Almacén necesita saber qué le cae cada día para repartir gente.
 *   Hasta ahora eso vivía disperso en las fechas de cada folio.
 *
 * TRES TIPOS DE MOVIMIENTO EN LA MISMA REJILLA:
 *   · Entrega   — el día que el maquilero apartó para entregar (verde).
 *   · Despacho  — el día programado para salir al cliente (morado).
 *   · Límite    — la fecha tope pactada con el cliente (azul). No es una
 *     cita: es cuándo, a más tardar, debería estar.
 *   Antes los límites iban en otra vista; se juntaron para ver de un
 *   vistazo si lo programado llega antes del límite (operación,
 *   06-oct-2026). Cada tipo se puede ocultar desde la leyenda.
 *
 *   Se muestran por separado y NO se suman. Un folio puede tener las
 *   tres fechas el mismo día, y sumarlas lo contaría tres veces; además
 *   significan cosas distintas, y un total mezclado no respondería a
 *   ninguna pregunta.
 *
 * EL EMPAQUE, AL HACER CLIC:
 *   En el detalle del día, hacer clic en un movimiento abre la
 *   distribución de cajas o bultos de ese folio (etapa 11). Se carga al
 *   abrirla, no con el calendario.
 *
 * LO FACTURADO NO CUENTA:
 *   Ya se entregó y se cobró: mostrarlo haría planear trabajo que no
 *   existe.
 */

type OrdenCalendario = {
  folio: string
  cliente: string | null
  modelo: string | null
  piezas: number | null
  fase_actual: string | null
  maquilero: string | null
  fecha_apartada_entrega: string | null
  hora_apartada_entrega: string | null
  fecha_despacho_cliente: string | null
  hora_despacho_cliente: string | null
  fecha_cancelacion: string | null
}

type Tipo = "entrega" | "despacho" | "limite"

/**
 * Un movimiento del día. La misma orden puede aparecer varias veces el
 * mismo día —entra, sale y vence— y por eso el movimiento, no la orden,
 * es la unidad que se cuenta.
 */
type Movimiento = {
  orden: OrdenCalendario
  tipo: Tipo
  hora: string | null
}

const TIPOS: { tipo: Tipo; nombre: string; plural: string; muestra: string; insignia: string; Icono: typeof Truck }[] = [
  { tipo: "entrega", nombre: "Entrega", plural: "Entregas del maquilero", muestra: "bg-emerald-400", insignia: "bg-emerald-100 text-emerald-800", Icono: PackageCheck },
  { tipo: "despacho", nombre: "Despacho", plural: "Despachos al cliente", muestra: "bg-violet-400", insignia: "bg-violet-100 text-violet-800", Icono: Truck },
  { tipo: "limite", nombre: "Límite", plural: "Límites de entrega", muestra: "bg-sky-400", insignia: "bg-sky-100 text-sky-800", Icono: CalendarClock },
]
const DE = Object.fromEntries(TIPOS.map((t) => [t.tipo, t])) as Record<Tipo, (typeof TIPOS)[number]>

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

const claveMov = (m: { tipo: Tipo; orden: { folio: string } }) => `${m.tipo}-${m.orden.folio}`

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
  /** Qué tipos se ven. Los tres de entrada. */
  const [visibles, setVisibles] = useState<Record<Tipo, boolean>>({
    entrega: true,
    despacho: true,
    limite: true,
  })
  /** El movimiento cuyo empaque está abierto. */
  const [abierto, setAbierto] = useState<string | null>(null)
  const folioAbierto = abierto ? abierto.slice(abierto.indexOf("-") + 1) : null

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
        // Lo facturado ya se entregó: no es un movimiento por venir.
        .is("fecha_facturacion", null),
    )
    if (error) {
      toast.error("No se pudo cargar el calendario", { description: error.message })
    } else {
      setOrdenes((data ?? []) as OrdenCalendario[])
    }
    setCargando(false)
  }, [configMissing])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Los movimientos de cada día, de los tipos visibles. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, Movimiento[]>()
    const meter = (dia: string | null, m: Movimiento) => {
      if (!dia || !visibles[m.tipo]) return
      mapa.set(dia, [...(mapa.get(dia) ?? []), m])
    }
    for (const o of ordenes) {
      meter(soloFecha(o.fecha_apartada_entrega), { orden: o, tipo: "entrega", hora: o.hora_apartada_entrega })
      meter(soloFecha(o.fecha_despacho_cliente), { orden: o, tipo: "despacho", hora: o.hora_despacho_cliente })
      meter(soloFecha(o.fecha_cancelacion), { orden: o, tipo: "limite", hora: null })
    }
    return mapa
  }, [ordenes, visibles])

  /**
   * Las celdas del mes, empezando en lunes, con semanas completas: si
   * no, los días bailan de columna y cuesta leer "todos los martes".
   */
  const celdas = useMemo(() => {
    const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
    const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0)
    const desplazamiento = (primero.getDay() + 6) % 7
    const out: { fecha: Date; delMes: boolean }[] = []
    for (let i = desplazamiento; i > 0; i--) {
      out.push({ fecha: new Date(mes.getFullYear(), mes.getMonth(), 1 - i), delMes: false })
    }
    for (let d = 1; d <= ultimo.getDate(); d++) {
      out.push({ fecha: new Date(mes.getFullYear(), mes.getMonth(), d), delMes: true })
    }
    while (out.length % 7 !== 0) {
      const sig = out.length - desplazamiento - ultimo.getDate() + 1
      out.push({ fecha: new Date(mes.getFullYear(), mes.getMonth() + 1, sig), delMes: false })
    }
    return out
  }, [mes])

  /** Los totales del mes visible, por tipo. */
  const totalMes = useMemo(() => {
    const t: Record<Tipo, number> = { entrega: 0, despacho: 0, limite: 0 }
    for (const c of celdas) {
      if (!c.delMes) continue
      for (const m of porDia.get(claveDia(c.fecha)) ?? []) t[m.tipo]++
    }
    return t
  }, [celdas, porDia])

  const hoy = claveDia(new Date())
  const detalle = diaAbierto ? (porDia.get(diaAbierto) ?? []) : []
  const programados = detalle.filter((m) => m.tipo !== "limite")
  const limitesDelDia = detalle.filter((m) => m.tipo === "limite")
  const nadaProgramado =
    !cargando && !ordenes.some((o) => o.fecha_apartada_entrega || o.fecha_despacho_cliente)

  function cambiarMes(delta: number | null) {
    setMes((m) => {
      if (delta == null) {
        const h = new Date()
        return new Date(h.getFullYear(), h.getMonth(), 1)
      }
      return new Date(m.getFullYear(), m.getMonth() + delta, 1)
    })
    setDiaAbierto(null)
    setAbierto(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Calendario de recepciones</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Entregas de los maquileros, despachos al cliente y límites de entrega,
          día por día. Haz clic en un día para ver sus folios, y en un folio para
          ver su empaque.
        </p>
      </div>

      {/*
        La leyenda es tambien el filtro: cada casilla muestra u oculta un
        tipo. Va arriba y a la vista porque los tres colores aparecen en
        celdas distintas y sin ella habria que adivinar cual es cual.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {TIPOS.map((t) => (
          <label key={t.tipo} className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={visibles[t.tipo]}
              onChange={() => {
                setVisibles((v) => ({ ...v, [t.tipo]: !v[t.tipo] }))
                setAbierto(null)
              }}
              className="size-3.5"
            />
            <span className={cn("inline-block size-2.5 rounded-sm", t.muestra)} />
            {t.plural}
          </label>
        ))}
      </div>

      {nadaProgramado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-900">
            Ninguna orden pendiente tiene apartado de entrega ni despacho
            programado: por ahora solo se ven los límites. El apartado se
            registra en Seguimiento Maquila y el despacho en la etapa 11 del
            Panel General.
          </p>
        </div>
      )}

      {/* ── Navegación del mes ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-8" onClick={() => cambiarMes(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="icon" variant="outline" className="size-8" onClick={() => cambiarMes(1)}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-semibold capitalize">
            {MESES[mes.getMonth()]} {mes.getFullYear()}
          </span>
          <Button size="sm" variant="ghost" className="ml-1 h-7 text-xs" onClick={() => cambiarMes(null)}>
            Hoy
          </Button>
        </div>

        {/* div y no p: el Skeleton es un div, y un div dentro de un p rompe la hidratacion. */}
        <div className="text-xs text-muted-foreground">
          {cargando ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            TIPOS.filter((t) => visibles[t.tipo]).map((t, i) => (
              <span key={t.tipo}>
                {i > 0 && " · "}
                <span className="font-medium text-foreground">{totalMes[t.tipo]}</span>{" "}
                {t.plural.split(" ")[0].toLowerCase()}
              </span>
            ))
          )}{" "}
          este mes
        </div>
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
            const delDia = porDia.get(clave) ?? []
            const esHoy = clave === hoy
            const esAbierto = clave === diaAbierto
            return (
              <button
                key={i}
                type="button"
                disabled={delDia.length === 0}
                onClick={() => {
                  setDiaAbierto(esAbierto ? null : clave)
                  setAbierto(null)
                }}
                className={cn(
                  "min-h-[84px] border-b border-r border-border p-1.5 text-left transition-colors",
                  (i + 1) % 7 === 0 && "border-r-0",
                  !delMes && "bg-muted/30",
                  delDia.length > 0 && "hover:bg-muted/50",
                  delDia.length === 0 && "cursor-default",
                  esAbierto && "bg-sky-50 ring-1 ring-inset ring-sky-300",
                )}
              >
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

                {delDia.length > 0 && (
                  /*
                    Una insignia por tipo y no una suma: entrar, salir y
                    vencer son cosas distintas.
                  */
                  <div className="mt-1 flex flex-wrap gap-1">
                    {TIPOS.map((t) => {
                      const n = delDia.filter((m) => m.tipo === t.tipo).length
                      if (n === 0) return null
                      return (
                        <span
                          key={t.tipo}
                          title={`${n} · ${t.plural.toLowerCase()}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold",
                            t.insignia,
                          )}
                        >
                          <t.Icono className="size-3" />
                          {n}
                        </span>
                      )
                    })}
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
                {detalle.length} {detalle.length === 1 ? "movimiento" : "movimientos"}
              </span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setDiaAbierto(null)
                setAbierto(null)
              }}
            >
              Cerrar
            </Button>
          </div>

          <div className="space-y-3 p-3">
            {/*
              El cronograma solo lleva lo programado, que es lo que tiene
              hora. Los limites son una fecha tope, no una cita: ponerlos
              en el cronograma los mandaria todos a "sin hora".
            */}
            {programados.length > 0 && (
              <CronogramaDia
                entregas={programados.map(
                  (m): EntregaDia => ({
                    folio: m.orden.folio,
                    cliente: m.orden.cliente,
                    modelo: m.orden.modelo,
                    piezas: m.orden.piezas,
                    maquilero: m.orden.maquilero,
                    fase_actual: m.orden.fase_actual,
                    hora: m.hora,
                    tipo: m.tipo === "despacho" ? "despacho" : "entrega",
                  }),
                )}
                seleccionado={abierto}
                onSeleccionar={(e) => {
                  const k = `${e.tipo ?? "entrega"}-${e.folio}`
                  setAbierto((a) => (a === k ? null : k))
                }}
              />
            )}

            {folioAbierto && (
              <DistribucionDespacho folio={folioAbierto} onCerrar={() => setAbierto(null)} />
            )}
          </div>

          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Hora</th>
                <th className="px-3 py-1.5 font-medium">Movimiento</th>
                <th className="px-3 py-1.5 font-medium">Folio</th>
                <th className="px-3 py-1.5 font-medium">Cliente</th>
                <th className="px-3 py-1.5 font-medium">Modelo</th>
                <th className="px-3 py-1.5 font-medium">Maquilero</th>
                <th className="px-3 py-1.5 font-medium">Fase</th>
                <th className="px-3 py-1.5 text-right font-medium">Piezas</th>
              </tr>
            </thead>
            <tbody>
              {[...programados, ...limitesDelDia].map((m) => {
                const t = DE[m.tipo]
                const k = claveMov(m)
                return (
                  <tr
                    key={k}
                    onClick={() => setAbierto((a) => (a === k ? null : k))}
                    title="Ver el empaque de este folio"
                    className={cn(
                      "cursor-pointer border-t border-border hover:bg-muted/40",
                      abierto === k && "bg-violet-50",
                    )}
                  >
                    <td className="px-3 py-1.5 tabular-nums">
                      {m.hora ? (
                        m.hora.slice(0, 5)
                      ) : (
                        <span className="text-xs text-muted-foreground/60">
                          {m.tipo === "limite" ? "—" : "sin hora"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                          t.insignia,
                        )}
                      >
                        <t.Icono className="size-3" /> {t.nombre}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-medium tabular-nums">{m.orden.folio}</td>
                    <td className="px-3 py-1.5">{m.orden.cliente ?? "—"}</td>
                    <td className="px-3 py-1.5">{m.orden.modelo ?? "—"}</td>
                    <td className="px-3 py-1.5">{m.orden.maquilero ?? "—"}</td>
                    <td className="px-3 py-1.5">{m.orden.fase_actual ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {Number(m.orden.piezas ?? 0).toLocaleString("es-MX")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            Haz clic en una fila o en una tarjeta del cronograma para ver la
            distribución de cajas o bultos del folio.
          </p>
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

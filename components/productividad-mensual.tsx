"use client"

import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { cn } from "@/lib/utils"

/**
 * La productividad por mes, de una persona o del equipo.
 *
 * DE DÓNDE SALE:
 *   De las vistas semanales de bonos (vw_bonos_diseno, vw_bonos_corte),
 *   que ya traen por persona y semana las horas cumplidas, fuera de
 *   área y ausentismos. Aquí no se recalcula nada de la semana: solo se
 *   agrupa.
 *
 * CÓMO SE CONSOLIDA EL MES:
 *   Sumando horas, no promediando porcentajes. La eficiencia semanal es
 *   (cumplidas + fuera de área) ÷ (45 − ausentismos); la del mes es la
 *   misma división con las sumas de todas sus semanas. Promediar los
 *   porcentajes haría pesar igual una semana de vacaciones —con 10
 *   horas disponibles— que una completa de 45.
 *
 * A QUÉ MES VA UNA SEMANA:
 *   Al del jueves de esa semana ISO, que es la regla de la propia norma
 *   ISO. Una semana que cruza de mes cuenta entera en uno solo: partirla
 *   por días exigiría el detalle diario, que las vistas no tienen.
 *
 * Las semanas de un colaborador dado de baja no cuentan: su vista las
 * marca sin eficiencia, y sumarlas bajaría el mes por horas que nadie
 * debía cumplir.
 */

export type FilaSemanal = {
  anio: number | null
  semana: number | null
  nombre: string
  horas_semana: number | null
  horas_cumplidas: number | null
  horas_fuera_area: number | null
  ausentismos: number | null
  monto: number | null
  /** true = no cuenta (p. ej. colaborador dado de baja esa semana). */
  excluir?: boolean
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** El umbral del bono semanal: 70 % de eficiencia. */
const UMBRAL_BONO = 70

/** "aaaa-mm" del jueves de la semana ISO. */
function mesDeSemana(anio: number, semana: number): string {
  // El 4 de enero siempre cae en la semana 1.
  const enero4 = new Date(Date.UTC(anio, 0, 4))
  const lunes1 = new Date(enero4)
  lunes1.setUTCDate(enero4.getUTCDate() - ((enero4.getUTCDay() + 6) % 7))
  const jueves = new Date(lunes1)
  jueves.setUTCDate(lunes1.getUTCDate() + (semana - 1) * 7 + 3)
  return `${jueves.getUTCFullYear()}-${String(jueves.getUTCMonth() + 1).padStart(2, "0")}`
}

function etiquetaMes(clave: string): string {
  const [a, m] = clave.split("-")
  return `${MESES_CORTOS[Number(m) - 1]} ${a.slice(2)}`
}

type Acumulado = {
  semanas: number
  cumplidas: number
  fuera: number
  disponibles: number
  bonos: number
}

const vacio = (): Acumulado => ({ semanas: 0, cumplidas: 0, fuera: 0, disponibles: 0, bonos: 0 })

/** Eficiencia del acumulado, en %; null si no hubo horas disponibles. */
function eficiencia(a: Acumulado): number | null {
  if (a.disponibles <= 0) return null
  return Math.round(((a.cumplidas + a.fuera) / a.disponibles) * 1000) / 10
}

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} %`)
const fmtHoras = (v: number) => v.toLocaleString("es-MX", { maximumFractionDigits: 1 })
const fmtDinero = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })

export function ProductividadMensual({
  filas,
  etiquetaPersona,
}: {
  filas: FilaSemanal[]
  /** "diseñadora", "cortador"… para el filtro y los textos. */
  etiquetaPersona: string
}) {
  /** "" = el equipo completo. */
  const [persona, setPersona] = useState("")

  const personas = useMemo(
    () => [...new Set(filas.map((f) => f.nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [filas],
  )

  /** mes → persona → acumulado. */
  const porMes = useMemo(() => {
    const m = new Map<string, Map<string, Acumulado>>()
    for (const f of filas) {
      if (f.excluir || f.anio == null || f.semana == null) continue
      const mes = mesDeSemana(f.anio, f.semana)
      const delMes = m.get(mes) ?? new Map<string, Acumulado>()
      const a = delMes.get(f.nombre) ?? vacio()
      a.semanas += 1
      a.cumplidas += Number(f.horas_cumplidas ?? 0)
      a.fuera += Number(f.horas_fuera_area ?? 0)
      a.disponibles += Math.max(0, Number(f.horas_semana ?? 45) - Number(f.ausentismos ?? 0))
      a.bonos += Number(f.monto ?? 0)
      delMes.set(f.nombre, a)
      m.set(mes, delMes)
    }
    return m
  }, [filas])

  const meses = useMemo(() => [...porMes.keys()].sort(), [porMes])

  /** La serie de la gráfica: un punto por mes, de la persona o del equipo. */
  const serie = useMemo(
    () =>
      meses.map((mes) => {
        const delMes = porMes.get(mes)!
        const a = vacio()
        for (const [nombre, x] of delMes) {
          if (persona && nombre !== persona) continue
          a.semanas += x.semanas
          a.cumplidas += x.cumplidas
          a.fuera += x.fuera
          a.disponibles += x.disponibles
          a.bonos += x.bonos
        }
        return { mes, etiqueta: etiquetaMes(mes), eficiencia: eficiencia(a), ...a }
      }),
    [meses, porMes, persona],
  )

  // El eje sube hasta lo que haga falta: hay meses por encima del 100 %
  // cuando se cumplen más horas de las disponibles.
  const maxY = Math.max(100, ...serie.map((s) => s.eficiencia ?? 0))
  const techo = Math.ceil(maxY / 20) * 20

  if (filas.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Productividad por mes</h3>
          <p className="text-xs text-muted-foreground">
            Eficiencia consolidada: horas cumplidas más fuera de área, entre
            las disponibles del mes. La línea punteada es el {UMBRAL_BONO} %
            del bono.
          </p>
        </div>
        <select
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Todo el equipo</option>
          {personas.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={serie} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="oklch(0.92 0.02 280)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="etiqueta"
            stroke="oklch(0.45 0.04 280)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, techo]}
            stroke="oklch(0.45 0.04 280)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ReferenceLine
            y={UMBRAL_BONO}
            stroke="oklch(0.45 0.04 280)"
            strokeDasharray="4 4"
            label={{ value: `Bono ${UMBRAL_BONO}%`, position: "insideTopRight", fontSize: 10, fill: "oklch(0.45 0.04 280)" }}
          />
          <RechartsTooltip
            cursor={{ stroke: "oklch(0.45 0.04 280)", strokeDasharray: "3 3" }}
            contentStyle={{
              background: "oklch(0.15 0.04 295)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              fontSize: 12,
              color: "rgba(255,255,255,0.9)",
            }}
            labelStyle={{ color: "rgba(255,255,255,0.55)", marginBottom: 4 }}
            formatter={(v, _n, item) => {
              const p = item.payload as (typeof serie)[number]
              return [
                `${fmtPct(v == null ? null : Number(v))} · ${fmtHoras(p.cumplidas + p.fuera)} de ${fmtHoras(p.disponibles)} h · ${p.semanas} sem.`,
                persona || "Equipo",
              ]
            }}
          />
          <Line
            type="monotone"
            dataKey="eficiencia"
            stroke="oklch(0.62 0.18 220)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card, #fff)", fill: "oklch(0.62 0.18 220)" }}
            activeDot={{ r: 6 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/*
        La tabla es la vista exacta de la grafica, y ademas el unico lugar
        donde se ven todos a la vez: con el equipo seleccionado, una fila
        por persona y una columna por mes.
      */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        {persona ? (
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Mes</th>
                <th className="px-3 py-1.5 text-right font-medium">Semanas</th>
                <th className="px-3 py-1.5 text-right font-medium">Horas cumplidas</th>
                <th className="px-3 py-1.5 text-right font-medium">Fuera de área</th>
                <th className="px-3 py-1.5 text-right font-medium">Disponibles</th>
                <th className="px-3 py-1.5 text-right font-medium">Eficiencia</th>
                <th className="px-3 py-1.5 text-right font-medium">Bonos</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((s) => (
                <tr key={s.mes} className="border-t border-border">
                  <td className="px-3 py-1.5 capitalize">{s.etiqueta}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.semanas || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.semanas ? fmtHoras(s.cumplidas) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.semanas ? fmtHoras(s.fuera) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.semanas ? fmtHoras(s.disponibles) : "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-semibold tabular-nums",
                      s.eficiencia != null && s.eficiencia < UMBRAL_BONO && "text-amber-700",
                    )}
                  >
                    {fmtPct(s.eficiencia)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.semanas ? fmtDinero(s.bonos) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium capitalize">{etiquetaPersona}</th>
                {meses.map((m) => (
                  <th key={m} className="px-3 py-1.5 text-right font-medium">
                    {etiquetaMes(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => setPersona(p)}
                      title={`Ver la línea de tiempo de ${p}`}
                    >
                      {p}
                    </button>
                  </td>
                  {meses.map((m) => {
                    const a = porMes.get(m)?.get(p)
                    const e = a ? eficiencia(a) : null
                    return (
                      <td
                        key={m}
                        className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          e != null && e < UMBRAL_BONO && "text-amber-700",
                        )}
                      >
                        {fmtPct(e)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                <td className="px-3 py-1.5">Equipo</td>
                {serie.map((s) => (
                  <td key={s.mes} className="px-3 py-1.5 text-right tabular-nums">
                    {fmtPct(s.eficiencia)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Cada semana cuenta en el mes de su jueves. En ámbar, los meses por
        debajo del {UMBRAL_BONO} %.
      </p>
    </section>
  )
}

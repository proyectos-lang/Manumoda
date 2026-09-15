"use client"

import { useMemo, useState } from "react"
import { Calculator, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { TALLAS_ESTANDAR } from "@/lib/types"

/**
 * Las proporciones que definen el pedido, y de las que sale todo el reparto.
 *
 * EL MODELO:
 *   Se capturan tres cosas y las unidades de cada celda se derivan:
 *
 *     piezas(color, talla) = total
 *                          × prop_color / suma(prop_color)
 *                          × prop_talla / suma(prop_talla)
 *
 *   Verificado contra dos fichas reales: el modelo 696 (600 piezas,
 *   proporción de talla 1-2-2-1) da 100/200/200/100 exacto.
 *
 * EL CÁLCULO LLENA, NO PISA:
 *   Aplicar el reparto escribe las cantidades, pero después se pueden
 *   ajustar a mano y el ajuste manda. Hace falta: el folio 2058 tiene
 *   proporción pareja (1-1-1-1) y un reparto real desparejo
 *   (46/48/38/36), y ese folio existe y está en producción.
 */

export type ProporcionesState = {
  /** Piezas totales del pedido, la base del reparto. */
  total: number | null
  /** Proporción por talla: {"S":1,"M":2,"L":2}. Relativa, no porcentaje. */
  tallas: Record<string, number>
  /** Proporción por color: {"BLANCO":2,"NEGRO":1}. Relativa. */
  colores: Record<string, number>
}

/** El reparto que resulta de las tres cosas capturadas. */
export function calcularReparto(p: ProporcionesState): Record<string, Record<string, number>> {
  const total = p.total ?? 0
  const sumaT = Object.values(p.tallas).reduce((a, b) => a + (Number(b) || 0), 0)
  const sumaC = Object.values(p.colores).reduce((a, b) => a + (Number(b) || 0), 0)
  const out: Record<string, Record<string, number>> = {}
  if (total <= 0 || sumaT <= 0 || sumaC <= 0) return out

  for (const [color, pc] of Object.entries(p.colores)) {
    const delColor = (total * (Number(pc) || 0)) / sumaC
    out[color] = {}
    for (const [talla, pt] of Object.entries(p.tallas)) {
      out[color][talla] = Math.round((delColor * (Number(pt) || 0)) / sumaT)
    }
  }
  return out
}

export function FichaProporciones({
  valor,
  onChange,
  onAplicar,
  readOnly,
}: {
  valor: ProporcionesState
  onChange: (v: ProporcionesState) => void
  /** Escribe el reparto en los cuadros de tallas. */
  onAplicar: (reparto: Record<string, Record<string, number>>) => void
  readOnly: boolean
}) {
  const [nuevoColor, setNuevoColor] = useState("")
  const [nuevaTalla, setNuevaTalla] = useState("")

  const reparto = useMemo(() => calcularReparto(valor), [valor])
  const tallasUsadas = Object.keys(valor.tallas)
  const coloresUsados = Object.keys(valor.colores)

  const sumaT = Object.values(valor.tallas).reduce((a, b) => a + (Number(b) || 0), 0)
  const sumaC = Object.values(valor.colores).reduce((a, b) => a + (Number(b) || 0), 0)
  const repartido = Object.values(reparto).reduce(
    (s, fila) => s + Object.values(fila).reduce((a, b) => a + b, 0),
    0,
  )
  /** El redondeo de cada celda puede desviar el total en unas pocas piezas. */
  const desvio = (valor.total ?? 0) - repartido

  function setTalla(t: string, v: number) {
    onChange({ ...valor, tallas: { ...valor.tallas, [t]: v } })
  }
  function quitarTalla(t: string) {
    const { [t]: _, ...resto } = valor.tallas
    onChange({ ...valor, tallas: resto })
  }
  function setColor(c: string, v: number) {
    onChange({ ...valor, colores: { ...valor.colores, [c]: v } })
  }
  function quitarColor(c: string) {
    const { [c]: _, ...resto } = valor.colores
    onChange({ ...valor, colores: resto })
  }

  function agregarColor() {
    const c = nuevoColor.trim().toUpperCase()
    if (!c) return
    if (valor.colores[c] != null) {
      toast.error(`${c} ya está en la lista`)
      return
    }
    onChange({ ...valor, colores: { ...valor.colores, [c]: 1 } })
    setNuevoColor("")
  }

  function agregarTalla(t: string) {
    const clave = t.trim().toUpperCase()
    if (!clave) return
    if (valor.tallas[clave] != null) {
      toast.error(`La talla ${clave} ya está`)
      return
    }
    onChange({ ...valor, tallas: { ...valor.tallas, [clave]: 1 } })
    setNuevaTalla("")
  }

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Proporciones del pedido</h3>
        <p className="text-xs text-muted-foreground">
          Las unidades de cada talla y color salen de aquí: total × proporción de
          color × proporción de talla.
        </p>
      </div>

      {/* ── Cantidad total ── */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Piezas totales del pedido
          </label>
          <Input
            type="number"
            min="0"
            disabled={readOnly}
            value={valor.total ?? ""}
            onChange={(e) =>
              onChange({
                ...valor,
                total: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            placeholder="600"
            className="mt-1 h-9 w-40 text-right tabular-nums"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Proporción por talla ── */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">Proporción por talla</p>
            <span className="text-[11px] text-muted-foreground">
              suma {sumaT || "—"}
            </span>
          </div>

          {/* Las siete estándar, para marcarlas de un clic */}
          <div className="mb-3 flex flex-wrap gap-1">
            {TALLAS_ESTANDAR.map((t) => {
              const activa = valor.tallas[t] != null
              return (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={activa ? "default" : "outline"}
                  disabled={readOnly}
                  className="h-7 min-w-[46px] px-2 text-xs"
                  onClick={() => (activa ? quitarTalla(t) : agregarTalla(t))}
                >
                  {t}
                </Button>
              )
            })}
          </div>

          {tallasUsadas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Elige las tallas que usa este folio.
            </p>
          ) : (
            <div className="space-y-1.5">
              {tallasUsadas.map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <span className="w-14 font-mono text-xs font-semibold">{t}</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={readOnly}
                    value={valor.tallas[t]}
                    onChange={(e) => setTalla(t, Number(e.target.value) || 0)}
                    className="h-7 w-24 text-right text-xs tabular-nums"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {sumaT > 0
                      ? `${Math.round((100 * valor.tallas[t]) / sumaT)}%`
                      : ""}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    className="ml-auto size-7 p-0"
                    onClick={() => quitarTalla(t)}
                  >
                    <X className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Una escala distinta (0X, 28, 30…) se teclea aquí */}
          <div className="mt-3 flex items-center gap-1.5">
            <Input
              value={nuevaTalla}
              onChange={(e) => setNuevaTalla(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") agregarTalla(nuevaTalla)
              }}
              placeholder="Otra talla (0X, 28…)"
              disabled={readOnly}
              className="h-7 flex-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={readOnly || !nuevaTalla.trim()}
              className="h-7 gap-1 text-xs"
              onClick={() => agregarTalla(nuevaTalla)}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>

        {/* ── Proporción por color ── */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">Proporción por color</p>
            <span className="text-[11px] text-muted-foreground">
              suma {sumaC || "—"}
            </span>
          </div>

          {coloresUsados.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Agrega los colores del pedido. Con un solo color, la proporción no
              importa: se lleva todo.
            </p>
          ) : (
            <div className="space-y-1.5">
              {coloresUsados.map((c) => (
                <div key={c} className="flex items-center gap-2">
                  <span className="min-w-[90px] flex-1 truncate text-xs font-semibold">
                    {c}
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={readOnly}
                    value={valor.colores[c]}
                    onChange={(e) => setColor(c, Number(e.target.value) || 0)}
                    className="h-7 w-24 text-right text-xs tabular-nums"
                  />
                  <span className="w-20 text-right text-[11px] text-muted-foreground">
                    {sumaC > 0 && valor.total
                      ? `${Math.round((valor.total * valor.colores[c]) / sumaC)} pz`
                      : ""}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    className="size-7 p-0"
                    onClick={() => quitarColor(c)}
                  >
                    <X className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-1.5">
            <Input
              value={nuevoColor}
              onChange={(e) => setNuevoColor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") agregarColor()
              }}
              placeholder="Color…"
              disabled={readOnly}
              className="h-7 flex-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={readOnly || !nuevoColor.trim()}
              className="h-7 gap-1 text-xs"
              onClick={agregarColor}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── El reparto resultante ── */}
      {Object.keys(reparto).length > 0 && tallasUsadas.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">Reparto calculado</p>
            <div className="flex items-center gap-3">
              {desvio !== 0 && (
                <span
                  className="text-[11px] text-amber-600"
                  title="El redondeo de cada celda puede desviar el total en unas pocas piezas"
                >
                  {desvio > 0 ? `faltan ${desvio}` : `sobran ${-desvio}`} pz por
                  redondeo
                </span>
              )}
              <Button
                type="button"
                size="sm"
                disabled={readOnly}
                className="h-7 gap-1.5 text-xs"
                onClick={() => onAplicar(reparto)}
              >
                <Calculator className="size-3.5" />
                Aplicar a los cuadros de talla
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Color</th>
                  {tallasUsadas.map((t) => (
                    <th key={t} className="px-2 py-1.5 text-center font-medium">
                      {t}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(reparto).map(([color, fila]) => (
                  <tr key={color} className="border-t border-border">
                    <td className="px-2 py-1 font-medium">{color}</td>
                    {tallasUsadas.map((t) => (
                      <td key={t} className="px-2 py-1 text-center tabular-nums">
                        {fila[t] ?? 0}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">
                      {Object.values(fila).reduce((a, b) => a + b, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/50">
                <tr>
                  <td className="px-2 py-1.5 font-semibold" colSpan={tallasUsadas.length + 1}>
                    Piezas repartidas
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right font-bold tabular-nums",
                      desvio !== 0 && "text-amber-600",
                    )}
                  >
                    {repartido}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Aplicar escribe estas cantidades en los cuadros de talla. Después las
            puedes ajustar a mano: lo que captures manda sobre el cálculo.
          </p>
        </div>
      )}
    </section>
  )
}

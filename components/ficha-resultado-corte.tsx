"use client"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * El resultado real del corte: la misma matriz del reparto, en blanco.
 *
 * POR QUÉ ESPEJO DEL PLAN Y NO UN CUADRO LIBRE:
 *   Quien captura el corte está comparando contra el plan: mismos
 *   colores, mismas tallas, mismas posiciones. Si la matriz tuviera otra
 *   forma —o hubiera que dar de alta los colores otra vez— habría que
 *   ir y venir para saber a qué celda corresponde cada número.
 *
 *   Por eso las filas y columnas salen del reparto, no se capturan: aquí
 *   solo se escriben cantidades.
 *
 * NACE EN BLANCO, NO EN EL PLAN:
 *   Las celdas vacías se muestran vacías, no en cero. Lo que salió del
 *   corte es un hecho que se mide: un cero escrito y un "todavía no lo
 *   capturo" significan cosas distintas, y precargar el plan haría que
 *   un corte sin capturar pareciera cumplido.
 *
 * LA DIFERENCIA SE MUESTRA, NO SE ESCONDE:
 *   Cada celda capturada se compara contra el plan. Verde si cuadra,
 *   ámbar si falta, azul si sobró. Es la lectura que busca quien revisa
 *   el corte, y tenerla al lado evita sacar la cuenta a mano.
 */

export type MatrizReparto = Record<string, Record<string, number>>

export function FichaResultadoCorte({
  plan,
  real,
  columnas,
  readOnly,
  onCambiar,
}: {
  /** El reparto planeado: define qué filas y columnas existen. */
  plan: MatrizReparto
  /** Lo capturado. Una celda ausente es "sin capturar", distinta de 0. */
  real: Record<string, Record<string, number | null>>
  columnas: string[]
  readOnly: boolean
  onCambiar: (color: string, talla: string, valor: number | null) => void
}) {
  const colores = Object.keys(plan)

  if (colores.length === 0 || columnas.length === 0) {
    return (
      <section>
        <h3 className="mb-1 text-sm font-semibold">Resultado de corte</h3>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Primero define las proporciones y aplica el reparto. Esta matriz
            copia su forma para capturar lo que realmente salió.
          </p>
        </div>
      </section>
    )
  }

  const totalPlan = colores.reduce(
    (s, c) => s + columnas.reduce((a, t) => a + (plan[c]?.[t] ?? 0), 0),
    0,
  )
  const totalReal = colores.reduce(
    (s, c) => s + columnas.reduce((a, t) => a + (real[c]?.[t] ?? 0), 0),
    0,
  )
  /** Cuántas celdas se han capturado, de las que hay. */
  const capturadas = colores.reduce(
    (s, c) => s + columnas.filter((t) => real[c]?.[t] != null).length,
    0,
  )
  const celdas = colores.length * columnas.length

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Resultado de corte</h3>
          <p className="text-xs text-muted-foreground">
            Lo que realmente salió del corte. Se captura aquí o desde el módulo
            de Corte; las casillas vacías son las que faltan.
          </p>
        </div>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium",
            capturadas === 0
              ? "bg-muted text-muted-foreground"
              : capturadas < celdas
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700",
          )}
        >
          {capturadas} de {celdas} casillas
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Color</th>
              {columnas.map((t) => (
                <th key={t} className="px-2 py-1.5 text-center font-medium">
                  {t}
                </th>
              ))}
              <th className="px-3 py-1.5 text-right font-medium">Total</th>
              <th className="px-3 py-1.5 text-right font-medium">Plan</th>
            </tr>
          </thead>

          <tbody>
            {colores.map((color) => {
              const sumaReal = columnas.reduce((a, t) => a + (real[color]?.[t] ?? 0), 0)
              const sumaPlan = columnas.reduce((a, t) => a + (plan[color]?.[t] ?? 0), 0)
              const dif = sumaReal - sumaPlan
              const algo = columnas.some((t) => real[color]?.[t] != null)
              return (
                <tr key={color} className="border-t border-border">
                  <td className="px-3 py-1 font-medium">{color}</td>

                  {columnas.map((t) => {
                    const planCelda = plan[color]?.[t] ?? 0
                    const valor = real[color]?.[t]
                    const cuadra = valor != null && valor === planCelda
                    const falta = valor != null && valor < planCelda
                    const sobra = valor != null && valor > planCelda
                    return (
                      <td key={t} className="px-1 py-1">
                        <Input
                          type="number"
                          min="0"
                          disabled={readOnly}
                          // Vacío es "sin capturar", distinto de un 0 escrito.
                          value={valor ?? ""}
                          onChange={(e) =>
                            onCambiar(
                              color,
                              t,
                              e.target.value === "" ? null : Number(e.target.value),
                            )
                          }
                          placeholder={String(planCelda)}
                          title={`Plan: ${planCelda}`}
                          className={cn(
                            "h-7 w-full min-w-[62px] text-center text-sm tabular-nums sin-flechas",
                            cuadra && "border-emerald-300 bg-emerald-50",
                            falta && "border-amber-300 bg-amber-50",
                            sobra && "border-sky-300 bg-sky-50",
                          )}
                        />
                      </td>
                    )
                  })}

                  <td
                    className={cn(
                      "px-3 py-1 text-right font-semibold tabular-nums",
                      algo && dif < 0 && "text-amber-600",
                      algo && dif > 0 && "text-sky-600",
                      algo && dif === 0 && "text-emerald-600",
                    )}
                    title={
                      algo && dif !== 0
                        ? dif < 0
                          ? `Faltan ${-dif} respecto al plan`
                          : `Sobran ${dif} respecto al plan`
                        : undefined
                    }
                  >
                    {algo ? sumaReal : "—"}
                  </td>
                  <td className="px-3 py-1 text-right text-xs tabular-nums text-muted-foreground">
                    {sumaPlan}
                  </td>
                </tr>
              )
            })}
          </tbody>

          <tfoot className="border-t-2 border-border bg-muted/50">
            <tr>
              <td className="px-3 py-1.5 font-semibold" colSpan={columnas.length + 1}>
                Piezas cortadas
              </td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right font-bold tabular-nums",
                  capturadas > 0 && totalReal < totalPlan && "text-amber-600",
                  capturadas > 0 && totalReal > totalPlan && "text-sky-600",
                  capturadas > 0 && totalReal === totalPlan && "text-emerald-600",
                )}
              >
                {capturadas > 0 ? totalReal : "—"}
              </td>
              <td className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                {totalPlan}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {capturadas > 0 && totalReal !== totalPlan && (
        <p
          className={cn(
            "mt-2 text-xs",
            totalReal < totalPlan ? "text-amber-700" : "text-sky-700",
          )}
        >
          {totalReal < totalPlan
            ? `Faltan ${totalPlan - totalReal} piezas respecto al plan.`
            : `Salieron ${totalReal - totalPlan} piezas de más respecto al plan.`}
        </p>
      )}
    </section>
  )
}

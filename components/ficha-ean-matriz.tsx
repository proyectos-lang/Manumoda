"use client"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * Los códigos de barras, uno por color y talla.
 *
 * POR QUÉ UNA MATRIZ Y NO UN CAMPO:
 *   Un EAN identifica un SKU: la misma blusa en negro talla M y en
 *   blanco talla L son dos códigos distintos. Un solo código por folio
 *   no sirve para etiquetar la prenda.
 *
 * ESPEJO DEL REPARTO, COMO EL RESULTADO DE CORTE:
 *   Las filas y columnas salen del reparto calculado, no se capturan
 *   aparte. Quien teclea los códigos los está copiando de una lista del
 *   cliente ordenada por color y talla; que la matriz tenga otra forma
 *   obligaría a ir y venir para saber qué celda toca.
 *
 * NACE EN BLANCO:
 *   El cliente no siempre da todos los códigos, y una celda vacía
 *   significa "no lo dio", que no es un error. Por eso no se precarga
 *   nada ni se exige completar la matriz para guardar.
 *
 * SOLO DÍGITOS, Y NO SE BLOQUEA NADA MÁS:
 *   Al teclear se descarta lo que no sea número —así un copiar y pegar
 *   con espacios entra limpio— y si el largo no es el de un EAN se
 *   marca la celda en ámbar, pero se deja guardar. Un código a medio
 *   teclear no debe impedir guardar el resto de la ficha.
 */

/** Los códigos capturados: {color: {talla: código}}. */
export type MatrizEan = Record<string, Record<string, string>>

/** Los largos que usa el comercio: EAN-8, EAN-13 y el de caja, GTIN-14. */
const LARGOS_VALIDOS = [8, 13, 14]

export function FichaEanMatriz({
  colores,
  columnas,
  valores,
  readOnly,
  onCambiar,
}: {
  /** Los colores del reparto: definen las filas. */
  colores: string[]
  /** Las tallas del reparto: definen las columnas. */
  columnas: string[]
  valores: MatrizEan
  readOnly: boolean
  onCambiar: (color: string, talla: string, codigo: string) => void
}) {
  if (colores.length === 0 || columnas.length === 0) {
    return (
      <section>
        <h3 className="mb-1 text-sm font-semibold">Códigos EAN</h3>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Primero define las proporciones y aplica el reparto. La matriz
            de códigos copia su forma: un código por color y talla.
          </p>
        </div>
      </section>
    )
  }

  const celdas = colores.length * columnas.length
  const capturados = colores.reduce(
    (s, c) => s + columnas.filter((t) => (valores[c]?.[t] ?? "") !== "").length,
    0,
  )

  /** Los códigos repetidos: el mismo EAN en dos SKU es un error de captura. */
  const repetidos = new Set<string>()
  const vistos = new Set<string>()
  for (const c of colores) {
    for (const t of columnas) {
      const v = valores[c]?.[t] ?? ""
      if (!v) continue
      if (vistos.has(v)) repetidos.add(v)
      vistos.add(v)
    }
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Códigos EAN</h3>
          <p className="text-xs text-muted-foreground">
            Un código por color y talla, como los entrega el cliente. Las
            casillas que no traiga se dejan vacías.
          </p>
        </div>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium",
            capturados === 0
              ? "bg-muted text-muted-foreground"
              : capturados < celdas
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700",
          )}
        >
          {capturados} de {celdas} casillas
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
            </tr>
          </thead>

          <tbody>
            {colores.map((color) => (
              <tr key={color} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-1 font-medium">
                  {color}
                </td>

                {columnas.map((t) => {
                  const v = valores[color]?.[t] ?? ""
                  const largoRaro = v !== "" && !LARGOS_VALIDOS.includes(v.length)
                  const duplicado = v !== "" && repetidos.has(v)
                  return (
                    <td key={t} className="px-1 py-1">
                      <Input
                        inputMode="numeric"
                        disabled={readOnly}
                        value={v}
                        // Se limpia al vuelo: pegar "750 123 456 7890"
                        // deja solo los dígitos.
                        onChange={(e) =>
                          onCambiar(
                            color,
                            t,
                            e.target.value.replace(/\D/g, "").slice(0, 14),
                          )
                        }
                        placeholder="—"
                        title={
                          duplicado
                            ? "Este código ya está en otra casilla"
                            : largoRaro
                              ? `Un EAN tiene 8, 13 o 14 dígitos; este lleva ${v.length}`
                              : undefined
                        }
                        className={cn(
                          "h-7 w-full min-w-[120px] text-center text-xs tabular-nums",
                          largoRaro && "border-amber-300 bg-amber-50",
                          duplicado && "border-destructive/50 bg-destructive/5",
                        )}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Los dos avisos se muestran, no se bloquean: el cliente manda los
        códigos y aquí solo se copian. Quien captura decide si es un
        error suyo o del listado que recibió.
      */}
      {repetidos.size > 0 && (
        <p className="mt-2 text-xs font-medium text-destructive">
          {repetidos.size === 1
            ? "Hay un código repetido en dos casillas: cada color y talla debería tener el suyo."
            : `Hay ${repetidos.size} códigos repetidos: cada color y talla debería tener el suyo.`}
        </p>
      )}
      {capturados > 0 && capturados < celdas && (
        <p className="mt-1 text-xs text-muted-foreground">
          Faltan {celdas - capturados} casillas. Se puede guardar así.
        </p>
      )}
    </section>
  )
}

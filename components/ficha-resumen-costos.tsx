"use client"

import { cn } from "@/lib/utils"
import type { VwFichaTecnica } from "@/lib/types"

/**
 * El costeo completo del folio, al final de la ficha.
 *
 * POR QUÉ AQUÍ Y NO ARRIBA CON LOS PRECIOS:
 *   Arriba, el desglose mostraba tela $0.00 y habilitación $0.00 porque
 *   esos cuadros todavía no se habían capturado: quien leía veía ceros y
 *   no entendía de dónde salía el Costo Neto. Al final, cada renglón ya
 *   tiene su número.
 *
 * DOS COSTOS DISTINTOS, A PROPÓSITO:
 *   · Costo Neto  — costo fijo + materiales. Es el de la ficha impresa
 *     y el que manda el margen que se cotiza.
 *   · Costo total — además todo el proceso: maquila, lavandería y
 *     servicios. Es lo que cuesta producir la pieza de verdad.
 *
 *   Se muestran separados porque responden preguntas distintas, y
 *   mezclarlos haría que el margen de la ficha dejara de coincidir con
 *   el sistema anterior.
 */

function money(v: number | null | undefined): string {
  if (v == null) return "—"
  return `$${Number(v).toFixed(2)}`
}

export function FichaResumenCostos({
  ficha,
  costoTela,
  costoHabilitacion,
  costoNeto,
  costoServicios,
  costoTotalPieza,
  piezas,
}: {
  ficha: VwFichaTecnica
  /**
   * Los materiales y el neto llegan CALCULADOS desde el formulario, no se
   * leen de `ficha`: esa viene de la vista, que solo conoce lo guardado, y
   * una línea recién capturada no estaría ahí todavía.
   */
  costoTela: number
  costoHabilitacion: number
  costoNeto: number
  costoServicios: number
  costoTotalPieza: number
  /** Piezas del pedido, para el total de la orden. */
  piezas: number | null
}) {
  const venta = Number(ficha.precio_venta ?? 0)
  const neto = costoNeto
  const utilidad = venta - costoTotalPieza
  const hayVenta = venta > 0

  /** Renglón del desglose. `fuerte` marca los subtotales. */
  const Fila = ({
    concepto,
    valor,
    fuerte,
    nota,
    sangria,
  }: {
    concepto: string
    valor: number | null
    fuerte?: boolean
    nota?: string
    sangria?: boolean
  }) => (
    <tr className={cn(fuerte && "border-t border-border bg-muted/40")}>
      <td className={cn("px-3 py-1.5", sangria && "pl-6", fuerte && "font-semibold")}>
        {concepto}
        {nota && (
          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
            {nota}
          </span>
        )}
      </td>
      <td
        className={cn(
          "px-3 py-1.5 text-right tabular-nums",
          fuerte && "font-semibold",
        )}
      >
        {money(valor)}
      </td>
    </tr>
  )

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Resumen de costos</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Todo por pieza. El Costo Neto es el de la ficha impresa; el total suma
        además el proceso.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── El desglose ── */}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              <Fila concepto="Costo fijo" valor={ficha.costo_fijo} />
              <Fila concepto="Tela" valor={costoTela} />
              <Fila concepto="Habilitación" valor={costoHabilitacion} />
              <Fila concepto="Costo Neto" valor={neto} fuerte nota="ficha impresa" />

              <Fila concepto="Maquila" valor={ficha.costo_maquila} sangria />
              <Fila concepto="Lavandería" valor={ficha.costo_lavanderia} sangria />
              {costoServicios > 0 && (
                <Fila
                  concepto="Servicios externos"
                  valor={costoServicios}
                  sangria
                  nota="estampado, bordado, corte, otros"
                />
              )}
              <Fila concepto="Costo total por pieza" valor={costoTotalPieza} fuerte />
            </tbody>
          </table>
        </div>

        {/* ── La utilidad ── */}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              <Fila concepto="Precio de venta" valor={hayVenta ? venta : null} />
              <Fila concepto="Costo total por pieza" valor={costoTotalPieza} />
              <tr className="border-t border-border bg-muted/40">
                <td className="px-3 py-1.5 font-semibold">Utilidad unitaria</td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-semibold tabular-nums",
                    hayVenta && utilidad < 0 && "text-destructive",
                    hayVenta && utilidad > 0 && "text-emerald-700",
                  )}
                >
                  {hayVenta ? money(utilidad) : "—"}
                </td>
              </tr>
              {hayVenta && (
                <tr>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    Utilidad sobre venta
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      utilidad < 0 && "text-destructive",
                    )}
                  >
                    {`${((100 * utilidad) / venta).toFixed(2)}%`}
                  </td>
                </tr>
              )}
              {/*
                El margen de la ficha impresa: sobre el NETO, no sobre el
                total. Se muestra al lado para que no se confunda con la
                utilidad real.

                El margen se recalcula aquí con el neto de la pantalla, no
                se toma `ficha.margen_pct`: esa lo trae calculado con el
                neto guardado y quedaría desfasado mientras se captura.
              */}
              {hayVenta && (
                <tr>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    Margen de la ficha
                    <span className="ml-1.5 text-[11px]">sobre el neto</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {`${((100 * (venta - neto)) / venta).toFixed(2)}%`}
                  </td>
                </tr>
              )}
              {hayVenta && piezas != null && piezas > 0 && (
                <tr className="border-t border-border">
                  <td className="px-3 py-1.5 font-medium">
                    Utilidad del pedido
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {piezas} piezas
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-semibold tabular-nums",
                      utilidad < 0 && "text-destructive",
                      utilidad > 0 && "text-emerald-700",
                    )}
                  >
                    {money(utilidad * piezas)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hayVenta && utilidad < 0 && (
        <p className="mt-2 text-xs font-medium text-destructive">
          El costo total supera el precio de venta: cada pieza pierde{" "}
          {money(-utilidad)}.
        </p>
      )}
      {!hayVenta && (
        <p className="mt-2 text-xs text-muted-foreground">
          Captura el precio de venta arriba para ver la utilidad.
        </p>
      )}
    </section>
  )
}

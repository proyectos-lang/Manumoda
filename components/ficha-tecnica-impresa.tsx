"use client"

import { useEffect } from "react"
import { Printer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FichaMaterial, FichaTalla, VwFichaTecnica } from "@/lib/types"

/**
 * La ficha técnica como hoja imprimible.
 *
 * Reproduce el layout del sistema anterior para que el PDF salga igual:
 * datos generales arriba con la foto a la izquierda, los dos cuadros de
 * tallas, la franja de costos, y los dos cuadros de materiales.
 *
 * SOBRE EL PDF:
 *   Se imprime con `window.print()` y el navegador guarda como PDF. No
 *   se usa una librería: sumaría ~300 KB al bundle y produciría un
 *   layout distinto al de la pantalla. El CSS `@media print` oculta
 *   todo lo que no es la hoja, igual que en las etiquetas de rollos.
 *
 * Todo aquí es de solo lectura: es el papel, no el formulario.
 */

function money(v: number | null | undefined): string {
  if (v == null) return ""
  return `$ ${Number(v).toFixed(2)}`
}

/**
 * Fecha en el formato de la ficha: 24/07/2026.
 *
 * Se parte la cadena en vez de usar Date: `new Date("2026-07-24")` se
 * interpreta como UTC y en México imprimiría el día anterior.
 */
function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return ""
  const [a, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${a}`
}

function sumaFila(f: FichaTalla): number {
  return Object.values(f.cantidades ?? {}).reduce((a, b) => a + Number(b || 0), 0)
}

export function FichaTecnicaImpresa({
  ficha,
  tallas,
  materiales,
  columnasTalla,
  fotoUrl,
  onCerrar,
}: {
  ficha: VwFichaTecnica
  tallas: FichaTalla[]
  materiales: FichaMaterial[]
  columnasTalla: string[]
  fotoUrl: string | null
  onCerrar: () => void
}) {
  // Escape cierra la vista de impresión: es lo que espera quien la abrió
  // solo para ver cómo va a salir.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onCerrar])

  const espec = tallas.filter((t) => t.bloque === "Especificacion")
  const cortadas = tallas.filter((t) => t.bloque === "Cortadas")
  const telas = materiales.filter((m) => m.tipo === "Tela")
  const habilitacion = materiales.filter((m) => m.tipo === "Habilitacion")

  const totalTela = telas.reduce(
    (s, m) => s + Number(m.cantidad || 0) * Number(m.costo || 0), 0)
  const totalHab = habilitacion.reduce(
    (s, m) => s + Number(m.cantidad || 0) * Number(m.costo || 0), 0)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 print:static print:overflow-visible print:bg-transparent print:p-0">
      <div className="mx-auto w-full max-w-5xl rounded-xl border border-border bg-white shadow-xl print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        {/* Barra de acciones: no sale en el papel */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 print:hidden">
          <h2 className="text-sm font-semibold">Vista de impresión · folio {ficha.folio}</h2>
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
              <Printer className="size-4" />
              Imprimir / Guardar PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={onCerrar}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* ── La hoja ── */}
        <div className="p-6 text-[11px] text-black print:p-0">
          {/* El logo a la izquierda y el título centrado, como el original */}
          <div className="mb-3 flex items-start justify-between">
            <h1 className="text-xl font-bold leading-none tracking-tight text-purple-900">
              MANUFACTURAS
              <br />
              DE LA MODA
            </h1>
            <span className="pr-24 pt-2 text-sm font-bold">FICHA TECNICA</span>
            <span />
          </div>

          {/* Datos generales + foto */}
          <div className="flex gap-4">
            <div className="w-[170px] shrink-0">
              {fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotoUrl}
                  alt="Prenda"
                  className="max-h-[200px] w-full border border-black/30 object-contain"
                />
              ) : (
                <div className="flex h-[200px] items-center justify-center border border-dashed border-black/30 text-[10px] text-black/40">
                  Sin foto
                </div>
              )}
            </div>

            <div className="flex-1">
              <Par label="Razon Social" value={ficha.razon_social}
                   label2="Marca" value2={ficha.marca} />
              <Par label="Compradora" value={ficha.compradora}
                   label2="Num Pedido" value2={ficha.num_pedido} />
              <Par label="Modelo Interno" value={ficha.modelo}
                   label2="Modelo Cliente" value2={ficha.modelo_cliente} />
              <div className="mt-1">
                <div className="text-[10px] font-bold">Descripcion Completa</div>
                <div className="border border-black/50 px-1 py-0.5 font-medium">
                  {ficha.descripcion_completa ?? " "}
                </div>
              </div>
            </div>
          </div>

          {/* Tallas */}
          <CuadroTallasImpreso titulo="Especificacion de Talla" filas={espec}
                               columnas={columnasTalla} />
          <CuadroTallasImpreso titulo="Piezas Cortadas" filas={cortadas}
                               columnas={columnasTalla} />

          {/*
            Las dos fechas van en su propio renglón, arriba de los costos,
            como en la ficha original: son del pedido, no del costeo.
          */}
          <div className="mt-3 grid grid-cols-2 gap-8">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold">Fecha confirmacion</span>
              <span className="flex-1 border border-black/50 px-1 py-0.5 text-center font-medium">
                {fmtFecha(ficha.fecha_confirmacion)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold">Fecha Cancelacion</span>
              <span className="flex-1 border border-black/50 px-1 py-0.5 text-center font-medium">
                {fmtFecha(ficha.fecha_cancelacion)}
              </span>
            </div>
          </div>

          {/*
            La franja de costeo, con el Margen como una columna más: es como
            se lee en la ficha original, entre Precio Venta y Precio Publico.
          */}
          <div className="mt-1 grid grid-cols-5 border border-black/50 text-center">
            <Celda titulo="Costo Fijo" valor={money(ficha.costo_fijo)} />
            <Celda titulo="Costo Neto" valor={money(ficha.costo_neto)} />
            <Celda titulo="Precio Venta" valor={money(ficha.precio_venta)} />
            <Celda
              titulo="Margen"
              valor={
                ficha.margen_pct == null ? "" : Number(ficha.margen_pct).toFixed(2)
              }
            />
            <Celda titulo="Precio Publico" valor={money(ficha.precio_publico)} />
          </div>

          {/* Materiales */}
          <CuadroMaterialesImpreso titulo="Composicion por Color y Tela" filas={telas}
                                   total={totalTela} conColor />
          <CuadroMaterialesImpreso titulo="Habilitacion" filas={habilitacion}
                                   total={totalHab} />
        </div>
      </div>

      {/*
        Al imprimir solo debe salir el papel: el fondo, el sidebar y los
        botones estorban y gastan tinta. Mismo patrón que las etiquetas
        de rollos.
      */}
      <style jsx global>{`
        @media print {
          body > *:not(:last-child) {
            display: none !important;
          }
          @page {
            size: letter portrait;
            margin: 8mm;
          }
        }
      `}</style>
    </div>
  )
}

function Par({
  label, value, label2, value2,
}: {
  label: string; value: string | null
  label2: string; value2: string | null
}) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-2">
      <div>
        <div className="text-[10px] font-bold">{label}</div>
        <div className="border border-black/50 px-1 py-0.5 font-medium">
          {value ?? " "}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-bold">{label2}</div>
        <div className="border border-black/50 px-1 py-0.5 font-medium">
          {value2 ?? " "}
        </div>
      </div>
    </div>
  )
}

function Celda({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="border-r border-black/50 last:border-r-0">
      <div className="border-b border-black/50 bg-black/5 px-1 py-0.5 text-[9px] font-bold">
        {titulo}
      </div>
      <div className="px-1 py-1 font-medium tabular-nums">{valor || " "}</div>
    </div>
  )
}

function CuadroTallasImpreso({
  titulo, filas, columnas,
}: {
  titulo: string
  filas: FichaTalla[]
  columnas: string[]
}) {
  const total = filas.reduce((s, f) => s + sumaFila(f), 0)
  return (
    <div className="mt-3 print:break-inside-avoid">
      <div className="text-[10px] font-bold">{titulo}</div>
      <table className="w-full border-collapse border border-black/50">
        <thead>
          <tr className="bg-black/5">
            <th className="border border-black/50 px-1 py-0.5 text-left">Color&amp;Talla</th>
            {columnas.map((c) => (
              <th key={c} className="border border-black/50 px-1 py-0.5 text-center">{c}</th>
            ))}
            <th className="border border-black/50 px-1 py-0.5 text-center">Total</th>
            <th className="border border-black/50 px-1 py-0.5 text-center">Proporcion</th>
          </tr>
          {/*
            La proporción del tendido, una por talla. Va como renglón bajo los
            encabezados, igual que en la ficha original. Se toma del primer
            color capturado: la proporción es del tendido, no del color.
          */}
          <tr>
            <td className="border border-black/50 px-1 py-0.5 text-[10px] font-bold">
              Proporcion
            </td>
            {columnas.map((c) => (
              <td
                key={c}
                className="border border-black/50 px-1 py-0.5 text-center tabular-nums"
              >
                {filas[0]?.proporciones?.[c] ?? ""}
              </td>
            ))}
            <td className="border border-black/50" />
            <td className="border border-black/50" />
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={columnas.length + 3}
                  className="border border-black/50 px-1 py-2 text-center text-black/40">
                Sin captura
              </td>
            </tr>
          ) : (
            filas.map((f) => (
              <tr key={f.id}>
                <td className="border border-black/50 px-1 py-0.5 font-medium">{f.color}</td>
                {columnas.map((c) => (
                  <td key={c} className="border border-black/50 px-1 py-0.5 text-center tabular-nums">
                    {f.cantidades?.[c] ?? 0}
                  </td>
                ))}
                <td className="border border-black/50 px-1 py-0.5 text-center font-medium tabular-nums">
                  {sumaFila(f)}
                </td>
                <td className="border border-black/50 px-1 py-0.5 text-center tabular-nums">
                  {f.proporcion ?? ""}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-black/5">
            <td colSpan={columnas.length + 1}
                className="border border-black/50 px-1 py-0.5 text-right font-bold">
              Piezas Totales
            </td>
            <td className="border border-black/50 px-1 py-0.5 text-center font-bold tabular-nums">
              {total}
            </td>
            <td className="border border-black/50" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function CuadroMaterialesImpreso({
  titulo, filas, total, conColor,
}: {
  titulo: string
  filas: FichaMaterial[]
  total: number
  conColor?: boolean
}) {
  return (
    <div className="mt-3 print:break-inside-avoid">
      <div className="text-[10px] font-bold">{titulo}</div>
      <table className="w-full border-collapse border border-black/50">
        <thead>
          <tr className="bg-black/5">
            <th className="border border-black/50 px-1 py-0.5 text-left">CLAVE</th>
            {conColor && <th className="border border-black/50 px-1 py-0.5 text-left">COLOR</th>}
            <th className="border border-black/50 px-1 py-0.5 text-left">DESCRIPCION</th>
            <th className="border border-black/50 px-1 py-0.5 text-right">CANTIDAD</th>
            <th className="border border-black/50 px-1 py-0.5 text-right">COSTO</th>
            <th className="border border-black/50 px-1 py-0.5 text-right">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={conColor ? 6 : 5}
                  className="border border-black/50 px-1 py-2 text-center text-black/40">
                Sin captura
              </td>
            </tr>
          ) : (
            filas.map((m) => (
              <tr key={m.id}>
                <td className="border border-black/50 px-1 py-0.5">{m.clave ?? ""}</td>
                {conColor && (
                  <td className="border border-black/50 px-1 py-0.5">{m.color ?? ""}</td>
                )}
                <td className="border border-black/50 px-1 py-0.5">{m.descripcion}</td>
                <td className="border border-black/50 px-1 py-0.5 text-right tabular-nums">
                  {Number(m.cantidad || 0)}
                </td>
                <td className="border border-black/50 px-1 py-0.5 text-right tabular-nums">
                  {money(m.costo)}
                </td>
                <td className="border border-black/50 px-1 py-0.5 text-right tabular-nums">
                  {money(Number(m.cantidad || 0) * Number(m.costo || 0))}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-black/5">
            <td colSpan={conColor ? 5 : 4}
                className="border border-black/50 px-1 py-0.5 text-right font-bold">
              Total
            </td>
            <td className="border border-black/50 px-1 py-0.5 text-right font-bold tabular-nums">
              {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

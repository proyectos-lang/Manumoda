"use client"

import { useMemo } from "react"
import { Printer, X as XIcon } from "lucide-react"

import { qrComoSVG } from "@/lib/qr"
import type { VwInventarioRollo } from "@/lib/types"

import { Button } from "@/components/ui/button"

/**
 * Etiquetas de rollo, listas para imprimir y pegar.
 *
 * Cada una lleva el QR con el código del rollo, la tela y los metros con
 * que entró. Se imprime desde el navegador: no hace falta un servicio de
 * etiquetas ni un formato propietario.
 *
 * Los metros que se muestran son los INICIALES, no el saldo: la etiqueta
 * se pega una vez y el papel no se actualiza. El saldo vivo se consulta
 * escaneando el código.
 */
export function EtiquetasRollosDialog({
  rollos,
  onClose,
}: {
  rollos: VwInventarioRollo[]
  onClose: () => void
}) {
  const etiquetas = useMemo(
    () =>
      rollos.map((r) => ({
        rollo: r,
        svg: qrComoSVG(r.codigo, 150),
      })),
    [rollos],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:bg-transparent print:p-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-card shadow-xl print:max-h-none print:w-full print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 print:hidden">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Etiquetas de rollo
            </h3>
            <p className="text-xs text-muted-foreground">
              {rollos.length} {rollos.length === 1 ? "etiqueta" : "etiquetas"} · se
              imprimen 2 por fila
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => window.print()}
              className="gap-1.5 bg-teal-600 text-white hover:bg-teal-700"
            >
              <Printer className="size-3.5" />
              Imprimir
            </Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={onClose}>
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 print:overflow-visible print:p-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
            {etiquetas.map(({ rollo, svg }) => (
              <div
                key={rollo.id}
                className="flex items-center gap-4 rounded-lg border-2 border-dashed border-border p-4 print:break-inside-avoid print:border-solid print:border-black/40"
              >
                <div
                  className="shrink-0"
                  // El SVG lo genera `qrComoSVG` a partir del código del rollo,
                  // que es texto nuestro: no hay entrada de usuario sin escapar.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-base font-bold leading-tight text-black">
                    {rollo.codigo}
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-black">
                    {rollo.articulo_nombre}
                  </p>
                  <p className="truncate font-mono text-xs text-neutral-600">
                    {rollo.articulo_clave}
                  </p>
                  <p className="mt-2 text-lg font-bold tabular-nums text-black">
                    {Number(rollo.metros_inicial).toLocaleString("es-MX", {
                      maximumFractionDigits: 3,
                    })}{" "}
                    m
                  </p>
                  {rollo.proveedor && (
                    <p className="truncate text-xs text-neutral-600">{rollo.proveedor}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*
        Al imprimir solo debe salir el papel: la pantalla de fondo, el sidebar
        y los botones estorban y gastan tinta.
      */}
      <style jsx global>{`
        @media print {
          body > *:not(:last-child) {
            display: none !important;
          }
          @page {
            margin: 10mm;
          }
        }
      `}</style>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { VwInventarioArticulo } from "@/lib/types"

/**
 * Buscador de telas del catálogo, por clave o por nombre.
 *
 * POR QUÉ NO UN <Select> NORMAL:
 *   Son 756 telas. Una lista desplegable simple obliga a recorrerlas
 *   todas con la rueda del ratón; lo único práctico es teclear parte de
 *   la clave y filtrar.
 *
 *   Tampoco se cargan las 756 en el DOM: se muestran las primeras 50
 *   coincidencias. Pintar cientos de renglones hace lento el teclear, y
 *   quien busca ya escribió lo suficiente para reconocer la suya.
 *
 * SIGUE ACEPTANDO TEXTO LIBRE:
 *   Si la tela todavía no está en el catálogo, se puede escribir la
 *   clave a mano. La ficha se captura antes de que Inventarios tenga
 *   todo dado de alta, y exigir el vínculo impediría capturar.
 */

export function BuscadorTela({
  valor,
  telas,
  onSelect,
  disabled,
  placeholder = "Buscar por clave o nombre…",
}: {
  /** La clave actual, venga del catálogo o escrita a mano. */
  valor: string | null
  telas: VwInventarioArticulo[]
  /** Devuelve la tela elegida, o solo la clave si se escribió a mano. */
  onSelect: (tela: VwInventarioArticulo | null, claveManual: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const caja = useRef<HTMLDivElement>(null)

  // Cerrar al hacer clic fuera. Sin esto la lista queda flotando sobre
  // el resto del formulario y estorba.
  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener("mousedown", fuera)
    return () => document.removeEventListener("mousedown", fuera)
  }, [abierto])

  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return telas.slice(0, 50)
    return telas
      .filter((t) =>
        `${t.clave} ${t.nombre} ${t.tela_familia ?? ""} ${t.tela_color ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 50)
  }, [telas, busqueda])

  const elegida = useMemo(
    () => telas.find((t) => t.clave === valor) ?? null,
    [telas, valor],
  )

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setAbierto((v) => !v)
          setBusqueda("")
        }}
        className={cn(
          "flex h-7 w-full min-w-[150px] items-center gap-1 rounded-md border border-input bg-transparent px-2 text-left text-xs",
          "hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50",
        )}
        title={elegida ? elegida.nombre : valor ?? "Sin tela"}
      >
        <span className={cn("flex-1 truncate font-mono", !valor && "text-muted-foreground")}>
          {valor || "Elegir tela…"}
        </span>
        {valor && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Quitar la tela"
            className="shrink-0 rounded p-0.5 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(null, "")
            }}
          >
            <X className="size-3 text-muted-foreground" />
          </span>
        )}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      {abierto && (
        <div className="absolute z-50 mt-1 w-[420px] max-w-[85vw] rounded-lg border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAbierto(false)
                  // Enter con texto que no está en el catálogo: se acepta
                  // como clave manual.
                  if (e.key === "Enter" && resultados.length === 0 && busqueda.trim()) {
                    onSelect(null, busqueda.trim().toUpperCase())
                    setAbierto(false)
                  }
                }}
                placeholder={placeholder}
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {resultados.length === 0 ? (
              <div className="p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  Ninguna tela coincide.
                </p>
                {busqueda.trim() && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-medium text-primary hover:underline"
                    onClick={() => {
                      onSelect(null, busqueda.trim().toUpperCase())
                      setAbierto(false)
                    }}
                  >
                    Usar “{busqueda.trim().toUpperCase()}” como clave
                  </button>
                )}
              </div>
            ) : (
              resultados.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onSelect(t, t.clave)
                    setAbierto(false)
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-muted",
                    t.clave === valor && "bg-muted",
                  )}
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      t.clave === valor ? "text-primary" : "invisible",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs font-semibold">
                      {t.clave}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t.nombre}
                      {t.costo_unitario != null && (
                        <span className="ml-1 tabular-nums">
                          · ${Number(t.costo_unitario).toFixed(2)}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          {telas.length > resultados.length && (
            <div className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
              {resultados.length} de {telas.length} · escribe para filtrar
            </div>
          )}
        </div>
      )}
    </div>
  )
}

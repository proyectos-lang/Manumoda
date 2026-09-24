"use client"

import { useEffect, useState } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupabase } from "@/lib/supabase/client"
import { useReadOnly } from "@/lib/auth-context"

/**
 * Corregir los precios de una orden ya creada.
 *
 * POR QUÉ AQUÍ Y NO EN LA FICHA:
 *   Los precios se capturan al crear el pedido —son condición
 *   comercial, no dato de producción— y la ficha solo los lee para
 *   calcular margen y utilidad. Pero las 638 órdenes que ya existen
 *   nacieron antes de esa regla, y muchas traen el precio del Excel o
 *   en blanco: sin un sitio donde corregirlo, quedarían congeladas.
 *
 * EL PRECIO DE VENTA NO ES SOLO INFORMATIVO:
 *   Pago Maquilas lo usa para descontar las piezas no entregadas. Un
 *   precio mal capturado no solo descuadra el margen de la ficha:
 *   cambia lo que se le paga al maquilero. Por eso se avisa.
 *
 * VACÍO BORRA EL PRECIO:
 *   Dejar el campo en blanco guarda NULL, no cero. Un cero diría "esta
 *   prenda se vende gratis" y Pago Maquilas descontaría $0 por pieza
 *   no entregada, que es una afirmación distinta de "no lo sé".
 */

export function EditarPreciosDialog({
  orden,
  onOpenChange,
  onGuardado,
}: {
  /**
   * La orden a editar, o null si el diálogo está cerrado.
   *
   * El `id` llega como `string | number` porque así lo declara
   * `OrdenProduccion`: la fila puede venir del Excel, donde todo es
   * texto. Se normaliza al guardar.
   */
  orden: {
    id: string | number
    folio: string
    modelo: string | null
    precio_venta: number | null
    precio_publico: number | null
  } | null
  onOpenChange: (v: boolean) => void
  onGuardado: () => void
}) {
  const [venta, setVenta] = useState("")
  const [publico, setPublico] = useState("")
  const [guardando, setGuardando] = useState(false)
  const readOnly = useReadOnly()

  // Se recargan al cambiar de orden: sin esto, abrir una segunda orden
  // mostraría los precios de la primera.
  useEffect(() => {
    setVenta(orden?.precio_venta != null ? String(orden.precio_venta) : "")
    setPublico(orden?.precio_publico != null ? String(orden.precio_publico) : "")
  }, [orden])

  if (!orden) return null

  async function guardar() {
    if (!orden) return
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({
        // Vacío = NULL, no cero: "no lo sé" y "se vende en $0" son
        // afirmaciones distintas, y Pago Maquilas las trata distinto.
        precio_venta: venta.trim() === "" ? null : Number(venta),
        precio_publico: publico.trim() === "" ? null : Number(publico),
      })
      .eq("id", orden.id)
    setGuardando(false)
    if (error) {
      toast.error("No se pudieron guardar los precios", {
        description: error.message,
      })
      return
    }
    toast.success(`Precios de ${orden.folio} actualizados`)
    onOpenChange(false)
    onGuardado()
  }

  const cambioVenta =
    (venta.trim() === "" ? null : Number(venta)) !==
    (orden.precio_venta != null ? Number(orden.precio_venta) : null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">Precios de {orden.folio}</h2>
            <p className="text-xs text-muted-foreground">
              {orden.modelo ?? "Sin modelo"}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Precio de venta
            </label>
            <Input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={venta}
              onChange={(e) => setVenta(e.target.value)}
              placeholder="Sin precio"
              disabled={readOnly}
              className="sin-flechas mt-1 h-9 text-right tabular-nums"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Precio público
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={publico}
              onChange={(e) => setPublico(e.target.value)}
              placeholder="Sin precio"
              disabled={readOnly}
              className="sin-flechas mt-1 h-9 text-right tabular-nums"
            />
          </div>

          {/*
            El aviso sale solo cuando el precio de venta cambia: si se
            corrige el precio público nada más, no hay nada que advertir.
          */}
          {cambioVenta && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-900">
                El precio de venta también se usa en{" "}
                <span className="font-medium">Pago Maquilas</span> para
                descontar las piezas no entregadas.
              </p>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Dejar un campo vacío borra el precio. El margen y la utilidad de
            la ficha se recalculan con lo que se guarde aquí.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={guardando}
          >
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={readOnly || guardando}>
            {guardando && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </div>
    </div>
  )
}

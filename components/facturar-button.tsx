"use client"

/**
 * Marca una orden como facturada (entregada) o revierte la marca.
 *
 * Una orden facturada cierra su ciclo: deja de contar como vencida y
 * deja de generar alertas, sin importar su fecha de entrega original.
 *
 * Solo se ofrece a partir de S7 — no tiene sentido facturar algo que
 * todavía está en producción.
 */

import { useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Loader2, PackageCheck, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { parseLocalDate } from "@/lib/risk"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** ¿La orden ya llegó a la etapa donde tiene sentido facturar? */
export function puedeFacturarse(faseActual: string | null | undefined): boolean {
  return faseActual === "S7"
}

/** Etiqueta de estatus a mostrar: "Entregado" reemplaza a la fase. */
export function estatusVisible(
  faseActual: string | null | undefined,
  fechaFacturacion: string | null | undefined,
): string {
  return fechaFacturacion ? "Entregado" : (faseActual ?? "—")
}

export function FacturarButton({
  folio,
  ordenId,
  faseActual,
  fechaFacturacion,
  onDone,
  size = "sm",
  className,
}: {
  folio: string | null
  ordenId: number | string | null | undefined
  faseActual: string | null | undefined
  fechaFacturacion: string | null | undefined
  /** Se llama tras guardar, con la nueva fecha (null si se revirtió). */
  onDone: (nuevaFecha: string | null) => void
  size?: "sm" | "xs"
  className?: string
}) {
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const facturada = Boolean(fechaFacturacion)

  // Antes de S7 no se ofrece la acción
  if (!facturada && !puedeFacturarse(faseActual)) return null

  const guardar = async (nuevaFecha: string | null) => {
    if (ordenId == null) return
    const supabase = getSupabase()
    if (!supabase) return
    setConfirmOpen(false)
    setSaving(true)
    try {
      const { error } = await supabase
        .from("ordenes_produccion")
        .update({ fecha_facturacion: nuevaFecha })
        .eq("id", ordenId)
        .eq("idempresa", IDEMPRESA)
      if (error) {
        toast.error(
          nuevaFecha ? "No se pudo marcar como facturada" : "No se pudo revertir la facturación",
          { description: error.message },
        )
        return
      }
      toast.success(
        nuevaFecha
          ? `Folio ${folio ?? ""} marcado como entregado`
          : `Folio ${folio ?? ""} ya no figura como facturado`,
        {
          description: nuevaFecha
            ? "Deja de contar como vencido y no generará más alertas."
            : "Vuelve a evaluarse contra su fecha de entrega.",
        },
      )
      onDone(nuevaFecha)
    } catch (err) {
      toast.error("Error inesperado", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  // Ya facturada: se ofrece revertir
  if (facturada) {
    const d = parseLocalDate(fechaFacturacion)
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => guardar(null)}
        disabled={saving}
        title={
          d
            ? `Facturada el ${format(d, "dd MMM yyyy", { locale: es })} — clic para revertir`
            : "Clic para revertir la facturación"
        }
        className={cn(
          "gap-1.5 text-violet-700 hover:bg-violet-50 hover:text-violet-800",
          size === "xs" ? "h-7 px-2 text-xs" : "h-8 px-2 text-xs",
          className,
        )}
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        Revertir
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={saving}
        title="Marcar como facturada — cierra el ciclo de la orden"
        className={cn(
          "gap-1.5 border-violet-300 bg-transparent text-violet-700 hover:bg-violet-50 hover:text-violet-800",
          size === "xs" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-xs",
          className,
        )}
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <PackageCheck className="size-3.5" />
        )}
        Facturado
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Marcar el folio {folio} como facturado?</AlertDialogTitle>
            <AlertDialogDescription>
              La orden pasará a estatus <strong>Entregado</strong>. Dejará de contar como
              vencida y no volverá a aparecer en las alertas de vencimiento. Se puede revertir
              después si hace falta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => guardar(format(new Date(), "yyyy-MM-dd"))}
              className="bg-violet-600 hover:bg-violet-700"
            >
              Marcar facturado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Badge compacto de "Entregado" para tablas. */
export function EntregadoBadge({ fechaFacturacion }: { fechaFacturacion: string | null | undefined }) {
  if (!fechaFacturacion) return null
  const d = parseLocalDate(fechaFacturacion)
  return (
    <span
      title={d ? `Facturada el ${format(d, "dd MMM yyyy", { locale: es })}` : undefined}
      className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700"
    >
      <PackageCheck className="size-3" />
      Entregado
    </span>
  )
}

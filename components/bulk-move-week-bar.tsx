"use client"

/**
 * Barra de acción masiva para mover registros de una semana a otra.
 * Se usa en Diseño (diseno_programacion) y Corte (corte_programacion).
 *
 * Los registros ya cumplidos NO se pueden mover: sus horas ya contaron
 * en los bonos de su semana y moverlos alteraría liquidaciones cerradas.
 * Sus checkboxes quedan deshabilitados.
 */

import { useState } from "react"
import { ArrowRightLeft, Loader2, Lock, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export function BulkMoveWeekBar({
  selectedCount,
  lockedCount,
  onClear,
  onMove,
  moving,
  entidad,
  className,
}: {
  selectedCount: number
  /** Registros visibles bloqueados por estar ya cumplidos (no seleccionables). */
  lockedCount: number
  onClear: () => void
  onMove: (semana: number) => Promise<void> | void
  moving: boolean
  /** "órdenes de diseño" | "registros de corte" — para los textos. */
  entidad: string
  className?: string
}) {
  const [semana, setSemana] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (selectedCount === 0) return null

  const semanaNum = Number(semana)
  const semanaValida = semana !== "" && !isNaN(semanaNum) && semanaNum >= 1 && semanaNum <= 53

  const confirmar = async () => {
    setConfirmOpen(false)
    await onMove(semanaNum)
    setSemana("")
  }

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl border border-indigo-300 bg-indigo-50/80 px-4 py-3 shadow-sm",
          className,
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200">
          <ArrowRightLeft className="size-4" />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-indigo-900">
            {selectedCount} {selectedCount === 1 ? "registro seleccionado" : "registros seleccionados"}
          </p>
          {lockedCount > 0 && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="size-3 shrink-0" />
              {lockedCount} {lockedCount === 1 ? "cumplido queda bloqueado" : "cumplidos quedan bloqueados"}
            </p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="bulk-semana" className="text-xs font-medium text-indigo-900">
            Mover a semana
          </label>
          <Input
            id="bulk-semana"
            type="number"
            min={1}
            max={53}
            value={semana}
            onChange={(e) => setSemana(e.target.value)}
            placeholder="Nº"
            className="h-9 w-20 bg-white"
          />
          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={!semanaValida || moving}
            className="h-9 gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {moving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRightLeft className="size-3.5" />}
            Mover
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={moving}
            className="h-9 gap-1 text-muted-foreground"
          >
            <X className="size-3.5" />
            Cancelar
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Mover {selectedCount} {entidad} a la semana {semanaNum}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se actualizará la semana de {selectedCount}{" "}
              {selectedCount === 1 ? "registro" : "registros"}. La semana original se conserva
              como referencia. Los registros ya cumplidos no se ven afectados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar} className="bg-indigo-600 hover:bg-indigo-700">
              Mover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Checkbox de selección para la cabecera (selecciona/deselecciona todo lo visible). */
export function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (v: boolean) => void
  title?: string
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate }}
      onChange={(e) => onChange(e.target.checked)}
      title={title ?? "Seleccionar todo"}
      className="size-4 cursor-pointer rounded border-border accent-indigo-600"
    />
  )
}

/**
 * Checkbox de selección por fila.
 * `disabled` se usa para bloquear registros ya cumplidos — se muestra
 * un candado en su lugar para que el motivo sea evidente.
 */
export function RowCheckbox({
  checked,
  onChange,
  disabled,
  disabledTitle,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  disabledTitle?: string
}) {
  if (disabled) {
    return (
      <span
        title={disabledTitle ?? "Registro cumplido — no se puede mover de semana"}
        className="flex size-4 items-center justify-center text-muted-foreground/40"
      >
        <Lock className="size-3" />
      </span>
    )
  }
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="size-4 cursor-pointer rounded border-border accent-indigo-600"
    />
  )
}

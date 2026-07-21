"use client"

/**
 * Chip del filtro con el que se abrió el módulo desde el inicio.
 *
 * Hace visible POR QUÉ la tabla muestra menos registros de lo normal
 * y permite volver a la vista completa con un clic.
 */

import { Filter, X } from "lucide-react"

import { MODULE_FILTER_LABEL, type ModuleFilter } from "@/lib/module-filter"
import { cn } from "@/lib/utils"

export function IncomingFilterChip({
  filter,
  onClear,
  className,
}: {
  filter: ModuleFilter | null
  onClear: () => void
  className?: string
}) {
  if (!filter) return null
  return (
    <button
      type="button"
      onClick={onClear}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100",
        className,
      )}
      title="Quitar este filtro y ver todos los registros"
    >
      <Filter className="size-3" />
      {MODULE_FILTER_LABEL[filter]}
      <X className="size-3" />
    </button>
  )
}

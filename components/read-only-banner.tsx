"use client"

/**
 * Aviso permanente para las sesiones de solo lectura.
 *
 * El bloqueo real de escrituras vive en `lib/supabase/client.ts`; este
 * banner existe para que la persona entienda por qué los controles de
 * edición están apagados en vez de creer que la app está rota.
 */

import { Eye } from "lucide-react"

import { useReadOnly } from "@/lib/auth-context"

export function ReadOnlyBanner() {
  if (!useReadOnly()) return null

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 ring-1 ring-sky-200">
        <Eye className="size-3.5" />
      </span>
      <p className="text-xs text-sky-900">
        <span className="font-semibold">Modo solo lectura.</span>{" "}
        Puedes consultar y descargar la información, pero no crear, editar ni eliminar registros.
      </p>
    </div>
  )
}

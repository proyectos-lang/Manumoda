"use client"

/**
 * Gate de contraseña para acciones sensibles (cambiar fechas, editar
 * multiplicadores/variables). Es un gate de FRICCIÓN del lado del cliente
 * —la contraseña vive en el bundle— no seguridad real.
 *
 * Uso con el hook:
 *   const gate = usePasswordGate()
 *   ...
 *   <Button onClick={() => gate.request(() => hacerAlgo())}>Editar</Button>
 *   <gate.Dialog />
 */

import { useCallback, useRef, useState } from "react"
import { KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Contraseña de edición. */
const EDIT_PASSWORD = "Cambio123"

export function usePasswordGate() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState(false)
  const pending = useRef<(() => void) | null>(null)

  /** Pide la contraseña; si es correcta ejecuta `onConfirm`. */
  const request = useCallback((onConfirm: () => void) => {
    pending.current = onConfirm
    setValue("")
    setError(false)
    setOpen(true)
  }, [])

  const submit = useCallback(() => {
    if (value === EDIT_PASSWORD) {
      const fn = pending.current
      pending.current = null
      setOpen(false)
      fn?.()
    } else {
      setError(true)
    }
  }, [value])

  const DialogEl = useCallback(
    () => (
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); pending.current = null } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-violet-600" />
              Confirmar con contraseña
            </DialogTitle>
            <DialogDescription>
              Esta acción requiere la contraseña de edición.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              type="password"
              autoFocus
              value={value}
              placeholder="Contraseña"
              onChange={(e) => { setValue(e.target.value); setError(false) }}
              onKeyDown={(e) => { if (e.key === "Enter") submit() }}
              className={error ? "border-destructive focus-visible:ring-destructive/40" : ""}
            />
            {error && <p className="text-xs text-destructive">Contraseña incorrecta.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); pending.current = null }}>
              Cancelar
            </Button>
            <Button onClick={submit} className="bg-violet-600 hover:bg-violet-700">
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
    [open, value, error, submit],
  )

  return { request, Dialog: DialogEl }
}

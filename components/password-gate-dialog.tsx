"use client"

/**
 * Gate de contraseña para acciones sensibles (cambiar fechas, editar
 * multiplicadores/variables). Es un gate de FRICCIÓN del lado del cliente
 * —la contraseña vive en el bundle— no seguridad real.
 *
 * Uso:
 *   const gate = usePasswordGate()
 *   ...
 *   <Button onClick={() => gate.request(() => hacerAlgo())}>Editar</Button>
 *   {gate.dialog}
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

/**
 * Diálogo del gate. Vive a nivel de módulo (no dentro del hook) para que
 * su identidad de componente sea estable: si se recreara en cada render,
 * React desmontaría y volvería a montar el input con cada tecla, y el
 * cursor saltaría al final del texto.
 *
 * El estado del campo es interno: así escribir no re-renderiza al
 * componente que hospeda el gate.
 */
function PasswordGateDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean
  onCancel: () => void
  /** Devuelve true si la contraseña era correcta. */
  onConfirm: (value: string) => boolean
}) {
  const [value, setValue] = useState("")
  const [error, setError] = useState(false)

  // La contraseña solo se evalúa al confirmar (clic o Enter), nunca al teclear
  const submit = () => {
    if (onConfirm(value)) {
      setValue("")
      setError(false)
    } else {
      setError(true)
    }
  }

  const cancel = () => {
    setValue("")
    setError(false)
    onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) cancel() }}>
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
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit() }}
            className={error ? "border-destructive focus-visible:ring-destructive/40" : ""}
          />
          {error && <p className="text-xs text-destructive">Contraseña incorrecta.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>Cancelar</Button>
          <Button onClick={submit} className="bg-violet-600 hover:bg-violet-700">
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function usePasswordGate() {
  const [open, setOpen] = useState(false)
  const pending = useRef<(() => void) | null>(null)

  /** Pide la contraseña; si es correcta ejecuta `onConfirm`. */
  const request = useCallback((onConfirm: () => void) => {
    pending.current = onConfirm
    setOpen(true)
  }, [])

  const handleConfirm = useCallback((value: string) => {
    if (value !== EDIT_PASSWORD) return false
    const fn = pending.current
    pending.current = null
    setOpen(false)
    fn?.()
    return true
  }, [])

  const handleCancel = useCallback(() => {
    pending.current = null
    setOpen(false)
  }, [])

  return {
    request,
    dialog: (
      <PasswordGateDialog open={open} onCancel={handleCancel} onConfirm={handleConfirm} />
    ),
  }
}

"use client"

import { useEffect, useState } from "react"
import { Check, Loader2, Pencil, Plus, X as XIcon } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useReadOnly } from "@/lib/auth-context"
import { fmtCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CatPenalizacionMaquila } from "@/lib/types"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** Convierte un nombre en clave estable: "No apartó fecha" → no_aparto_fecha. */
function aClave(nombre: string): string {
  return nombre
    .normalize("NFD")
    // \p{Diacritic} en vez del rango literal U+0300–U+036F: son caracteres
    // combinantes y cualquier editor que normalice el archivo los borraría,
    // dejando el regex mudo sin que nada falle a la vista.
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
}

/**
 * Catálogo de penalizaciones de monto fijo.
 *
 * Cambiar un monto aquí NO reescribe los folios que ya la tienen marcada:
 * cada aplicación congela el monto vigente al momento de marcarse. Lo que
 * se edita aquí es lo que se aplicará de ahora en adelante.
 */
export function PenalizacionesCatalogoDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onChanged?: () => void
}) {
  const readOnly = useReadOnly()
  const [filas, setFilas] = useState<CatPenalizacionMaquila[]>([])
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [edit, setEdit] = useState<{ id: number; nombre: string; monto: string } | null>(null)
  const [nueva, setNueva] = useState<{ nombre: string; monto: string } | null>(null)

  const cargar = async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const { data, error } = await supabase
      .from("cat_penalizaciones_maquila")
      .select("*")
      .eq("idempresa", IDEMPRESA)
      .order("orden")
    setCargando(false)
    if (error) {
      toast.error("No se pudo cargar el catálogo", { description: error.message })
      return
    }
    setFilas((data as CatPenalizacionMaquila[]) ?? [])
  }

  useEffect(() => {
    if (open) cargar()
  }, [open])

  const guardarEdicion = async () => {
    if (!edit) return
    const monto = parseFloat(edit.monto)
    if (!edit.nombre.trim() || isNaN(monto) || monto < 0) {
      toast.error("Nombre y monto requeridos")
      return
    }
    setGuardando(true)
    const { error } = await getSupabase()!
      .from("cat_penalizaciones_maquila")
      .update({ nombre: edit.nombre.trim(), monto })
      .eq("id", edit.id)
      .eq("idempresa", IDEMPRESA)
    setGuardando(false)
    if (error) {
      toast.error("No se pudo guardar", { description: error.message })
      return
    }
    setEdit(null)
    await cargar()
    onChanged?.()
    toast.success("Penalización actualizada")
  }

  const alternarActivo = async (fila: CatPenalizacionMaquila) => {
    setGuardando(true)
    const { error } = await getSupabase()!
      .from("cat_penalizaciones_maquila")
      .update({ activo: !fila.activo })
      .eq("id", fila.id)
      .eq("idempresa", IDEMPRESA)
    setGuardando(false)
    if (error) {
      toast.error("No se pudo cambiar", { description: error.message })
      return
    }
    await cargar()
    onChanged?.()
    toast.success(
      fila.activo
        ? `${fila.nombre} ya no se ofrece; los folios que la tienen marcada la conservan`
        : `${fila.nombre} vuelve a estar disponible`,
    )
  }

  const agregar = async () => {
    if (!nueva) return
    const monto = parseFloat(nueva.monto)
    const nombre = nueva.nombre.trim()
    if (!nombre || isNaN(monto) || monto < 0) {
      toast.error("Nombre y monto requeridos")
      return
    }
    setGuardando(true)
    const { error } = await getSupabase()!.from("cat_penalizaciones_maquila").insert({
      idempresa: IDEMPRESA,
      clave: aClave(nombre),
      nombre,
      monto,
      orden: (filas.at(-1)?.orden ?? 0) + 10,
    })
    setGuardando(false)
    if (error) {
      toast.error("No se pudo agregar", {
        description: error.message.includes("ux_cat_penal")
          ? "Ya existe una penalización con ese nombre."
          : error.message,
      })
      return
    }
    setNueva(null)
    await cargar()
    onChanged?.()
    toast.success("Penalización agregada")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Penalizaciones de monto fijo</DialogTitle>
          <DialogDescription>
            Los conceptos que se marcan con check en la gestión del folio. La demora y las
            piezas no entregadas son automáticas y no se configuran aquí.
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="w-32 text-right">Monto</TableHead>
                  <TableHead className="w-24 text-center">Se ofrece</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) =>
                  edit?.id === f.id ? (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Input
                          value={edit.nombre}
                          onChange={(e) => setEdit((p) => p && { ...p, nombre: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="50"
                          value={edit.monto}
                          onChange={(e) => setEdit((p) => p && { ...p, monto: e.target.value })}
                          className="ml-auto h-8 w-28 text-right text-sm"
                        />
                      </TableCell>
                      <TableCell />
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={guardarEdicion}
                            disabled={guardando}
                          >
                            <Check className="size-3.5 text-emerald-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => setEdit(null)}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={f.id} className={cn(!f.activo && "opacity-50")}>
                      <TableCell className="text-sm">{f.nombre}</TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {fmtCurrency(Number(f.monto))}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={f.activo}
                          disabled={readOnly || guardando}
                          onCheckedChange={() => alternarActivo(f)}
                          aria-label={`Ofrecer ${f.nombre}`}
                        />
                      </TableCell>
                      <TableCell>
                        {!readOnly && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => {
                              setEdit({ id: f.id, nombre: f.nombre, monto: String(f.monto) })
                              setNueva(null)
                            }}
                          >
                            <Pencil className="size-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ),
                )}

                {nueva && (
                  <TableRow>
                    <TableCell>
                      <Input
                        autoFocus
                        placeholder="Nombre del concepto"
                        value={nueva.nombre}
                        onChange={(e) => setNueva((p) => p && { ...p, nombre: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="50"
                        placeholder="500"
                        value={nueva.monto}
                        onChange={(e) => setNueva((p) => p && { ...p, monto: e.target.value })}
                        className="ml-auto h-8 w-28 text-right text-sm"
                      />
                    </TableCell>
                    <TableCell />
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={agregar}
                          disabled={guardando}
                        >
                          <Check className="size-3.5 text-emerald-600" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setNueva(null)}
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {!readOnly && !nueva && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setNueva({ nombre: "", monto: "500" })
                  setEdit(null)
                }}
              >
                <Plus className="size-3.5" /> Agregar penalización
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              Cambiar un monto no reescribe los folios que ya tienen la penalización marcada:
              cada uno congeló el monto vigente al aplicarla. Un concepto que se deja de
              ofrecer tampoco borra los descuentos ya hechos.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

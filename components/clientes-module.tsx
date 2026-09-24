"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useReadOnly } from "@/lib/auth-context"
import type { VwCliente } from "@/lib/types"

/**
 * El módulo de clientes.
 *
 * INACTIVAR NO ES BORRAR:
 *   Un cliente con órdenes no se puede borrar —sus folios quedarían
 *   apuntando a nada— pero sí dejar de operar. Inactivarlo lo saca del
 *   desplegable al crear pedidos sin tocar su historia. El botón de
 *   borrar solo aparece cuando no tiene una sola orden, es decir cuando
 *   se creó por error.
 *
 *   La base lo respalda con ON DELETE RESTRICT: aunque alguien lo
 *   intente por SQL, no se lleva las órdenes por delante.
 *
 * EL NOMBRE SE COPIA A LA ORDEN:
 *   Al crear un pedido se guardan las dos cosas: `idcliente` manda y
 *   `cliente` conserva el nombre de ese momento. Renombrar un cliente
 *   no debe reescribir folios de hace dos años.
 */

type FormState = {
  nombre: string
  documento: string
  correo: string
  telefono: string
  notas: string
}

const FORM_VACIO: FormState = {
  nombre: "",
  documento: "",
  correo: "",
  telefono: "",
  notas: "",
}

const CAMPOS =
  "id, idempresa, nombre, documento, correo, telefono, activo, notas, created_at, ordenes, piezas, ultimo_pedido, se_puede_borrar"

/** dd/mm/aaaa. Se parte la cadena en vez de usar `new Date`: esa la lee
 *  como UTC y en México muestra el día anterior. */
function fmtFecha(iso: string | null): string {
  if (!iso) return "—"
  const [a, m, d] = iso.slice(0, 10).split("-")
  return d && m && a ? `${d}/${m}/${a}` : iso
}

export function ClientesModule({ configMissing }: { configMissing: boolean }) {
  const [clientes, setClientes] = useState<VwCliente[]>([])
  const [cargando, setCargando] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [verInactivos, setVerInactivos] = useState(false)

  const [dialogo, setDialogo] = useState(false)
  const [editando, setEditando] = useState<VwCliente | null>(null)
  const [form, setForm] = useState<FormState>(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)

  const [aBorrar, setABorrar] = useState<VwCliente | null>(null)
  const [borrando, setBorrando] = useState(false)

  const readOnly = useReadOnly()

  const cargar = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setCargando(true)
    const { data, error } = await supabase
      .from("vw_clientes")
      .select(CAMPOS)
      .eq("idempresa", IDEMPRESA)
      .order("nombre")
    if (error) {
      toast.error("No se pudieron cargar los clientes", {
        description: error.message,
      })
    } else {
      setClientes((data ?? []) as VwCliente[])
    }
    setCargando(false)
  }, [configMissing])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return clientes.filter((c) => {
      if (!verInactivos && !c.activo) return false
      if (!q) return true
      return [c.nombre, c.documento, c.correo, c.telefono]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [clientes, busqueda, verInactivos])

  const inactivos = clientes.filter((c) => !c.activo).length

  function abrirNuevo() {
    setEditando(null)
    setForm(FORM_VACIO)
    setDialogo(true)
  }

  function abrirEdicion(c: VwCliente) {
    setEditando(c)
    setForm({
      nombre: c.nombre,
      documento: c.documento ?? "",
      correo: c.correo ?? "",
      telefono: c.telefono ?? "",
      notas: c.notas ?? "",
    })
    setDialogo(true)
  }

  async function guardar() {
    if (!form.nombre.trim()) {
      toast.error("El nombre es obligatorio")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)
    try {
      // Vacío se guarda como NULL, no como "": la base distingue "sin
      // correo" de un texto en blanco, y el documento es único solo
      // cuando existe.
      const datos = {
        nombre: form.nombre.trim(),
        documento: form.documento.trim() || null,
        correo: form.correo.trim() || null,
        telefono: form.telefono.trim() || null,
        notas: form.notas.trim() || null,
      }

      if (editando) {
        const { error } = await supabase
          .from("clientes")
          .update(datos)
          .eq("id", editando.id)
        if (error) {
          toast.error("No se pudo actualizar", { description: mensaje(error) })
          return
        }
        toast.success("Cliente actualizado")
        // Se recarga en vez de parchear el estado: la vista trae
        // órdenes y piezas, que aquí no se saben calcular.
        await cargar()
      } else {
        const { error } = await supabase
          .from("clientes")
          .insert({ ...datos, idempresa: IDEMPRESA })
        if (error) {
          toast.error("No se pudo crear", { description: mensaje(error) })
          return
        }
        toast.success("Cliente creado")
        await cargar()
      }
      setDialogo(false)
    } finally {
      setGuardando(false)
    }
  }

  /** Traduce los errores de la base a algo que se entienda. */
  function mensaje(error: { code?: string; message: string }): string {
    if (error.code === "23505") {
      return "Ya existe un cliente con ese nombre o documento."
    }
    if (error.code === "23503") {
      return "El cliente tiene órdenes registradas."
    }
    return error.message
  }

  async function cambiarActivo(c: VwCliente) {
    const supabase = getSupabase()
    if (!supabase) return
    const activo = !c.activo
    const { error } = await supabase
      .from("clientes")
      .update({ activo })
      .eq("id", c.id)
    if (error) {
      toast.error("No se pudo cambiar el estado", { description: error.message })
      return
    }
    setClientes((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, activo } : x)),
    )
    toast.success(
      activo
        ? `${c.nombre} vuelve a estar activo`
        : `${c.nombre} quedó inactivo — ya no se ofrece al crear pedidos`,
    )
  }

  async function borrar() {
    if (!aBorrar) return
    const supabase = getSupabase()
    if (!supabase) return
    setBorrando(true)
    try {
      const { error } = await supabase
        .from("clientes")
        .delete()
        .eq("id", aBorrar.id)
      if (error) {
        toast.error("No se pudo eliminar", {
          description:
            error.code === "23503"
              ? "Tiene órdenes registradas. Inactívalo en vez de borrarlo."
              : error.message,
        })
        return
      }
      setClientes((prev) => prev.filter((x) => x.id !== aBorrar.id))
      toast.success("Cliente eliminado")
      setABorrar(null)
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Clientes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Quiénes hacen los pedidos. Un cliente con órdenes no se puede
          borrar, pero sí inactivar: deja de ofrecerse al crear pedidos y
          su historia queda intacta.
        </p>
      </div>

      {/* ── Barra de herramientas ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, documento, correo o teléfono"
            className="h-9 pl-8"
          />
        </div>

        {/*
          El interruptor solo aparece si hay alguno inactivo: si no, es
          una casilla que nunca cambia nada.
        */}
        {inactivos > 0 && (
          <Button
            variant={verInactivos ? "secondary" : "outline"}
            size="sm"
            onClick={() => setVerInactivos((v) => !v)}
          >
            {verInactivos ? "Ocultar" : "Ver"} inactivos ({inactivos})
          </Button>
        )}

        <Button size="sm" onClick={abrirNuevo} disabled={readOnly}>
          <Plus className="mr-1.5 size-4" />
          Nuevo cliente
        </Button>
      </div>

      {/* ── La tabla ── */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Nombre</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="text-right">Órdenes</TableHead>
              <TableHead className="text-right">Piezas</TableHead>
              <TableHead>Último pedido</TableHead>
              <TableHead className="w-[130px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {/* Ocho celdas, las mismas ocho del encabezado. */}
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!cargando && visibles.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {busqueda
                    ? "Ningún cliente coincide con la búsqueda."
                    : "Todavía no hay clientes. Crea el primero."}
                </TableCell>
              </TableRow>
            )}

            {!cargando &&
              visibles.map((c) => (
                <TableRow key={c.id} className={cn(!c.activo && "opacity-60")}>
                  <TableCell className="font-medium">
                    {c.nombre}
                    {!c.activo && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Inactivo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {c.documento ?? "—"}
                  </TableCell>
                  <TableCell>{c.correo ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {c.telefono ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.ordenes}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.piezas.toLocaleString("es-MX")}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {fmtFecha(c.ultimo_pedido)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        title="Editar"
                        disabled={readOnly}
                        onClick={() => abrirEdicion(c)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        title={
                          c.activo
                            ? "Inactivar — deja de ofrecerse al crear pedidos"
                            : "Reactivar"
                        }
                        disabled={readOnly}
                        onClick={() => void cambiarActivo(c)}
                      >
                        {c.activo ? (
                          <UserX className="size-4" />
                        ) : (
                          <UserCheck className="size-4 text-emerald-600" />
                        )}
                      </Button>
                      {/*
                        Borrar solo cuando no tiene una sola orden. Con
                        órdenes la base lo rechaza, así que mostrar el
                        botón sería ofrecer algo que siempre falla.
                      */}
                      {c.se_puede_borrar && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-destructive hover:text-destructive"
                          title="Eliminar"
                          disabled={readOnly}
                          onClick={() => setABorrar(c)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Alta y edición ── */}
      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editando ? "Editar cliente" : "Nuevo cliente"}
            </DialogTitle>
            <DialogDescription>
              Solo el nombre es obligatorio. El documento, el correo y el
              teléfono se pueden completar después.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                autoFocus
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="MYSTIKA"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Documento</Label>
              <Input
                value={form.documento}
                onChange={(e) =>
                  setForm((f) => ({ ...f, documento: e.target.value }))
                }
                placeholder="RFC"
                className="mt-1 h-9"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Correo</Label>
                <Input
                  type="email"
                  value={form.correo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, correo: e.target.value }))
                  }
                  placeholder="compras@cliente.com"
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Teléfono</Label>
                <Input
                  value={form.telefono}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, telefono: e.target.value }))
                  }
                  placeholder="55 1234 5678"
                  className="mt-1 h-9"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input
                value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                className="mt-1 h-9"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogo(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              onClick={guardar}
              disabled={readOnly || guardando || !form.nombre.trim()}
            >
              {guardando && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editando ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmar borrado ── */}
      <AlertDialog
        open={aBorrar != null}
        onOpenChange={(v) => !v && setABorrar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar a {aBorrar?.nombre}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              No tiene órdenes registradas, así que se puede borrar sin
              dejar folios huérfanos. Esto no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={borrando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void borrar()
              }}
              disabled={borrando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {borrando && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

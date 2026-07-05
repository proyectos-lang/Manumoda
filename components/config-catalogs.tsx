"use client"

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus, Trash2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { SessionUser } from "@/lib/types"
import { UserManagement } from "@/components/user-management"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type CatalogRecord = { id: number; nombre: string }
type TableName = "compradores" | "maquileros" | "submaquileros"

const TABS: { key: TableName; label: string; singular: string }[] = [
  { key: "compradores", label: "Compradores", singular: "Comprador" },
  { key: "maquileros", label: "Maquileros", singular: "Maquilero" },
  { key: "submaquileros", label: "Submaquileros", singular: "Submaquilero" },
]

interface CatalogTabProps {
  table: TableName
  singular: string
  configMissing: boolean
}

function CatalogTab({ table, singular, configMissing }: CatalogTabProps) {
  const [records, setRecords] = useState<CatalogRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Form dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogRecord | null>(null)
  const [nombre, setNombre] = useState("")
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<CatalogRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchRecords = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase
      .from(table)
      .select("id, nombre")
      .eq("idempresa", IDEMPRESA)
      .order("nombre", { ascending: true })

    if (error) {
      toast.error(`Error al cargar ${table}: ${error.message}`)
    } else {
      setRecords(data ?? [])
    }
    setLoading(false)
  }, [table, configMissing])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  function openCreate() {
    setEditing(null)
    setNombre("")
    setDialogOpen(true)
  }

  function openEdit(record: CatalogRecord) {
    setEditing(record)
    setNombre(record.nombre)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
    setNombre("")
  }

  async function handleSave() {
    const trimmed = nombre.trim()
    if (!trimmed) {
      toast.warning("El nombre no puede estar vacío.")
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setSaving(true)

    if (editing) {
      const { error } = await supabase
        .from(table)
        .update({ nombre: trimmed })
        .eq("id", editing.id)
        .eq("idempresa", IDEMPRESA)

      if (error) {
        toast.error(`Error al actualizar: ${error.message}`)
      } else {
        toast.success(`${singular} actualizado correctamente.`)
        closeDialog()
        fetchRecords()
      }
    } else {
      const { error } = await supabase
        .from(table)
        .insert({ nombre: trimmed, idempresa: IDEMPRESA })

      if (error) {
        toast.error(`Error al crear: ${error.message}`)
      } else {
        toast.success(`${singular} creado correctamente.`)
        closeDialog()
        fetchRecords()
      }
    }

    setSaving(false)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const supabase = getSupabase()
    if (!supabase) return

    setDeleting(true)

    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", deleteTarget.id)
      .eq("idempresa", IDEMPRESA)

    if (error) {
      const isFkError =
        error.code === "23503" ||
        error.message.toLowerCase().includes("foreign") ||
        error.message.toLowerCase().includes("violates")

      if (isFkError) {
        toast.warning(`No se puede eliminar porque está asignado a una órden de producción.`)
      } else {
        toast.error(`Error al eliminar: ${error.message}`)
      }
    } else {
      toast.success(`${singular} eliminado correctamente.`)
      fetchRecords()
    }

    setDeleteTarget(null)
    setDeleting(false)
  }

  if (configMissing) {
    return (
      <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
        <AlertTriangle className="size-4" />
        <AlertTitle>Supabase no configurado</AlertTitle>
        <AlertDescription>
          Configura <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> para usar este
          módulo.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              `${records.length} registro${records.length !== 1 ? "s" : ""}`
            )}
          </p>
        </div>
        <Button
          size="sm"
          onClick={openCreate}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="size-3.5" />
          Agregar {singular}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-white/60 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-20 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                ID
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nombre
              </TableHead>
              <TableHead className="w-32 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i} className="border-border/40">
                  <TableCell>
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                  No hay registros. Agrega el primero.
                </TableCell>
              </TableRow>
            ) : (
              records.map((rec) => (
                <TableRow
                  key={rec.id}
                  className="border-border/40 transition-colors hover:bg-violet-50/40"
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {rec.id}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{rec.nombre}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Editar ${rec.nombre}`}
                        onClick={() => openEdit(rec)}
                        className="size-8 text-muted-foreground hover:text-violet-600 hover:bg-violet-50"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Eliminar ${rec.nombre}`}
                        onClick={() => setDeleteTarget(rec)}
                        className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent className="sm:max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Editar ${singular}` : `Agregar ${singular}`}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="nombre-input" className="mb-1.5 block text-sm font-medium">
              Nombre
            </Label>
            <Input
              id="nombre-input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
              placeholder={`Nombre del ${singular.toLowerCase()}`}
              className="border-border/60 focus-visible:ring-violet-500/40"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saving ? "Guardando..." : editing ? "Actualizar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar eliminación</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Está seguro de que desea eliminar{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.nombre}</span>?
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface ConfigCatalogsProps {
  configMissing: boolean
  user: SessionUser
}

export function ConfigCatalogs({ configMissing, user }: ConfigCatalogsProps) {
  return (
    <Tabs defaultValue="compradores" className="w-full">
      <TabsList className="mb-6 h-10 rounded-xl border border-border/60 bg-white/60 p-1 backdrop-blur-sm">
        {TABS.map((t) => (
          <TabsTrigger
            key={t.key}
            value={t.key}
            className="rounded-lg text-sm font-medium data-[state=active]:bg-violet-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            {t.label}
          </TabsTrigger>
        ))}
        {user.es_admin && (
          <TabsTrigger
            value="usuarios"
            className="rounded-lg text-sm font-medium data-[state=active]:bg-violet-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            Usuarios
          </TabsTrigger>
        )}
      </TabsList>

      {TABS.map((t) => (
        <TabsContent key={t.key} value={t.key}>
          <CatalogTab
            table={t.key}
            singular={t.singular}
            configMissing={configMissing}
          />
        </TabsContent>
      ))}

      {user.es_admin && (
        <TabsContent value="usuarios">
          <UserManagement currentUser={user} />
        </TabsContent>
      )}
    </Tabs>
  )
}

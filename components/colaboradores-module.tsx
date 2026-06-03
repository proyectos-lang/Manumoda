"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Pencil, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

// ── Constantes de estilo oscuro ────────────────────────────────────────────────

const BG_MAIN = "oklch(0.16 0.04 295)"
const BG_CARD = "oklch(0.19 0.05 295)"
const BG_HEADER = "oklch(0.20 0.05 295)"
const HEADER_GRADIENT =
  "linear-gradient(135deg, oklch(0.18 0.09 295) 0%, oklch(0.22 0.12 305) 50%, oklch(0.18 0.1 320) 100%)"

const DARK_INPUT =
  "border-white/15 bg-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20 focus-visible:border-white/30"

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Colaborador = { id: number; nombre: string }
type TableName = "disenadoras" | "costureras"
type Props = { configMissing: boolean }

// ── Componente principal ───────────────────────────────────────────────────────

export function ColaboradoresModule({ configMissing }: Props) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: BG_MAIN }}>
      {/* ── Cabecera con degradado oscuro ── */}
      <div
        className="relative overflow-hidden p-6"
        style={{ background: HEADER_GRADIENT }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage: "radial-gradient(oklch(1 0 0 / 0.09) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Users className="size-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Registro de Colaboradores</h2>
            <p className="text-xs text-white/55">
              Administra diseñadoras y costureras · <code className="font-mono">manumoda.disenadoras / costureras</code>
            </p>
          </div>
        </div>
      </div>

      {/* ── Contenido con Tabs ── */}
      <div className="p-5">
        <Tabs defaultValue="disenadoras">
          <TabsList
            className="mb-5 border border-white/10"
            style={{ background: "oklch(0.20 0.05 295)" }}
          >
            <TabsTrigger
              value="disenadoras"
              className="text-white/60 data-[state=active]:bg-white/15 data-[state=active]:text-white"
            >
              Diseñadoras
            </TabsTrigger>
            <TabsTrigger
              value="costureras"
              className="text-white/60 data-[state=active]:bg-white/15 data-[state=active]:text-white"
            >
              Costureras
            </TabsTrigger>
          </TabsList>

          <TabsContent value="disenadoras" className="mt-0">
            <CRUDTab table="disenadoras" label="Diseñadora" configMissing={configMissing} />
          </TabsContent>

          <TabsContent value="costureras" className="mt-0">
            <CRUDTab table="costureras" label="Costurera" configMissing={configMissing} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// ── Tab CRUD genérico (funciona para ambas tablas) ────────────────────────────

function CRUDTab({
  table,
  label,
  configMissing,
}: {
  table: TableName
  label: string
  configMissing: boolean
}) {
  const [records, setRecords] = useState<Colaborador[]>([])
  const [loading, setLoading] = useState(false)

  // Dialog (crear / editar)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<Colaborador | null>(null)
  const [nombreInput, setNombreInput] = useState("")
  const [saving, setSaving] = useState(false)

  // AlertDialog (eliminar)
  const [deleteTarget, setDeleteTarget] = useState<Colaborador | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────────────────

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
      console.error(`[v0] ${table} fetch:`, error)
      toast.error(`Error al cargar ${label.toLowerCase()}s`, { description: error.message })
    } else {
      setRecords((data ?? []) as Colaborador[])
    }
    setLoading(false)
  }, [configMissing, table, label])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  // ── Abrir dialog ───────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditRecord(null)
    setNombreInput("")
    setDialogOpen(true)
  }

  const openEdit = (record: Colaborador) => {
    setEditRecord(record)
    setNombreInput(record.nombre)
    setDialogOpen(true)
  }

  // ── Guardar (crear o actualizar) ───────────────────────────────────────────

  const handleSave = async () => {
    if (!nombreInput.trim()) {
      toast.error("El nombre es requerido.")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)
    try {
      if (editRecord) {
        // UPDATE
        const { error } = await supabase
          .from(table)
          .update({ nombre: nombreInput.trim() })
          .eq("id", editRecord.id)
          .eq("idempresa", IDEMPRESA)
        if (error) {
          toast.error("No se pudo actualizar", { description: error.message })
          return
        }
        setRecords((prev) =>
          prev.map((r) =>
            r.id === editRecord.id ? { ...r, nombre: nombreInput.trim() } : r,
          ),
        )
        toast.success(`${label} actualizada correctamente.`)
      } else {
        // INSERT
        const { data, error } = await supabase
          .from(table)
          .insert({ nombre: nombreInput.trim(), idempresa: IDEMPRESA })
          .select("id, nombre")
          .single()
        if (error) {
          toast.error("No se pudo agregar", { description: error.message })
          return
        }
        setRecords((prev) =>
          [...prev, data as Colaborador].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        )
        toast.success(`${label} agregada correctamente.`)
      }
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  // ── Eliminar ───────────────────────────────────────────────────────────────

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const supabase = getSupabase()
    if (!supabase) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", deleteTarget.id)
        .eq("idempresa", IDEMPRESA)
      if (error) {
        if (error.code === "23503") {
          toast.error("No se puede eliminar", {
            description: "Este colaborador tiene historial registrado en el sistema.",
          })
        } else {
          toast.error("No se pudo eliminar", { description: error.message })
        }
        return
      }
      setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      toast.success(`${label} eliminada correctamente.`)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">
        {/* Cabecera de la tabla */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/50">
            {loading ? "Cargando…" : `${records.length} registro(s)`}
          </p>
          <Button
            size="sm"
            onClick={openCreate}
            disabled={configMissing}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white border-0"
          >
            <Plus className="size-4" />
            Agregar {label}
          </Button>
        </div>

        {/* Tabla */}
        <div
          className="overflow-hidden rounded-xl border border-white/10"
          style={{ background: BG_CARD }}
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow
                  className="hover:bg-transparent border-white/10"
                  style={{ background: BG_HEADER }}
                >
                  <TableHead className="w-16 text-white/50 text-xs font-semibold uppercase tracking-wide">
                    ID
                  </TableHead>
                  <TableHead className="text-white/50 text-xs font-semibold uppercase tracking-wide">
                    Nombre
                  </TableHead>
                  <TableHead className="text-white/50 text-xs font-semibold uppercase tracking-wide text-right">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-white/10">
                      <TableCell><Skeleton className="h-4 w-8 bg-white/10" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48 bg-white/10" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto bg-white/10" /></TableCell>
                    </TableRow>
                  ))
                ) : records.length === 0 ? (
                  <TableRow className="border-white/10">
                    <TableCell
                      colSpan={3}
                      className="h-28 text-center text-sm text-white/30"
                    >
                      Sin registros. Agrega la primera {label.toLowerCase()}.
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((r) => (
                    <TableRow
                      key={r.id}
                      className="border-white/10 hover:bg-white/5 transition-colors"
                    >
                      <TableCell className="tabular-nums text-xs text-white/35">
                        {r.id}
                      </TableCell>
                      <TableCell className="font-medium text-white">
                        {r.nombre}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(r)}
                            className="gap-1.5 text-white/55 hover:text-white hover:bg-white/10"
                          >
                            <Pencil className="size-3.5" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(r)}
                            className="gap-1.5 text-red-400/70 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="size-3.5" />
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Dialog Crear / Editar ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!saving) setDialogOpen(o)
        }}
      >
        <DialogContent
          className="sm:max-w-xs border-white/10"
          style={{ background: "oklch(0.19 0.05 295)" }}
        >
          <DialogHeader>
            <DialogTitle className="text-white">
              {editRecord ? `Editar ${label}` : `Agregar ${label}`}
            </DialogTitle>
            <DialogDescription className="text-white/55">
              {editRecord
                ? "Modifica el nombre y guarda los cambios."
                : `Escribe el nombre de la nueva ${label.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-1.5">
            <Label htmlFor="nombre-input" className="text-xs font-medium text-white/70">
              Nombre <span className="text-rose-400">*</span>
            </Label>
            <Input
              id="nombre-input"
              value={nombreInput}
              onChange={(e) => setNombreInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
              placeholder={`Nombre de la ${label.toLowerCase()}…`}
              autoFocus
              className={cn(DARK_INPUT)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="text-white/60 hover:text-white hover:bg-white/10"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !nombreInput.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white border-0"
            >
              {saving ? (
                <><Loader2 className="size-4 animate-spin" />Guardando…</>
              ) : editRecord ? (
                "Guardar cambios"
              ) : (
                "Agregar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog Eliminar ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null) }}
      >
        <AlertDialogContent
          className="border-white/10"
          style={{ background: "oklch(0.19 0.05 295)" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              ¿Eliminar {label.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/55">
              Se eliminará permanentemente a{" "}
              <span className="font-semibold text-white">{deleteTarget?.nombre}</span>.
              Si tiene historial registrado, la operación será rechazada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

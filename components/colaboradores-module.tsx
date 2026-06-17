"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Pencil, Trash2, Users, CalendarIcon, X } from "lucide-react"
import { toast } from "sonner"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
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
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Colaborador = {
  id: number
  nombre: string
  area: string | null
  puesto: string | null
  sueldo_semanal: number | null
  fecha_nacimiento: string | null
  fecha_ingreso: string | null
  fecha_baja: string | null
}

type FormState = {
  nombre: string
  area: string
  puesto: string
  sueldo_semanal: string
  fecha_nacimiento: Date | null
  fecha_ingreso: Date | null
  fecha_baja: Date | null
}

type TableName = "disenadoras" | "costureras"
type Props = { configMissing: boolean }

const EMPTY_FORM: FormState = {
  nombre: "",
  area: "",
  puesto: "",
  sueldo_semanal: "",
  fecha_nacimiento: null,
  fecha_ingreso: null,
  fecha_baja: null,
}

function toDateOrNull(iso: string | null): Date | null {
  if (!iso) return null
  try { return parseISO(iso) } catch { return null }
}

function toISOOrNull(d: Date | null): string | null {
  if (!d) return null
  return format(d, "yyyy-MM-dd")
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  try { return format(parseISO(iso), "dd/MM/yyyy", { locale: es }) } catch { return iso }
}

function fmtCurrency(n: number | null) {
  if (n == null) return "—"
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n)
}

// ── DatePicker (tema claro) ───────────────────────────────────────────────────

function DatePicker({
  value,
  onChange,
  placeholder,
  clearable,
}: {
  value: Date | null
  onChange: (d: Date | null) => void
  placeholder?: string
  clearable?: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">
            {value ? format(value, "dd/MM/yyyy") : (placeholder ?? "Seleccionar fecha…")}
          </span>
          {clearable && value && (
            <X
              className="size-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={(d) => onChange(d ?? null)}
          locale={es}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export function ColaboradoresModule({ configMissing }: Props) {
  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
        {/* Cabecera */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 ring-1 ring-violet-200">
            <Users className="size-4 text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Registro de Colaboradores</h2>
            <p className="text-xs text-muted-foreground">
              Administra diseñadoras, costureras y cortadores ·{" "}
              <code className="font-mono">manumoda.disenadoras / costureras / cortadores</code>
            </p>
          </div>
        </div>

        <Tabs defaultValue="disenadoras">
          <TabsList className="mb-5">
            <TabsTrigger value="disenadoras">Diseñadoras</TabsTrigger>
            <TabsTrigger value="costureras">Costureras</TabsTrigger>
            <TabsTrigger value="cortadores">Cortadores</TabsTrigger>
          </TabsList>

          <TabsContent value="disenadoras" className="mt-0">
            <CRUDTab table="disenadoras" label="Diseñadora" configMissing={configMissing} />
          </TabsContent>
          <TabsContent value="costureras" className="mt-0">
            <CRUDTab table="costureras" label="Costurera" configMissing={configMissing} />
          </TabsContent>
          <TabsContent value="cortadores" className="mt-0">
            <CortadoresTab configMissing={configMissing} />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}

// ── Tab Cortadores ─────────────────────────────────────────────────────────────

type Cortador = {
  id: number
  nombre: string
  activo: boolean
  fecha_baja: string | null
}

type CortadorForm = {
  nombre: string
  fecha_baja: Date | null
}

const EMPTY_CORTADOR_FORM: CortadorForm = { nombre: "", fecha_baja: null }

function CortadoresTab({ configMissing }: { configMissing: boolean }) {
  const [records, setRecords] = useState<Cortador[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<Cortador | null>(null)
  const [form, setForm] = useState<CortadorForm>(EMPTY_CORTADOR_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Cortador | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchRecords = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from("cortadores")
      .select("id, nombre, activo, fecha_baja")
      .order("nombre")
    if (error) {
      toast.error("Error al cargar cortadores", { description: error.message })
    } else {
      setRecords((data ?? []) as Cortador[])
    }
    setLoading(false)
  }, [configMissing])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  const openCreate = () => {
    setEditRecord(null)
    setForm(EMPTY_CORTADOR_FORM)
    setDialogOpen(true)
  }

  const openEdit = (r: Cortador) => {
    setEditRecord(r)
    setForm({ nombre: r.nombre, fecha_baja: toDateOrNull(r.fecha_baja) })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error("El nombre es requerido."); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)
    try {
      const fechaBajaISO = toISOOrNull(form.fecha_baja)
      const payload = {
        nombre: form.nombre.trim(),
        activo: !fechaBajaISO,
        fecha_baja: fechaBajaISO,
      }
      if (editRecord) {
        const { error } = await supabase
          .from("cortadores").update(payload).eq("id", editRecord.id)
        if (error) { toast.error("No se pudo actualizar", { description: error.message }); return }
        setRecords((prev) =>
          prev.map((r) => r.id === editRecord.id ? { ...r, ...payload } : r)
            .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        )
        toast.success("Cortador actualizado correctamente.")
      } else {
        const { data, error } = await supabase
          .from("cortadores")
          .insert(payload)
          .select("id, nombre, activo, fecha_baja")
          .single()
        if (error) { toast.error("No se pudo agregar", { description: error.message }); return }
        setRecords((prev) =>
          [...prev, data as Cortador].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        )
        toast.success("Cortador agregado correctamente.")
      }
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const supabase = getSupabase()
    if (!supabase) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from("cortadores").delete().eq("id", deleteTarget.id)
      if (error) {
        toast.error(
          error.code === "23503" ? "No se puede eliminar" : "No se pudo eliminar",
          {
            description: error.code === "23503"
              ? "Este cortador tiene historial de cortes registrado en el sistema."
              : error.message,
          },
        )
        return
      }
      setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      toast.success("Cortador eliminado correctamente.")
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {loading ? "Cargando…" : `${records.length} registro(s)`}
          </p>
          <Button size="sm" onClick={openCreate} disabled={configMissing} className="gap-1.5">
            <Plus className="size-4" />
            Agregar Cortador
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Nombre</TableHead>
                  <TableHead className="font-semibold">Estatus</TableHead>
                  <TableHead className="font-semibold">Fecha de Baja</TableHead>
                  <TableHead className="font-semibold text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-28 text-center text-sm text-muted-foreground">
                      Sin cortadores registrados. Agrega el primero.
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-foreground">{r.nombre}</TableCell>
                      <TableCell>
                        {r.activo ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-slate-600">Baja</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(r.fecha_baja)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="gap-1.5">
                            <Pencil className="size-3.5" />Editar
                          </Button>
                          <Button
                            size="sm" variant="ghost" onClick={() => setDeleteTarget(r)}
                            className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="size-3.5" />Eliminar
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
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!saving) setDialogOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editRecord ? "Editar Cortador" : "Agregar Cortador"}</DialogTitle>
            <DialogDescription>
              {editRecord
                ? "Modifica los datos y guarda los cambios."
                : "Completa los datos del nuevo cortador de telas."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
                placeholder="Nombre completo…"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Fecha de baja{" "}
                <span className="font-normal text-muted-foreground">(opcional — vacío = activo)</span>
              </Label>
              <DatePicker
                value={form.fecha_baja}
                onChange={(d) => setForm((f) => ({ ...f, fecha_baja: d }))}
                placeholder="Sin fecha de baja"
                clearable
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.nombre.trim()}>
              {saving
                ? <><Loader2 className="size-4 animate-spin mr-1" />Guardando…</>
                : editRecord ? "Guardar cambios" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog Eliminar ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cortador?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.nombre}</span>.
              Si tiene historial de cortes registrado, la operación será rechazada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
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

// ── Tab CRUD genérico ──────────────────────────────────────────────────────────

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

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<Colaborador | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

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
      .select("id, nombre, area, puesto, sueldo_semanal, fecha_nacimiento, fecha_ingreso, fecha_baja")
      .eq("idempresa", IDEMPRESA)
      .order("nombre", { ascending: true })
    if (error) {
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
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (r: Colaborador) => {
    setEditRecord(r)
    setForm({
      nombre: r.nombre,
      area: r.area ?? "",
      puesto: r.puesto ?? "",
      sueldo_semanal: r.sueldo_semanal != null ? String(r.sueldo_semanal) : "",
      fecha_nacimiento: toDateOrNull(r.fecha_nacimiento),
      fecha_ingreso: toDateOrNull(r.fecha_ingreso),
      fecha_baja: toDateOrNull(r.fecha_baja),
    })
    setDialogOpen(true)
  }

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  // ── Guardar ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error("El nombre es requerido."); return }
    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        area: form.area.trim() || null,
        puesto: form.puesto.trim() || null,
        sueldo_semanal: form.sueldo_semanal !== "" ? Number(form.sueldo_semanal) : null,
        fecha_nacimiento: toISOOrNull(form.fecha_nacimiento),
        fecha_ingreso: toISOOrNull(form.fecha_ingreso),
        fecha_baja: toISOOrNull(form.fecha_baja),
      }

      if (editRecord) {
        const { error } = await supabase
          .from(table).update(payload).eq("id", editRecord.id).eq("idempresa", IDEMPRESA)
        if (error) { toast.error("No se pudo actualizar", { description: error.message }); return }
        setRecords((prev) =>
          prev.map((r) => r.id === editRecord.id ? { ...r, ...payload } : r)
            .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        )
        toast.success(`${label} actualizada correctamente.`)
      } else {
        const { data, error } = await supabase
          .from(table)
          .insert({ ...payload, idempresa: IDEMPRESA })
          .select("id, nombre, area, puesto, sueldo_semanal, fecha_nacimiento, fecha_ingreso, fecha_baja")
          .single()
        if (error) { toast.error("No se pudo agregar", { description: error.message }); return }
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
        .from(table).delete().eq("id", deleteTarget.id).eq("idempresa", IDEMPRESA)
      if (error) {
        toast.error(
          error.code === "23503" ? "No se puede eliminar" : "No se pudo eliminar",
          {
            description: error.code === "23503"
              ? "Este colaborador tiene historial registrado en el sistema."
              : error.message,
          },
        )
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
        {/* Barra superior */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {loading ? "Cargando…" : `${records.length} registro(s)`}
          </p>
          <Button
            size="sm"
            onClick={openCreate}
            disabled={configMissing}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            Agregar {label}
          </Button>
        </div>

        {/* Tabla */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Nombre</TableHead>
                  <TableHead className="font-semibold">Área</TableHead>
                  <TableHead className="font-semibold">Puesto</TableHead>
                  <TableHead className="font-semibold text-right">Sueldo Semanal</TableHead>
                  <TableHead className="font-semibold">Ingreso</TableHead>
                  <TableHead className="font-semibold">Estatus</TableHead>
                  <TableHead className="font-semibold text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">
                      Sin registros. Agrega la primera {label.toLowerCase()}.
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-foreground">{r.nombre}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.area ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.puesto ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmtCurrency(r.sueldo_semanal)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(r.fecha_ingreso)}</TableCell>
                      <TableCell>
                        {r.fecha_baja ? (
                          <Badge variant="secondary" className="text-slate-600">Baja</Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                            Activo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(r)}
                            className="gap-1.5"
                          >
                            <Pencil className="size-3.5" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(r)}
                            className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
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
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!saving) setDialogOpen(o) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRecord ? `Editar ${label}` : `Agregar ${label}`}</DialogTitle>
            <DialogDescription>
              {editRecord
                ? "Modifica los datos y guarda los cambios."
                : `Completa los datos de la nueva ${label.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto pr-1">
            {/* Nombre — ancho completo */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.nombre}
                onChange={(e) => setField("nombre", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
                placeholder="Nombre completo…"
                autoFocus
              />
            </div>

            {/* Área / Puesto */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Área</Label>
                <Input
                  value={form.area}
                  onChange={(e) => setField("area", e.target.value)}
                  placeholder="Ej. Diseño, Corte…"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Puesto</Label>
                <Input
                  value={form.puesto}
                  onChange={(e) => setField("puesto", e.target.value)}
                  placeholder="Ej. Diseñadora Sr…"
                />
              </div>
            </div>

            {/* Sueldo semanal */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Sueldo semanal (MXN)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.sueldo_semanal}
                onChange={(e) => setField("sueldo_semanal", e.target.value)}
                placeholder="0.00"
              />
            </div>

            {/* Fecha nacimiento / Fecha ingreso */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Fecha de nacimiento</Label>
                <DatePicker
                  value={form.fecha_nacimiento}
                  onChange={(d) => setField("fecha_nacimiento", d)}
                  placeholder="dd/mm/aaaa"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Fecha de ingreso</Label>
                <DatePicker
                  value={form.fecha_ingreso}
                  onChange={(d) => setField("fecha_ingreso", d)}
                  placeholder="dd/mm/aaaa"
                />
              </div>
            </div>

            {/* Fecha baja — limpiable */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Fecha de baja{" "}
                <span className="font-normal text-muted-foreground">(opcional — vacío = activa)</span>
              </Label>
              <DatePicker
                value={form.fecha_baja}
                onChange={(d) => setField("fecha_baja", d)}
                placeholder="Sin fecha de baja"
                clearable
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.nombre.trim()}>
              {saving ? (
                <><Loader2 className="size-4 animate-spin mr-1" />Guardando…</>
              ) : editRecord ? "Guardar cambios" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog Eliminar ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {label.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.nombre}</span>.
              Si tiene historial registrado, la operación será rechazada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
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

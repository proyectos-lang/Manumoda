"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, Plus, ShieldCheck, UserX, UserCheck, KeyRound } from "lucide-react"
import { toast } from "sonner"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { SessionUser } from "@/lib/types"
import type { ModuleKey } from "@/components/app-sidebar"
import { NAV } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type UserRecord = {
  id: number
  nombre: string
  username: string
  es_admin: boolean
  activo: boolean
}

const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  NAV.filter((n) => n.key !== "inicio").map((n) => [n.key, n.label])
)

interface UserManagementProps {
  currentUser: SessionUser
}

export function UserManagement({ currentUser }: UserManagementProps) {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<UserRecord | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [nombre, setNombre] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [esAdmin, setEsAdmin] = useState(false)
  const [permisos, setPermisos] = useState<Set<string>>(new Set())

  const fetchUsers = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nombre, username, es_admin, activo")
      .eq("idempresa", IDEMPRESA)
      .order("nombre", { ascending: true })
    if (error) toast.error("Error al cargar usuarios: " + error.message)
    else setUsers(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  async function fetchPermisos(userId: number): Promise<Set<string>> {
    const supabase = getSupabase()
    if (!supabase) return new Set()
    const { data } = await supabase
      .from("permisos_modulo")
      .select("modulo")
      .eq("idusuario", userId)
    return new Set((data ?? []).map((p: { modulo: string }) => p.modulo))
  }

  function openCreate() {
    setEditing(null)
    setNombre("")
    setUsername("")
    setPassword("")
    setEsAdmin(false)
    setPermisos(new Set())
    setSheetOpen(true)
  }

  async function openEdit(user: UserRecord) {
    setEditing(user)
    setNombre(user.nombre)
    setUsername(user.username)
    setPassword("")
    setEsAdmin(user.es_admin)
    const p = await fetchPermisos(user.id)
    setPermisos(p)
    setSheetOpen(true)
  }

  function togglePermiso(key: string) {
    setPermisos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function hashPassword(plain: string): Promise<string | null> {
    try {
      const res = await fetch("/api/auth/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: plain }),
      })
      const data = await res.json()
      return res.ok ? (data.hash as string) : null
    } catch {
      return null
    }
  }

  async function handleSave() {
    const trimNombre = nombre.trim()
    const trimUsername = username.trim().toLowerCase()
    if (!trimNombre || !trimUsername) {
      toast.warning("Nombre y usuario son requeridos.")
      return
    }
    if (!editing && !password) {
      toast.warning("La contraseña es requerida para nuevos usuarios.")
      return
    }

    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)

    try {
      let userId: number

      if (editing) {
        const updates: Record<string, unknown> = {
          nombre: trimNombre,
          username: trimUsername,
          es_admin: esAdmin,
        }
        if (password) {
          const hash = await hashPassword(password)
          if (!hash) { toast.error("Error al procesar la contraseña."); setSaving(false); return }
          updates.password_hash = hash
        }
        const { error } = await supabase
          .from("usuarios")
          .update(updates)
          .eq("id", editing.id)
          .eq("idempresa", IDEMPRESA)
        if (error) { toast.error("Error al actualizar: " + error.message); setSaving(false); return }
        userId = editing.id
        toast.success("Usuario actualizado correctamente.")
      } else {
        const hash = await hashPassword(password)
        if (!hash) { toast.error("Error al procesar la contraseña."); setSaving(false); return }
        const { data, error } = await supabase
          .from("usuarios")
          .insert({ idempresa: IDEMPRESA, nombre: trimNombre, username: trimUsername, password_hash: hash, es_admin: esAdmin, activo: true })
          .select("id")
          .single()
        if (error || !data) { toast.error("Error al crear usuario: " + (error?.message ?? "")); setSaving(false); return }
        userId = data.id
        toast.success("Usuario creado correctamente.")
      }

      // Sync permisos (solo si no es admin)
      if (!esAdmin) {
        await supabase.from("permisos_modulo").delete().eq("idusuario", userId)
        if (permisos.size > 0) {
          const rows = Array.from(permisos).map((modulo) => ({ idusuario: userId, modulo }))
          await supabase.from("permisos_modulo").insert(rows)
        }
      } else {
        // Admin = eliminar todos los permisos explícitos (tiene todo implícitamente)
        await supabase.from("permisos_modulo").delete().eq("idusuario", userId)
      }

      setSheetOpen(false)
      fetchUsers()
    } catch {
      toast.error("Error inesperado al guardar.")
    }
    setSaving(false)
  }

  async function toggleActivo(user: UserRecord) {
    const activeAdmins = users.filter((u) => u.es_admin && u.activo)
    if (user.activo && user.es_admin && activeAdmins.length <= 1) {
      toast.warning("No puedes desactivar al único administrador activo.")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase
      .from("usuarios")
      .update({ activo: !user.activo })
      .eq("id", user.id)
      .eq("idempresa", IDEMPRESA)
    if (error) toast.error("Error: " + error.message)
    else {
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, activo: !u.activo } : u))
      toast.success(user.activo ? "Usuario desactivado." : "Usuario activado.")
    }
  }

  const moduleKeys = Object.keys(MODULE_LABELS) as ModuleKey[]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {/* No usar <p>: el Skeleton es un <div> y anidarlo rompe la hidratación */}
        <div className="text-sm text-muted-foreground">
          {loading ? <Skeleton className="h-4 w-24" /> : `${users.length} usuario${users.length !== 1 ? "s" : ""}`}
        </div>
        <Button
          size="sm"
          onClick={openCreate}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="size-3.5" />
          Nuevo usuario
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-white/60 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nombre</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usuario</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rol</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado</TableHead>
              <TableHead className="w-28 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i} className="border-border/40">
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No hay usuarios registrados.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id} className="border-border/40 hover:bg-violet-50/30">
                  <TableCell className="font-medium text-foreground">{u.nombre}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{u.username}</TableCell>
                  <TableCell>
                    {u.es_admin ? (
                      <Badge className="gap-1 bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100">
                        <ShieldCheck className="size-3" /> Admin
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">Operador</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={u.activo ? "default" : "secondary"}
                      className={u.activo
                        ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "bg-red-50 text-red-600 border-red-200 hover:bg-red-50"}
                    >
                      {u.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Editar"
                        onClick={() => openEdit(u)}
                        className="size-8 text-muted-foreground hover:text-violet-600 hover:bg-violet-50"
                        title="Editar usuario"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={u.activo ? "Desactivar" : "Activar"}
                        onClick={() => toggleActivo(u)}
                        disabled={u.id === currentUser.id}
                        className={`size-8 ${u.activo ? "text-muted-foreground hover:text-red-600 hover:bg-red-50" : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50"}`}
                        title={u.id === currentUser.id ? "No puedes cambiar tu propio estado" : u.activo ? "Desactivar" : "Activar"}
                      >
                        {u.activo ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) setSheetOpen(false) }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto bg-white">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              {editing ? <Pencil className="size-4 text-violet-600" /> : <Plus className="size-4 text-violet-600" />}
              {editing ? "Editar usuario" : "Nuevo usuario"}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Nombre completo <span className="text-red-500">*</span></Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Ana Martínez"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Usuario <span className="text-red-500">*</span></Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nombre_usuario"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <KeyRound className="size-3.5 text-muted-foreground" />
                {editing ? "Nueva contraseña (dejar vacío para no cambiar)" : <span>Contraseña <span className="text-red-500">*</span></span>}
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Administrador</p>
                <p className="text-xs text-muted-foreground">Acceso total a todos los módulos</p>
              </div>
              <Switch
                checked={esAdmin}
                onCheckedChange={setEsAdmin}
                disabled={editing?.id === currentUser.id}
              />
            </div>

            {!esAdmin && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Módulos permitidos</p>
                  <p className="text-xs text-muted-foreground mt-0.5">El módulo Inicio siempre es accesible</p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {moduleKeys.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                    >
                      <Checkbox
                        checked={permisos.has(key)}
                        onCheckedChange={() => togglePermiso(key)}
                        className="data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
                      />
                      <span className="text-sm">{MODULE_LABELS[key]}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <SheetFooter className="mt-8 flex gap-2">
            <SheetClose asChild>
              <Button variant="outline" disabled={saving}>Cancelar</Button>
            </SheetClose>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white gap-2"
            >
              {saving ? <><Loader2 className="size-4 animate-spin" /> Guardando…</> : editing ? "Actualizar" : "Crear usuario"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

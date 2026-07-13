"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, Check, X as XIcon, Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatTipo    = { id: number; nombre: string; multiplicador: number }
type CatCatDem  = { id: number; nombre: string; multiplicador: number }
type CatAdicion = { id: number; clave: string;  nombre: string; horas: number }

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onChanged?: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function OpBadge({ op }: { op: "×" | "+" }) {
  return op === "×" ? (
    <Badge variant="outline" className="border-indigo-200 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-300">
      × Multiplica
    </Badge>
  ) : (
    <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300">
      + Suma horas
    </Badge>
  )
}

const KNOWN_CLAVES = ["muchas_operaciones", "telas_pesadas", "muchas_habilitaciones", "prenda_compleja"]

// ─── Component ────────────────────────────────────────────────────────────────

export function DisenoMultipliersDialog({ open, onOpenChange, onChanged }: Props) {
  const [loading, setLoading]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [tipos, setTipos]         = useState<CatTipo[]>([])
  const [categorias, setCategorias] = useState<CatCatDem[]>([])
  const [adiciones, setAdiciones] = useState<CatAdicion[]>([])

  // Inline-edit state
  const [tipoEdit, setTipoEdit]   = useState<{ id: number; nombre: string; multiplicador: string } | null>(null)
  const [catEdit, setCatEdit]     = useState<{ id: number; nombre: string; multiplicador: string } | null>(null)
  const [adicEdit, setAdicEdit]   = useState<{ id: number; nombre: string; horas: string } | null>(null)

  // New-row state
  const [newTipo, setNewTipo]     = useState<{ nombre: string; multiplicador: string } | null>(null)
  const [newCat, setNewCat]       = useState<{ nombre: string; multiplicador: string } | null>(null)
  const [newAdic, setNewAdic]     = useState<{ nombre: string; horas: string } | null>(null)

  useEffect(() => { if (open) fetchAll() }, [open])

  async function fetchAll() {
    setLoading(true)
    const supabase = getSupabase()
    if (!supabase) { setLoading(false); return }
    const [tRes, cRes, aRes] = await Promise.all([
      supabase.from("cat_tipo_diseno").select("id, nombre, multiplicador").eq("idempresa", IDEMPRESA).order("id"),
      supabase.from("cat_categoria_demografica").select("id, nombre, multiplicador").eq("idempresa", IDEMPRESA).order("id"),
      supabase.from("cat_adiciones_diseno").select("id, clave, nombre, horas").eq("idempresa", IDEMPRESA).order("id"),
    ])
    setTipos((tRes.data ?? []) as CatTipo[])
    setCategorias((cRes.data ?? []) as CatCatDem[])
    setAdiciones((aRes.data ?? []) as CatAdicion[])
    setLoading(false)
  }

  // ── Tipo handlers ────────────────────────────────────────────────────────────

  async function saveTipo() {
    if (!tipoEdit) return
    const mult = parseFloat(tipoEdit.multiplicador)
    if (!tipoEdit.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    setSaving(true)
    const { error } = await getSupabase()!.from("cat_tipo_diseno")
      .update({ nombre: tipoEdit.nombre.trim().toUpperCase(), multiplicador: mult })
      .eq("id", tipoEdit.id)
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return }
    setTipoEdit(null); fetchAll(); onChanged?.()
    toast.success("Tipo actualizado")
  }

  async function deleteTipo(id: number) {
    const { error } = await getSupabase()!.from("cat_tipo_diseno").delete().eq("id", id)
    if (error) { toast.error("Error al eliminar", { description: error.message }); return }
    fetchAll(); onChanged?.()
    toast.success("Tipo eliminado")
  }

  async function insertTipo() {
    if (!newTipo) return
    const mult = parseFloat(newTipo.multiplicador)
    if (!newTipo.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    setSaving(true)
    const { error } = await getSupabase()!.from("cat_tipo_diseno")
      .insert({ idempresa: IDEMPRESA, nombre: newTipo.nombre.trim().toUpperCase(), multiplicador: mult })
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return }
    setNewTipo(null); fetchAll(); onChanged?.()
    toast.success("Tipo agregado")
  }

  // ── Categoría handlers ───────────────────────────────────────────────────────

  async function saveCat() {
    if (!catEdit) return
    const mult = parseFloat(catEdit.multiplicador)
    if (!catEdit.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    setSaving(true)
    const { error } = await getSupabase()!.from("cat_categoria_demografica")
      .update({ nombre: catEdit.nombre.trim(), multiplicador: mult })
      .eq("id", catEdit.id)
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return }
    setCatEdit(null); fetchAll(); onChanged?.()
    toast.success("Categoría actualizada")
  }

  async function deleteCat(id: number) {
    const { error } = await getSupabase()!.from("cat_categoria_demografica").delete().eq("id", id)
    if (error) { toast.error("Error al eliminar", { description: error.message }); return }
    fetchAll(); onChanged?.()
    toast.success("Categoría eliminada")
  }

  async function insertCat() {
    if (!newCat) return
    const mult = parseFloat(newCat.multiplicador)
    if (!newCat.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    setSaving(true)
    const { error } = await getSupabase()!.from("cat_categoria_demografica")
      .insert({ idempresa: IDEMPRESA, nombre: newCat.nombre.trim(), multiplicador: mult })
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return }
    setNewCat(null); fetchAll(); onChanged?.()
    toast.success("Categoría agregada")
  }

  // ── Adición handlers ─────────────────────────────────────────────────────────

  async function saveAdic() {
    if (!adicEdit) return
    const horas = parseFloat(adicEdit.horas)
    if (!adicEdit.nombre.trim() || isNaN(horas)) { toast.error("Nombre y horas requeridos"); return }
    setSaving(true)
    const { error } = await getSupabase()!.from("cat_adiciones_diseno")
      .update({ nombre: adicEdit.nombre.trim(), horas })
      .eq("id", adicEdit.id)
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return }
    setAdicEdit(null); fetchAll(); onChanged?.()
    toast.success("Adición actualizada")
  }

  async function deleteAdic(id: number) {
    const { error } = await getSupabase()!.from("cat_adiciones_diseno").delete().eq("id", id)
    if (error) { toast.error("Error al eliminar", { description: error.message }); return }
    fetchAll(); onChanged?.()
    toast.success("Adición eliminada")
  }

  async function insertAdic() {
    if (!newAdic) return
    const horas = parseFloat(newAdic.horas)
    if (!newAdic.nombre.trim() || isNaN(horas)) { toast.error("Nombre y horas requeridos"); return }
    const clave = newAdic.nombre.trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    setSaving(true)
    const { error } = await getSupabase()!.from("cat_adiciones_diseno")
      .insert({ idempresa: IDEMPRESA, clave, nombre: newAdic.nombre.trim(), horas })
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return }
    setNewAdic(null); fetchAll(); onChanged?.()
    toast.success("Adición agregada")
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Multiplicadores de Diseño</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Horas = horas_base × tipo × categoría + Σ adiciones
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="tipos" className="mt-2">
            <TabsList className="w-full">
              <TabsTrigger value="tipos" className="flex-1">Tipo de Orden</TabsTrigger>
              <TabsTrigger value="categorias" className="flex-1">Categoría Demográfica</TabsTrigger>
              <TabsTrigger value="adiciones" className="flex-1">Adiciones</TabsTrigger>
            </TabsList>

            {/* ── Tab: Tipos ── */}
            <TabsContent value="tipos" className="mt-4 space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Multiplicador</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tipos.map((row) =>
                    tipoEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Input value={tipoEdit.nombre} className="h-7 text-xs"
                            onChange={(e) => setTipoEdit((p) => p && { ...p, nombre: e.target.value })} />
                        </TableCell>
                        <TableCell><OpBadge op="×" /></TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" value={tipoEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto"
                            onChange={(e) => setTipoEdit((p) => p && { ...p, multiplicador: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7" onClick={saveTipo} disabled={saving}>
                              <Check className="size-3.5 text-emerald-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7" onClick={() => setTipoEdit(null)}>
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.nombre}</TableCell>
                        <TableCell><OpBadge op="×" /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7"
                              onClick={() => { setTipoEdit({ id: row.id, nombre: row.nombre, multiplicador: String(row.multiplicador) }); setNewTipo(null) }}>
                              <Pencil className="size-3.5 text-muted-foreground" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7 text-destructive/50 hover:text-destructive"
                              onClick={() => deleteTipo(row.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newTipo && (
                    <TableRow>
                      <TableCell>
                        <Input autoFocus placeholder="Nombre" value={newTipo.nombre} className="h-7 text-xs"
                          onChange={(e) => setNewTipo((p) => p && { ...p, nombre: e.target.value })} />
                      </TableCell>
                      <TableCell><OpBadge op="×" /></TableCell>
                      <TableCell>
                        <Input type="number" step="0.01" placeholder="1.00" value={newTipo.multiplicador} className="h-7 text-xs text-right w-24 ml-auto"
                          onChange={(e) => setNewTipo((p) => p && { ...p, multiplicador: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="size-7" onClick={insertTipo} disabled={saving}>
                            <Check className="size-3.5 text-emerald-600" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => setNewTipo(null)}>
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newTipo && (
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => { setNewTipo({ nombre: "", multiplicador: "1.00" }); setTipoEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar tipo
                </Button>
              )}
            </TabsContent>

            {/* ── Tab: Categorías ── */}
            <TabsContent value="categorias" className="mt-4 space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Multiplicador</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categorias.map((row) =>
                    catEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Input value={catEdit.nombre} className="h-7 text-xs"
                            onChange={(e) => setCatEdit((p) => p && { ...p, nombre: e.target.value })} />
                        </TableCell>
                        <TableCell><OpBadge op="×" /></TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" value={catEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto"
                            onChange={(e) => setCatEdit((p) => p && { ...p, multiplicador: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7" onClick={saveCat} disabled={saving}>
                              <Check className="size-3.5 text-emerald-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7" onClick={() => setCatEdit(null)}>
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">{row.nombre}</TableCell>
                        <TableCell><OpBadge op="×" /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7"
                              onClick={() => { setCatEdit({ id: row.id, nombre: row.nombre, multiplicador: String(row.multiplicador) }); setNewCat(null) }}>
                              <Pencil className="size-3.5 text-muted-foreground" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7 text-destructive/50 hover:text-destructive"
                              onClick={() => deleteCat(row.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newCat && (
                    <TableRow>
                      <TableCell>
                        <Input autoFocus placeholder="Nombre" value={newCat.nombre} className="h-7 text-xs"
                          onChange={(e) => setNewCat((p) => p && { ...p, nombre: e.target.value })} />
                      </TableCell>
                      <TableCell><OpBadge op="×" /></TableCell>
                      <TableCell>
                        <Input type="number" step="0.01" placeholder="1.00" value={newCat.multiplicador} className="h-7 text-xs text-right w-24 ml-auto"
                          onChange={(e) => setNewCat((p) => p && { ...p, multiplicador: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="size-7" onClick={insertCat} disabled={saving}>
                            <Check className="size-3.5 text-emerald-600" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => setNewCat(null)}>
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newCat && (
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => { setNewCat({ nombre: "", multiplicador: "1.00" }); setCatEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar categoría
                </Button>
              )}
            </TabsContent>

            {/* ── Tab: Adiciones ── */}
            <TabsContent value="adiciones" className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Cada adición suma horas planas al total. Las 4 predefinidas persisten en el historial de programación.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Clave DB</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adiciones.map((row) =>
                    adicEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Input value={adicEdit.nombre} className="h-7 text-xs"
                            onChange={(e) => setAdicEdit((p) => p && { ...p, nombre: e.target.value })} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.clave}</TableCell>
                        <TableCell><OpBadge op="+" /></TableCell>
                        <TableCell>
                          <Input type="number" step="0.5" min="0.5" value={adicEdit.horas} className="h-7 text-xs text-right w-20 ml-auto"
                            onChange={(e) => setAdicEdit((p) => p && { ...p, horas: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7" onClick={saveAdic} disabled={saving}>
                              <Check className="size-3.5 text-emerald-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7" onClick={() => setAdicEdit(null)}>
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">{row.nombre}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.clave}</TableCell>
                        <TableCell><OpBadge op="+" /></TableCell>
                        <TableCell className="text-right font-mono">+{Number(row.horas).toFixed(1)} h</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7"
                              onClick={() => { setAdicEdit({ id: row.id, nombre: row.nombre, horas: String(row.horas) }); setNewAdic(null) }}>
                              <Pencil className="size-3.5 text-muted-foreground" />
                            </Button>
                            {!KNOWN_CLAVES.includes(row.clave) && (
                              <Button size="icon" variant="ghost" className="size-7 text-destructive/50 hover:text-destructive"
                                onClick={() => deleteAdic(row.id)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newAdic && (
                    <TableRow>
                      <TableCell>
                        <Input autoFocus placeholder="Nombre de la adición" value={newAdic.nombre} className="h-7 text-xs"
                          onChange={(e) => setNewAdic((p) => p && { ...p, nombre: e.target.value })} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground/60">auto</TableCell>
                      <TableCell><OpBadge op="+" /></TableCell>
                      <TableCell>
                        <Input type="number" step="0.5" min="0.5" placeholder="1.0" value={newAdic.horas} className="h-7 text-xs text-right w-20 ml-auto"
                          onChange={(e) => setNewAdic((p) => p && { ...p, horas: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="size-7" onClick={insertAdic} disabled={saving}>
                            <Check className="size-3.5 text-emerald-600" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => setNewAdic(null)}>
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newAdic && (
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => { setNewAdic({ nombre: "", horas: "1" }); setAdicEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar adición
                </Button>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

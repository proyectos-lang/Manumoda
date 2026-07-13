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
import {
  type CatFamiliaCorte,
  type CatCategoriaCorte,
  type CatTelaCorte,
  type CatTrazosCorte,
  type CatTendidosCorte,
  type CatComplementoCorte,
} from "@/lib/corte-calc"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onChanged?: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function MultBadge() {
  return (
    <Badge variant="outline" className="border-indigo-200 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-300">
      × Multiplica
    </Badge>
  )
}
function BaseBadge() {
  return (
    <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300">
      Horas base
    </Badge>
  )
}

function ActionButtons({ onSave, onCancel, saving }: { onSave: () => void; onCancel: () => void; saving: boolean }) {
  return (
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" className="size-7" onClick={onSave} disabled={saving}>
        <Check className="size-3.5 text-emerald-600" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" onClick={onCancel}>
        <XIcon className="size-3.5" />
      </Button>
    </div>
  )
}

function EditDeleteButtons({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" className="size-7" onClick={onEdit}>
        <Pencil className="size-3.5 text-muted-foreground" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7 text-destructive/50 hover:text-destructive" onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CorteMultipliersDialog({ open, onOpenChange, onChanged }: Props) {
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)

  const [familias, setFamilias]       = useState<CatFamiliaCorte[]>([])
  const [categorias, setCategorias]   = useState<CatCategoriaCorte[]>([])
  const [telas, setTelas]             = useState<CatTelaCorte[]>([])
  const [trazos, setTrazos]           = useState<CatTrazosCorte[]>([])
  const [tendidos, setTendidos]       = useState<CatTendidosCorte[]>([])
  const [complementos, setComplementos] = useState<CatComplementoCorte[]>([])

  // Edit states
  const [famEdit, setFamEdit]   = useState<{ id: number; nombre: string; grupo: string; horas_base: string } | null>(null)
  const [catEdit, setCatEdit]   = useState<{ id: number; nombre: string; multiplicador: string } | null>(null)
  const [telaEdit, setTelaEdit] = useState<{ id: number; nombre: string; multiplicador: string } | null>(null)
  const [trazEdit, setTrazEdit] = useState<{ id: number; cantidad: string; multiplicador: string } | null>(null)
  const [tendEdit, setTendEdit] = useState<{ id: number; cantidad: string; multiplicador: string } | null>(null)
  const [compEdit, setCompEdit] = useState<{ id: number; nombre: string; clave: string; multiplicador: string } | null>(null)

  // New row states
  const [newFam, setNewFam]   = useState<{ nombre: string; grupo: string; horas_base: string } | null>(null)
  const [newCat, setNewCat]   = useState<{ nombre: string; multiplicador: string } | null>(null)
  const [newTela, setNewTela] = useState<{ nombre: string; multiplicador: string } | null>(null)
  const [newTraz, setNewTraz] = useState<{ cantidad: string; multiplicador: string } | null>(null)
  const [newTend, setNewTend] = useState<{ cantidad: string; multiplicador: string } | null>(null)
  const [newComp, setNewComp] = useState<{ nombre: string; clave: string; multiplicador: string } | null>(null)

  useEffect(() => { if (open) fetchAll() }, [open])

  async function fetchAll() {
    setLoading(true)
    const sb = getSupabase()
    if (!sb) { setLoading(false); return }
    const [fRes, cRes, tRes, trRes, tdRes, coRes] = await Promise.all([
      sb.from("cat_familias_corte").select("id, nombre, grupo, horas_base").eq("idempresa", IDEMPRESA).order("grupo").order("nombre"),
      sb.from("cat_categorias_corte").select("id, nombre, multiplicador").eq("idempresa", IDEMPRESA).order("multiplicador"),
      sb.from("cat_telas_corte").select("id, nombre, multiplicador").eq("idempresa", IDEMPRESA).order("multiplicador"),
      sb.from("cat_trazos_corte").select("id, cantidad, multiplicador").eq("idempresa", IDEMPRESA).order("cantidad"),
      sb.from("cat_tendidos_corte").select("id, cantidad, multiplicador").eq("idempresa", IDEMPRESA).order("cantidad"),
      sb.from("cat_complementos_corte").select("id, nombre, clave, multiplicador").eq("idempresa", IDEMPRESA).order("id"),
    ])
    setFamilias((fRes.data ?? []) as CatFamiliaCorte[])
    setCategorias((cRes.data ?? []) as CatCategoriaCorte[])
    setTelas((tRes.data ?? []) as CatTelaCorte[])
    setTrazos((trRes.data ?? []) as CatTrazosCorte[])
    setTendidos((tdRes.data ?? []) as CatTendidosCorte[])
    setComplementos((coRes.data ?? []) as CatComplementoCorte[])
    setLoading(false)
  }

  // ── Generic CRUD helpers ──────────────────────────────────────────────────────

  async function doUpdate(table: string, id: number, payload: Record<string, unknown>) {
    setSaving(true)
    const { error } = await getSupabase()!.from(table).update(payload).eq("id", id)
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return false }
    fetchAll(); onChanged?.()
    return true
  }

  async function doInsert(table: string, payload: Record<string, unknown>) {
    setSaving(true)
    const { error } = await getSupabase()!.from(table).insert({ idempresa: IDEMPRESA, ...payload })
    setSaving(false)
    if (error) { toast.error("Error al guardar", { description: error.message }); return false }
    fetchAll(); onChanged?.()
    return true
  }

  async function doDelete(table: string, id: number) {
    const { error } = await getSupabase()!.from(table).delete().eq("id", id)
    if (error) { toast.error("Error al eliminar", { description: error.message }); return }
    fetchAll(); onChanged?.()
  }

  // ── Familias ─────────────────────────────────────────────────────────────────

  async function saveFam() {
    if (!famEdit) return
    const horas = parseFloat(famEdit.horas_base)
    if (!famEdit.nombre.trim() || isNaN(horas)) { toast.error("Nombre y horas base requeridos"); return }
    const ok = await doUpdate("cat_familias_corte", famEdit.id, { nombre: famEdit.nombre.trim(), grupo: famEdit.grupo, horas_base: horas })
    if (ok) { setFamEdit(null); toast.success("Familia actualizada") }
  }

  async function insertFam() {
    if (!newFam) return
    const horas = parseFloat(newFam.horas_base)
    if (!newFam.nombre.trim() || isNaN(horas)) { toast.error("Nombre y horas base requeridos"); return }
    const ok = await doInsert("cat_familias_corte", { nombre: newFam.nombre.trim(), grupo: newFam.grupo, horas_base: horas })
    if (ok) { setNewFam(null); toast.success("Familia agregada") }
  }

  // ── Categorías ───────────────────────────────────────────────────────────────

  async function saveCat() {
    if (!catEdit) return
    const mult = parseFloat(catEdit.multiplicador)
    if (!catEdit.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    const ok = await doUpdate("cat_categorias_corte", catEdit.id, { nombre: catEdit.nombre.trim(), multiplicador: mult })
    if (ok) { setCatEdit(null); toast.success("Categoría actualizada") }
  }

  async function insertCat() {
    if (!newCat) return
    const mult = parseFloat(newCat.multiplicador)
    if (!newCat.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    const ok = await doInsert("cat_categorias_corte", { nombre: newCat.nombre.trim(), multiplicador: mult })
    if (ok) { setNewCat(null); toast.success("Categoría agregada") }
  }

  // ── Telas ────────────────────────────────────────────────────────────────────

  async function saveTela() {
    if (!telaEdit) return
    const mult = parseFloat(telaEdit.multiplicador)
    if (!telaEdit.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    const ok = await doUpdate("cat_telas_corte", telaEdit.id, { nombre: telaEdit.nombre.trim(), multiplicador: mult })
    if (ok) { setTelaEdit(null); toast.success("Tela actualizada") }
  }

  async function insertTela() {
    if (!newTela) return
    const mult = parseFloat(newTela.multiplicador)
    if (!newTela.nombre.trim() || isNaN(mult)) { toast.error("Nombre y multiplicador requeridos"); return }
    const ok = await doInsert("cat_telas_corte", { nombre: newTela.nombre.trim(), multiplicador: mult })
    if (ok) { setNewTela(null); toast.success("Tela agregada") }
  }

  // ── Trazos ───────────────────────────────────────────────────────────────────

  async function saveTraz() {
    if (!trazEdit) return
    const cant = parseInt(trazEdit.cantidad, 10)
    const mult = parseFloat(trazEdit.multiplicador)
    if (isNaN(cant) || isNaN(mult)) { toast.error("Cantidad y multiplicador requeridos"); return }
    const ok = await doUpdate("cat_trazos_corte", trazEdit.id, { cantidad: cant, multiplicador: mult })
    if (ok) { setTrazEdit(null); toast.success("Trazos actualizado") }
  }

  async function insertTraz() {
    if (!newTraz) return
    const cant = parseInt(newTraz.cantidad, 10)
    const mult = parseFloat(newTraz.multiplicador)
    if (isNaN(cant) || isNaN(mult)) { toast.error("Cantidad y multiplicador requeridos"); return }
    const ok = await doInsert("cat_trazos_corte", { cantidad: cant, multiplicador: mult })
    if (ok) { setNewTraz(null); toast.success("Trazos agregado") }
  }

  // ── Tendidos ─────────────────────────────────────────────────────────────────

  async function saveTend() {
    if (!tendEdit) return
    const cant = parseInt(tendEdit.cantidad, 10)
    const mult = parseFloat(tendEdit.multiplicador)
    if (isNaN(cant) || isNaN(mult)) { toast.error("Cantidad y multiplicador requeridos"); return }
    const ok = await doUpdate("cat_tendidos_corte", tendEdit.id, { cantidad: cant, multiplicador: mult })
    if (ok) { setTendEdit(null); toast.success("Tendidos actualizado") }
  }

  async function insertTend() {
    if (!newTend) return
    const cant = parseInt(newTend.cantidad, 10)
    const mult = parseFloat(newTend.multiplicador)
    if (isNaN(cant) || isNaN(mult)) { toast.error("Cantidad y multiplicador requeridos"); return }
    const ok = await doInsert("cat_tendidos_corte", { cantidad: cant, multiplicador: mult })
    if (ok) { setNewTend(null); toast.success("Tendidos agregado") }
  }

  // ── Complementos ─────────────────────────────────────────────────────────────

  async function saveComp() {
    if (!compEdit) return
    const mult = parseFloat(compEdit.multiplicador)
    if (!compEdit.nombre.trim() || !compEdit.clave.trim() || isNaN(mult)) { toast.error("Nombre, clave y multiplicador requeridos"); return }
    const ok = await doUpdate("cat_complementos_corte", compEdit.id, { nombre: compEdit.nombre.trim(), clave: compEdit.clave.trim(), multiplicador: mult })
    if (ok) { setCompEdit(null); toast.success("Complemento actualizado") }
  }

  async function insertComp() {
    if (!newComp) return
    const mult = parseFloat(newComp.multiplicador)
    if (!newComp.nombre.trim() || !newComp.clave.trim() || isNaN(mult)) { toast.error("Nombre, clave y multiplicador requeridos"); return }
    const ok = await doInsert("cat_complementos_corte", { nombre: newComp.nombre.trim(), clave: newComp.clave.trim(), multiplicador: mult })
    if (ok) { setNewComp(null); toast.success("Complemento agregado") }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Multiplicadores de Corte</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Horas = horas_base × categoría × tela × trazos × tendidos × complementos
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="familias" className="mt-2">
            <TabsList className="w-full flex-wrap h-auto gap-1">
              <TabsTrigger value="familias" className="text-xs">Familias</TabsTrigger>
              <TabsTrigger value="categorias" className="text-xs">Categorías</TabsTrigger>
              <TabsTrigger value="telas" className="text-xs">Telas</TabsTrigger>
              <TabsTrigger value="trazos" className="text-xs">Trazos</TabsTrigger>
              <TabsTrigger value="tendidos" className="text-xs">Tendidos</TabsTrigger>
              <TabsTrigger value="complementos" className="text-xs">Complementos</TabsTrigger>
            </TabsList>

            {/* ── Familias ── */}
            <TabsContent value="familias" className="mt-4 space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Horas base</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {familias.map((row) =>
                    famEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell><Input value={famEdit.nombre} className="h-7 text-xs" onChange={(e) => setFamEdit(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                        <TableCell><Input value={famEdit.grupo} className="h-7 text-xs w-16" onChange={(e) => setFamEdit(p => p && { ...p, grupo: e.target.value })} /></TableCell>
                        <TableCell><BaseBadge /></TableCell>
                        <TableCell><Input type="number" step="0.5" value={famEdit.horas_base} className="h-7 text-xs text-right w-20 ml-auto" onChange={(e) => setFamEdit(p => p && { ...p, horas_base: e.target.value })} /></TableCell>
                        <TableCell><ActionButtons onSave={saveFam} onCancel={() => setFamEdit(null)} saving={saving} /></TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">{row.nombre}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{row.grupo}</TableCell>
                        <TableCell><BaseBadge /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.horas_base).toFixed(1)} h</TableCell>
                        <TableCell>
                          <EditDeleteButtons
                            onEdit={() => { setFamEdit({ id: row.id, nombre: row.nombre, grupo: String(row.grupo), horas_base: String(row.horas_base) }); setNewFam(null) }}
                            onDelete={() => doDelete("cat_familias_corte", row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newFam && (
                    <TableRow>
                      <TableCell><Input autoFocus placeholder="Nombre" value={newFam.nombre} className="h-7 text-xs" onChange={(e) => setNewFam(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                      <TableCell><Input placeholder="Grupo" value={newFam.grupo} className="h-7 text-xs w-16" onChange={(e) => setNewFam(p => p && { ...p, grupo: e.target.value })} /></TableCell>
                      <TableCell><BaseBadge /></TableCell>
                      <TableCell><Input type="number" step="0.5" placeholder="0.0" value={newFam.horas_base} className="h-7 text-xs text-right w-20 ml-auto" onChange={(e) => setNewFam(p => p && { ...p, horas_base: e.target.value })} /></TableCell>
                      <TableCell><ActionButtons onSave={insertFam} onCancel={() => setNewFam(null)} saving={saving} /></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newFam && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setNewFam({ nombre: "", grupo: "", horas_base: "" }); setFamEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar familia
                </Button>
              )}
            </TabsContent>

            {/* ── Categorías ── */}
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
                        <TableCell><Input value={catEdit.nombre} className="h-7 text-xs" onChange={(e) => setCatEdit(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={catEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setCatEdit(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                        <TableCell><ActionButtons onSave={saveCat} onCancel={() => setCatEdit(null)} saving={saving} /></TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">{row.nombre}</TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <EditDeleteButtons
                            onEdit={() => { setCatEdit({ id: row.id, nombre: row.nombre, multiplicador: String(row.multiplicador) }); setNewCat(null) }}
                            onDelete={() => doDelete("cat_categorias_corte", row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newCat && (
                    <TableRow>
                      <TableCell><Input autoFocus placeholder="Nombre" value={newCat.nombre} className="h-7 text-xs" onChange={(e) => setNewCat(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                      <TableCell><MultBadge /></TableCell>
                      <TableCell><Input type="number" step="0.01" placeholder="1.00" value={newCat.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setNewCat(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                      <TableCell><ActionButtons onSave={insertCat} onCancel={() => setNewCat(null)} saving={saving} /></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newCat && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setNewCat({ nombre: "", multiplicador: "1.00" }); setCatEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar categoría
                </Button>
              )}
            </TabsContent>

            {/* ── Telas ── */}
            <TabsContent value="telas" className="mt-4 space-y-3">
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
                  {telas.map((row) =>
                    telaEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell><Input value={telaEdit.nombre} className="h-7 text-xs" onChange={(e) => setTelaEdit(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={telaEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setTelaEdit(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                        <TableCell><ActionButtons onSave={saveTela} onCancel={() => setTelaEdit(null)} saving={saving} /></TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">{row.nombre}</TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <EditDeleteButtons
                            onEdit={() => { setTelaEdit({ id: row.id, nombre: row.nombre, multiplicador: String(row.multiplicador) }); setNewTela(null) }}
                            onDelete={() => doDelete("cat_telas_corte", row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newTela && (
                    <TableRow>
                      <TableCell><Input autoFocus placeholder="Nombre" value={newTela.nombre} className="h-7 text-xs" onChange={(e) => setNewTela(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                      <TableCell><MultBadge /></TableCell>
                      <TableCell><Input type="number" step="0.01" placeholder="1.00" value={newTela.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setNewTela(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                      <TableCell><ActionButtons onSave={insertTela} onCancel={() => setNewTela(null)} saving={saving} /></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newTela && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setNewTela({ nombre: "", multiplicador: "1.00" }); setTelaEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar tipo de tela
                </Button>
              )}
            </TabsContent>

            {/* ── Trazos ── */}
            <TabsContent value="trazos" className="mt-4 space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Multiplicador</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trazos.map((row) =>
                    trazEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell><Input type="number" value={trazEdit.cantidad} className="h-7 text-xs w-20" onChange={(e) => setTrazEdit(p => p && { ...p, cantidad: e.target.value })} /></TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={trazEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setTrazEdit(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                        <TableCell><ActionButtons onSave={saveTraz} onCancel={() => setTrazEdit(null)} saving={saving} /></TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.cantidad} trazos</TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <EditDeleteButtons
                            onEdit={() => { setTrazEdit({ id: row.id, cantidad: String(row.cantidad), multiplicador: String(row.multiplicador) }); setNewTraz(null) }}
                            onDelete={() => doDelete("cat_trazos_corte", row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newTraz && (
                    <TableRow>
                      <TableCell><Input autoFocus type="number" placeholder="Nº" value={newTraz.cantidad} className="h-7 text-xs w-20" onChange={(e) => setNewTraz(p => p && { ...p, cantidad: e.target.value })} /></TableCell>
                      <TableCell><MultBadge /></TableCell>
                      <TableCell><Input type="number" step="0.01" placeholder="1.00" value={newTraz.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setNewTraz(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                      <TableCell><ActionButtons onSave={insertTraz} onCancel={() => setNewTraz(null)} saving={saving} /></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newTraz && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setNewTraz({ cantidad: "", multiplicador: "1.00" }); setTrazEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar trazos
                </Button>
              )}
            </TabsContent>

            {/* ── Tendidos ── */}
            <TabsContent value="tendidos" className="mt-4 space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Multiplicador</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tendidos.map((row) =>
                    tendEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell><Input type="number" value={tendEdit.cantidad} className="h-7 text-xs w-20" onChange={(e) => setTendEdit(p => p && { ...p, cantidad: e.target.value })} /></TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={tendEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setTendEdit(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                        <TableCell><ActionButtons onSave={saveTend} onCancel={() => setTendEdit(null)} saving={saving} /></TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.cantidad} tendidos</TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <EditDeleteButtons
                            onEdit={() => { setTendEdit({ id: row.id, cantidad: String(row.cantidad), multiplicador: String(row.multiplicador) }); setNewTend(null) }}
                            onDelete={() => doDelete("cat_tendidos_corte", row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newTend && (
                    <TableRow>
                      <TableCell><Input autoFocus type="number" placeholder="Nº" value={newTend.cantidad} className="h-7 text-xs w-20" onChange={(e) => setNewTend(p => p && { ...p, cantidad: e.target.value })} /></TableCell>
                      <TableCell><MultBadge /></TableCell>
                      <TableCell><Input type="number" step="0.01" placeholder="1.00" value={newTend.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setNewTend(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                      <TableCell><ActionButtons onSave={insertTend} onCancel={() => setNewTend(null)} saving={saving} /></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newTend && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setNewTend({ cantidad: "", multiplicador: "1.00" }); setTendEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar tendidos
                </Button>
              )}
            </TabsContent>

            {/* ── Complementos ── */}
            <TabsContent value="complementos" className="mt-4 space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Clave</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead className="text-right">Multiplicador</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {complementos.map((row) =>
                    compEdit?.id === row.id ? (
                      <TableRow key={row.id}>
                        <TableCell><Input value={compEdit.nombre} className="h-7 text-xs" onChange={(e) => setCompEdit(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                        <TableCell><Input value={compEdit.clave} className="h-7 text-xs font-mono" onChange={(e) => setCompEdit(p => p && { ...p, clave: e.target.value })} /></TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={compEdit.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setCompEdit(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                        <TableCell><ActionButtons onSave={saveComp} onCancel={() => setCompEdit(null)} saving={saving} /></TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">{row.nombre}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.clave}</TableCell>
                        <TableCell><MultBadge /></TableCell>
                        <TableCell className="text-right font-mono">{Number(row.multiplicador).toFixed(2)}</TableCell>
                        <TableCell>
                          <EditDeleteButtons
                            onEdit={() => { setCompEdit({ id: row.id, nombre: row.nombre, clave: row.clave, multiplicador: String(row.multiplicador) }); setNewComp(null) }}
                            onDelete={() => doDelete("cat_complementos_corte", row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                  {newComp && (
                    <TableRow>
                      <TableCell><Input autoFocus placeholder="Nombre" value={newComp.nombre} className="h-7 text-xs" onChange={(e) => setNewComp(p => p && { ...p, nombre: e.target.value })} /></TableCell>
                      <TableCell><Input placeholder="clave_db" value={newComp.clave} className="h-7 text-xs font-mono" onChange={(e) => setNewComp(p => p && { ...p, clave: e.target.value })} /></TableCell>
                      <TableCell><MultBadge /></TableCell>
                      <TableCell><Input type="number" step="0.01" placeholder="1.00" value={newComp.multiplicador} className="h-7 text-xs text-right w-24 ml-auto" onChange={(e) => setNewComp(p => p && { ...p, multiplicador: e.target.value })} /></TableCell>
                      <TableCell><ActionButtons onSave={insertComp} onCancel={() => setNewComp(null)} saving={saving} /></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {!newComp && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setNewComp({ nombre: "", clave: "", multiplicador: "1.00" }); setCompEdit(null) }}>
                  <Plus className="size-3.5" /> Agregar complemento
                </Button>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

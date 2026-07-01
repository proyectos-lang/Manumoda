"use client"

import { useEffect, useState } from "react"
import { Loader2, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// ─── Generic row type for variable tables ─────────────────────────────────────

type VarRow = {
  id: number
  nombre?: string
  cantidad?: number
  clave?: string
  grupo?: string
  horas_base?: number
  multiplicador?: number
}

// ─── Editable number cell (saves on blur) ─────────────────────────────────────

function EditableNumber({
  value,
  onSave,
  min = 0,
  step = "0.001",
}: {
  value: number
  onSave: (v: number) => Promise<void>
  min?: number
  step?: string
}) {
  const [local, setLocal] = useState(String(value))
  const [saving, setSaving] = useState(false)

  useEffect(() => { setLocal(String(value)) }, [value])

  const commit = async () => {
    const n = parseFloat(local)
    if (isNaN(n) || n === value) { setLocal(String(value)); return }
    setSaving(true)
    await onSave(n)
    setSaving(false)
  }

  return (
    <div className="relative inline-flex items-center justify-end">
      <Input
        type="number"
        value={local}
        min={min}
        step={step}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
        disabled={saving}
        className="h-8 w-28 text-right text-sm pr-7"
      />
      {saving && <Loader2 className="pointer-events-none absolute right-2.5 size-3 animate-spin text-muted-foreground" />}
    </div>
  )
}

// ─── Table wrapper ────────────────────────────────────────────────────────────

function VarTableWrapper({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  return (
    <div className="rounded-lg border">
      <Table>{children}</Table>
    </div>
  )
}

// ─── Tab: Familias ────────────────────────────────────────────────────────────

function FamiliasTab() {
  const [rows, setRows] = useState<VarRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    sb.from("cat_familias_corte")
      .select("id, nombre, grupo, horas_base")
      .eq("idempresa", IDEMPRESA)
      .order("grupo")
      .order("nombre")
      .then(({ data }) => { setRows((data as VarRow[]) ?? []); setLoading(false) })
  }, [])

  const save = async (id: number, horas_base: number) => {
    const sb = getSupabase()
    if (!sb) return
    const { error } = await sb
      .from("cat_familias_corte")
      .update({ horas_base })
      .eq("id", id)
      .eq("idempresa", IDEMPRESA)
    if (error) toast.error("No se pudo guardar", { description: error.message })
    else {
      setRows(prev => prev.map(r => r.id === id ? { ...r, horas_base } : r))
      toast.success("Guardado")
    }
  }

  return (
    <VarTableWrapper loading={loading}>
      <TableHeader>
        <TableRow>
          <TableHead>Prenda</TableHead>
          <TableHead className="text-center">Grupo</TableHead>
          <TableHead className="text-right">Horas Base</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.nombre}</TableCell>
            <TableCell className="text-center text-muted-foreground">{r.grupo}</TableCell>
            <TableCell className="text-right">
              <EditableNumber
                value={r.horas_base ?? 0}
                min={0}
                step="0.01"
                onSave={(v) => save(r.id, v)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </VarTableWrapper>
  )
}

// ─── Generic multiplicador tab ────────────────────────────────────────────────

function MultTab({
  tableName,
  labelKey,
  labelTitle,
  orderKey,
}: {
  tableName: string
  labelKey: "nombre" | "cantidad"
  labelTitle: string
  orderKey?: string
}) {
  const [rows, setRows] = useState<VarRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    sb.from(tableName)
      .select("*")
      .eq("idempresa", IDEMPRESA)
      .order(orderKey ?? labelKey)
      .then(({ data }) => { setRows((data as VarRow[]) ?? []); setLoading(false) })
  }, [tableName, labelKey, orderKey])

  const save = async (id: number, multiplicador: number) => {
    const sb = getSupabase()
    if (!sb) return
    const { error } = await sb
      .from(tableName)
      .update({ multiplicador })
      .eq("id", id)
      .eq("idempresa", IDEMPRESA)
    if (error) toast.error("No se pudo guardar", { description: error.message })
    else {
      setRows(prev => prev.map(r => r.id === id ? { ...r, multiplicador } : r))
      toast.success("Guardado")
    }
  }

  return (
    <VarTableWrapper loading={loading}>
      <TableHeader>
        <TableRow>
          <TableHead>{labelTitle}</TableHead>
          <TableHead className="text-right">Multiplicador</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">
              {labelKey === "nombre" ? r.nombre : r.cantidad}
            </TableCell>
            <TableCell className="text-right">
              <EditableNumber
                value={r.multiplicador ?? 1}
                min={0}
                onSave={(v) => save(r.id, v)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </VarTableWrapper>
  )
}

// ─── Main Sheet ───────────────────────────────────────────────────────────────

export function EditCorteVariablesSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden"
      >
        <SheetHeader className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
              <Settings2 className="size-4 text-amber-700" />
            </div>
            <div>
              <SheetTitle>Editar Variables de Corte</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                Los cambios se guardan automáticamente al salir del campo.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <Tabs defaultValue="familias">
            <TabsList className="mb-4 flex h-auto flex-wrap gap-1">
              <TabsTrigger value="familias">Familias</TabsTrigger>
              <TabsTrigger value="categorias">Categorías</TabsTrigger>
              <TabsTrigger value="telas">Tipos de Tela</TabsTrigger>
              <TabsTrigger value="trazos">Trazos</TabsTrigger>
              <TabsTrigger value="tendidos">Tendidos</TabsTrigger>
              <TabsTrigger value="complementos">Complementos</TabsTrigger>
            </TabsList>

            <TabsContent value="familias" className="space-y-2">
              <p className="text-xs text-muted-foreground">Horas base por tipo de prenda. Sirven como punto de partida del cálculo.</p>
              <FamiliasTab />
            </TabsContent>

            <TabsContent value="categorias" className="space-y-2">
              <p className="text-xs text-muted-foreground">Multiplicador según la categoría demográfica del producto.</p>
              <MultTab tableName="cat_categorias_corte" labelKey="nombre" labelTitle="Categoría" orderKey="multiplicador" />
            </TabsContent>

            <TabsContent value="telas" className="space-y-2">
              <p className="text-xs text-muted-foreground">Multiplicador según el tipo o peso de la tela.</p>
              <MultTab tableName="cat_telas_corte" labelKey="nombre" labelTitle="Tipo de Tela" orderKey="multiplicador" />
            </TabsContent>

            <TabsContent value="trazos" className="space-y-2">
              <p className="text-xs text-muted-foreground">Multiplicador según el número de trazos (1–5).</p>
              <MultTab tableName="cat_trazos_corte" labelKey="cantidad" labelTitle="Trazos" orderKey="cantidad" />
            </TabsContent>

            <TabsContent value="tendidos" className="space-y-2">
              <p className="text-xs text-muted-foreground">Multiplicador según el número de tendidos (1–8).</p>
              <MultTab tableName="cat_tendidos_corte" labelKey="cantidad" labelTitle="Tendidos" orderKey="cantidad" />
            </TabsContent>

            <TabsContent value="complementos" className="space-y-2">
              <p className="text-xs text-muted-foreground">Multiplicador por cada complemento de producción. Se aplican de forma multiplicativa entre sí.</p>
              <MultTab tableName="cat_complementos_corte" labelKey="nombre" labelTitle="Complemento" orderKey="id" />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}

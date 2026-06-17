"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RefreshCw, Search, X } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { VwBonosCorte, VwPlanCorteDetalle } from "@/lib/types"
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MESA_OPTIONS = ["Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4", "Mesa 5"]

const CUMPLIMIENTO_STYLES: Record<string, string> = {
  Pendiente: "bg-slate-100 text-slate-600 border-slate-200",
  Si: "bg-emerald-100 text-emerald-700 border-emerald-200",
  No: "bg-rose-100 text-rose-700 border-rose-200",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHrs(n: number | null | undefined) {
  if (n == null) return "—"
  return n.toFixed(2)
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return "—"
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n)
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—"
  return `${n.toFixed(2)}%`
}

type Cortador = { id: number; nombre: string }

// ─── Main Module ─────────────────────────────────────────────────────────────

export function CorteModule({ configMissing }: { configMissing: boolean }) {
  return (
    <Tabs defaultValue="plan" className="w-full">
      <TabsList>
        <TabsTrigger value="plan">Plan de Corte Semanal</TabsTrigger>
        <TabsTrigger value="bonos">Liquidación y Bonos</TabsTrigger>
      </TabsList>

      <TabsContent value="plan" className="mt-5">
        <PlanCorteTab configMissing={configMissing} />
      </TabsContent>

      <TabsContent value="bonos" className="mt-5">
        <BonosCorteTab configMissing={configMissing} />
      </TabsContent>
    </Tabs>
  )
}

// ─── Tab 1: Plan de Corte ─────────────────────────────────────────────────────

type PatchRow = {
  idcortador: number | null
  idapoyo: number | null
  mesa: string | null
  variable_subjetiva: number | null
  cumplimiento_corte: string | null
}

function PlanCorteTab({ configMissing }: { configMissing: boolean }) {
  const [rows, setRows] = useState<VwPlanCorteDetalle[]>([])
  const [cortadores, setCortadores] = useState<Cortador[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [filterSemana, setFilterSemana] = useState<string>("__all__")
  const [search, setSearch] = useState("")

  // Local overrides for inline edits (keyed by registro_id)
  const [localRows, setLocalRows] = useState<Record<number, Partial<PatchRow>>>({})

  const fetchData = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const [planRes, cortRes] = await Promise.all([
      supabase
        .from("vw_plan_corte_detalle")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .order("semana", { ascending: false })
        .order("folio"),
      supabase
        .from("cortadores")
        .select("id, nombre")
        .eq("activo", true)
        .eq("idempresa", IDEMPRESA)
        .order("nombre"),
    ])
    setLoading(false)

    if (planRes.error) {
      toast.error("No se pudo cargar el plan de corte", { description: planRes.error.message })
    } else {
      setRows((planRes.data as VwPlanCorteDetalle[]) ?? [])
      setLocalRows({})
    }

    if (!cortRes.error) {
      setCortadores((cortRes.data as Cortador[]) ?? [])
    }
  }, [configMissing])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Semana options derived from data
  const semanaOptions = useMemo(() => {
    const seen = new Set<number>()
    const opts: number[] = []
    for (const r of rows) {
      if (r.semana != null && !seen.has(r.semana)) {
        seen.add(r.semana)
        opts.push(r.semana)
      }
    }
    return opts.sort((a, b) => b - a)
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filterSemana !== "__all__") {
      list = list.filter((r) => r.semana === Number(filterSemana))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.folio.toLowerCase().includes(q) ||
          (r.familia ?? "").toLowerCase().includes(q) ||
          (r.tipo_tela ?? "").toLowerCase().includes(q),
      )
    }
    return list
  }, [rows, filterSemana, search])

  // Merge view data with local overrides for display
  function mergedRow(r: VwPlanCorteDetalle): VwPlanCorteDetalle & Partial<PatchRow> {
    return { ...r, ...(localRows[r.registro_id] ?? {}) }
  }

  // Auto-save handler for select/input fields
  async function handleFieldSave(registroId: number, field: keyof PatchRow, value: PatchRow[keyof PatchRow]) {
    const supabase = getSupabase()
    if (!supabase) return

    // Update local state immediately for snappy UI
    setLocalRows((prev) => ({
      ...prev,
      [registroId]: { ...prev[registroId], [field]: value },
    }))

    setSavingId(registroId)
    const { error } = await supabase
      .from("corte_programacion")
      .update({ [field]: value })
      .eq("id", registroId)
      .eq("idempresa", IDEMPRESA)
    setSavingId(null)

    if (error) {
      toast.error("No se pudo guardar el cambio", { description: error.message })
      // Revert local state
      setLocalRows((prev) => {
        const copy = { ...prev }
        delete copy[registroId]
        return copy
      })
    } else {
      // Refetch to get recalculated hours from the view
      await fetchData()
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar folio, familia, tela…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 pr-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Select value={filterSemana} onValueChange={setFilterSemana}>
          <SelectTrigger className="h-9 w-40 text-sm">
            <SelectValue placeholder="Semana…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las semanas</SelectItem>
            {semanaOptions.map((s) => (
              <SelectItem key={s} value={String(s)}>
                Semana {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} registro{filtered.length !== 1 ? "s" : ""}</span>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5 bg-transparent">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Actualizar
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="whitespace-nowrap font-semibold">Folio</TableHead>
              <TableHead className="font-semibold">Familia</TableHead>
              <TableHead className="font-semibold">Categoría</TableHead>
              <TableHead className="font-semibold">Tela</TableHead>
              <TableHead className="text-right font-semibold">Metros</TableHead>
              <TableHead className="font-semibold">Complejidad</TableHead>
              <TableHead className="text-center font-semibold">Comb.</TableHead>
              <TableHead className="text-right font-semibold">Piezas</TableHead>
              <TableHead className="min-w-[140px] font-semibold">Cortador</TableHead>
              <TableHead className="min-w-[140px] font-semibold">Apoyo</TableHead>
              <TableHead className="min-w-[110px] font-semibold">Mesa</TableHead>
              <TableHead className="text-right font-semibold">Trazos</TableHead>
              <TableHead className="text-right font-semibold">Hrs Plan</TableHead>
              <TableHead className="min-w-[90px] text-right font-semibold">Variable</TableHead>
              <TableHead className="text-right font-semibold">Hrs Final</TableHead>
              <TableHead className="min-w-[130px] font-semibold">Cumplimiento</TableHead>
              <TableHead className="text-right font-semibold">Hrs Cum.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 17 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={17} className="h-28 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "No hay registros en el plan de corte." : "Sin resultados para esta búsqueda."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const m = mergedRow(r)
                const isSaving = savingId === r.registro_id
                return (
                  <TableRow key={r.registro_id} className={cn("text-sm", isSaving && "opacity-60")}>
                    <TableCell className="font-mono font-semibold">{r.folio}</TableCell>
                    <TableCell className="text-muted-foreground">{r.familia ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.categoria ?? "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate text-xs">{r.tipo_tela ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.metros_utilizar ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-normal">
                        {r.complejidad_de_tela ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {r.combinacion ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">Sí</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.no_piezas ?? "—"}</TableCell>

                    {/* Cortador — inline Select */}
                    <TableCell>
                      <Select
                        value={String(m.idcortador ?? "__none__")}
                        onValueChange={(v) =>
                          handleFieldSave(r.registro_id, "idcortador", v === "__none__" ? null : Number(v))
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8 w-full text-xs">
                          <SelectValue placeholder="Asignar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin asignar</SelectItem>
                          {cortadores.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Apoyo — inline Select */}
                    <TableCell>
                      <Select
                        value={String(m.idapoyo ?? "__none__")}
                        onValueChange={(v) =>
                          handleFieldSave(r.registro_id, "idapoyo", v === "__none__" ? null : Number(v))
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8 w-full text-xs">
                          <SelectValue placeholder="Sin apoyo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin apoyo</SelectItem>
                          {cortadores.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Mesa — inline input (save on blur) */}
                    <TableCell>
                      <MesaCell
                        value={m.mesa ?? ""}
                        disabled={isSaving}
                        onSave={(v) => handleFieldSave(r.registro_id, "mesa", v || null)}
                      />
                    </TableCell>

                    <TableCell className="text-right tabular-nums">{r.trazos ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtHrs(r.horas_plan_corte)}</TableCell>

                    {/* Variable Subjetiva — inline input (save on blur) */}
                    <TableCell>
                      <VariableCell
                        value={m.variable_subjetiva ?? 0}
                        disabled={isSaving}
                        onSave={(v) => handleFieldSave(r.registro_id, "variable_subjetiva", v)}
                      />
                    </TableCell>

                    <TableCell className="text-right tabular-nums font-semibold">{fmtHrs(r.horas_plan_final)}</TableCell>

                    {/* Cumplimiento — inline Select */}
                    <TableCell>
                      <Select
                        value={m.cumplimiento_corte ?? "Pendiente"}
                        onValueChange={(v) => handleFieldSave(r.registro_id, "cumplimiento_corte", v)}
                        disabled={isSaving}
                      >
                        <SelectTrigger className={cn("h-8 w-full border text-xs font-medium", CUMPLIMIENTO_STYLES[m.cumplimiento_corte ?? "Pendiente"])}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["Pendiente", "Si", "No"].map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {r.horas_cumplimiento_corte != null && r.horas_cumplimiento_corte > 0 ? (
                        <span className="font-semibold text-emerald-600">{fmtHrs(r.horas_cumplimiento_corte)}</span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ─── Inline cell helpers ──────────────────────────────────────────────────────

function MesaCell({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value)
  const initialRef = useRef(value)

  useEffect(() => {
    setLocal(value)
    initialRef.current = value
  }, [value])

  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== initialRef.current) onSave(local) }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      disabled={disabled}
      maxLength={20}
      placeholder="—"
      className="h-8 text-xs"
    />
  )
}

function VariableCell({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (v: number) => void }) {
  const [local, setLocal] = useState(String(value))
  const initialRef = useRef(String(value))

  useEffect(() => {
    setLocal(String(value))
    initialRef.current = String(value)
  }, [value])

  const commit = () => {
    const n = parseFloat(local)
    const clamped = isNaN(n) ? 0 : Math.min(2, Math.max(-2, n))
    const str = String(clamped)
    if (str !== initialRef.current) onSave(clamped)
  }

  return (
    <Input
      type="number"
      min="-2"
      max="2"
      step="0.5"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      disabled={disabled}
      className="h-8 w-20 text-right text-xs"
    />
  )
}

// ─── Tab 2: Bonos de Corte ────────────────────────────────────────────────────

function BonosCorteTab({ configMissing }: { configMissing: boolean }) {
  const [bonos, setBonos] = useState<VwBonosCorte[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>("")

  const fetchBonos = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase
      .from("vw_bonos_corte")
      .select("*")
      .order("anio", { ascending: false })
      .order("semana", { ascending: false })
      .order("nombre")
    setLoading(false)

    if (error) {
      toast.error("No se pudo cargar la liquidación de corte", { description: error.message })
      return
    }
    const list = (data as VwBonosCorte[]) ?? []
    setBonos(list)

    // Default to most recent week
    if (list.length > 0 && !selectedWeekKey) {
      const first = list[0]
      setSelectedWeekKey(`${first.anio ?? "?"}-${first.semana}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configMissing])

  useEffect(() => {
    fetchBonos()
  }, [fetchBonos])

  const weekOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { key: string; label: string }[] = []
    for (const r of bonos) {
      const k = `${r.anio ?? "?"}-${r.semana}`
      if (!seen.has(k)) {
        seen.add(k)
        opts.push({ key: k, label: `Año ${r.anio} · Semana ${r.semana}` })
      }
    }
    return opts
  }, [bonos])

  const filtered = useMemo(
    () => bonos.filter((r) => `${r.anio ?? "?"}-${r.semana}` === selectedWeekKey),
    [bonos, selectedWeekKey],
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedWeekKey} onValueChange={setSelectedWeekKey}>
          <SelectTrigger className="h-9 w-56 text-sm">
            <SelectValue placeholder="Seleccionar semana…" />
          </SelectTrigger>
          <SelectContent>
            {weekOptions.map((o) => (
              <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} colaborador{filtered.length !== 1 ? "es" : ""}</span>
          <Button variant="outline" size="sm" onClick={fetchBonos} disabled={loading} className="gap-1.5 bg-transparent">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Actualizar
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Nombre</TableHead>
              <TableHead className="font-semibold">Área</TableHead>
              <TableHead className="text-right font-semibold">Hrs Semana</TableHead>
              <TableHead className="text-right font-semibold">Hrs Cumplidas</TableHead>
              <TableHead className="text-right font-semibold">Hrs Fuera</TableHead>
              <TableHead className="text-right font-semibold">Ausentismos</TableHead>
              <TableHead className="text-right font-semibold">% Eficiencia</TableHead>
              <TableHead className="text-center font-semibold">Aceptación</TableHead>
              <TableHead className="text-center font-semibold">¿Bono?</TableHead>
              <TableHead className="text-right font-semibold">Monto</TableHead>
              <TableHead className="text-right font-semibold">% Productividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && bonos.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-28 text-center text-sm text-muted-foreground">
                  {bonos.length === 0 ? "Sin datos de liquidación de corte." : "Sin datos para la semana seleccionada."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const isBaja = r.estatus_colaborador === "Baja"
                return (
                  <TableRow key={`${r.registro}-${r.anio}-${r.semana}`} className={cn("text-sm", isBaja && "opacity-60")}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.nombre ?? "—"}</span>
                        {isBaja && (
                          <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 text-[10px]">
                            Baja
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                        {r.area ?? "Corte"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHrs(r.horas_semana)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtHrs(r.horas_cumplidas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHrs(r.horas_fuera_area)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.ausentismos ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {r.porcentaje_eficiencia != null ? (
                        <span className={cn(
                          "tabular-nums font-semibold",
                          r.porcentaje_eficiencia >= 80 ? "text-emerald-600" :
                          r.porcentaje_eficiencia >= 70 ? "text-amber-600" : "text-rose-600",
                        )}>
                          {fmtPct(r.porcentaje_eficiencia)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.criterio_aceptacion === "Si" ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">Sí</Badge>
                      ) : r.criterio_aceptacion === "No" ? (
                        <Badge className="bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100">No</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.bono_semanal === "Si" ? (
                        <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100">✓ Bono</Badge>
                      ) : r.bono_semanal === "No" ? (
                        <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200">Sin bono</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {r.monto != null ? (
                        <span className={r.monto > 0 ? "text-emerald-700" : "text-muted-foreground"}>
                          {fmtCurrency(r.monto)}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPct(r.porcentaje_productividad_directa)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import { getISOWeek } from "date-fns"
import { Check, ChevronsUpDown, Loader2, Scissors } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import {
  type CatFamiliaCorte,
  type CatCategoriaCorte,
  type CatTelaCorte,
  type CatTrazosCorte,
  type CatTendidosCorte,
  type CatComplementoCorte,
  calcHorasCorte,
} from "@/lib/corte-calc"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

type Cortador = { id: number; nombre: string }

type FormState = {
  idfamilia: string
  categoriaCorte: string
  categoriaTela: string
  trazos: string
  tendidos: string
  compCombinacion: boolean
  compEntretela: boolean
  compPoquetin: boolean
  compForro: boolean
  idcortador: string
  idapoyo: string
  piezas_cortadas: string
}

const EMPTY_FORM: FormState = {
  idfamilia: "",
  categoriaCorte: "",
  categoriaTela: "",
  trazos: "",
  tendidos: "",
  compCombinacion: false,
  compEntretela: false,
  compPoquetin: false,
  compForro: false,
  idcortador: "",
  idapoyo: "",
  piezas_cortadas: "",
}

// ─── Dark-theme styling constants ─────────────────────────────────────────────

const DARK_INPUT =
  "border-white/15 bg-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20 focus-visible:border-white/30"

const DARK_SELECT_TRIGGER =
  "border-white/15 bg-white/10 text-white data-[placeholder]:text-white/40 focus:ring-white/20"

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Req() {
  return <span className="ml-0.5 text-rose-400">*</span>
}

function DLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-white/70">
      {children}
    </label>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">{title}</p>
      {children}
    </section>
  )
}

function OrderField({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-white/40">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm font-medium text-white/90", mono && "font-mono text-xs")}>
        {value ?? <span className="text-white/25">—</span>}
      </dd>
    </div>
  )
}

function ComplementoCheck({
  id,
  label,
  mult,
  checked,
  onChange,
}: {
  id: string
  label: string
  mult: number
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
        checked
          ? "border-indigo-500/50 bg-indigo-500/20"
          : "border-white/10 bg-white/5 hover:bg-white/10",
      )}
      onClick={() => onChange(!checked)}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="border-white/40 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="cursor-pointer text-xs font-medium text-white/80 pointer-events-none">
          {label}
        </label>
        <p className="text-[10px] text-white/40">×{mult.toFixed(2)}</p>
      </div>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ScheduleCutDialog({
  open,
  onOpenChange,
  orden,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orden: OrdenProduccion | null
  onSaved: () => void
}) {
  const [familias, setFamilias] = useState<CatFamiliaCorte[]>([])
  const [categorias, setCategorias] = useState<CatCategoriaCorte[]>([])
  const [telas, setTelas] = useState<CatTelaCorte[]>([])
  const [trazosOpts, setTrazosOpts] = useState<CatTrazosCorte[]>([])
  const [tendidosOpts, setTendidosOpts] = useState<CatTendidosCorte[]>([])
  const [complementos, setComplementos] = useState<CatComplementoCorte[]>([])
  const [cortadores, setCortadores] = useState<Cortador[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [telaPopoverOpen, setTelaPopoverOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Load catalogs & reset form on open ────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM)
      setTelaPopoverOpen(false)
      return
    }
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    Promise.all([
      supabase.from("cat_familias_corte").select("id, nombre, grupo, horas_base").eq("idempresa", IDEMPRESA).order("grupo").order("nombre"),
      supabase.from("cat_categorias_corte").select("id, nombre, multiplicador").eq("idempresa", IDEMPRESA).order("multiplicador"),
      supabase.from("cat_telas_corte").select("id, nombre, multiplicador").eq("idempresa", IDEMPRESA).order("multiplicador"),
      supabase.from("cat_trazos_corte").select("id, cantidad, multiplicador").eq("idempresa", IDEMPRESA).order("cantidad"),
      supabase.from("cat_tendidos_corte").select("id, cantidad, multiplicador").eq("idempresa", IDEMPRESA).order("cantidad"),
      supabase.from("cat_complementos_corte").select("id, nombre, clave, multiplicador").eq("idempresa", IDEMPRESA).order("id"),
      supabase.from("cortadores").select("id, nombre").eq("activo", true).order("nombre"),
    ]).then(([fRes, catRes, telaRes, trazRes, tendRes, compRes, cortRes]) => {
      const familiasList = (fRes.data as CatFamiliaCorte[]) ?? []
      setFamilias(familiasList)
      const matched = familiasList.find(
        f => f.nombre.toUpperCase() === (orden?.familia ?? "").toUpperCase()
      )
      if (matched) setForm(prev => ({ ...prev, idfamilia: String(matched.id) }))
      setCategorias((catRes.data as CatCategoriaCorte[]) ?? [])
      setTelas((telaRes.data as CatTelaCorte[]) ?? [])
      setTrazosOpts((trazRes.data as CatTrazosCorte[]) ?? [])
      setTendidosOpts((tendRes.data as CatTendidosCorte[]) ?? [])
      setComplementos((compRes.data as CatComplementoCorte[]) ?? [])
      setCortadores((cortRes.data as Cortador[]) ?? [])
      setLoading(false)
    })
  }, [open])

  // ── Real-time hours calculation ────────────────────────────────────────────
  const horasCalculadas = useMemo(() => {
    const familia = familias.find(f => String(f.id) === form.idfamilia)
    const catData = categorias.find(c => c.nombre === form.categoriaCorte)
    const telaData = telas.find(t => t.nombre === form.categoriaTela)
    const trazosData = trazosOpts.find(t => t.cantidad === Number(form.trazos))
    const tendData = tendidosOpts.find(t => t.cantidad === Number(form.tendidos))
    if (!familia || !catData || !telaData || !trazosData || !tendData) return null
    return calcHorasCorte({
      horasBase: familia.horas_base,
      catMult: catData.multiplicador,
      telaMult: telaData.multiplicador,
      trazosMult: trazosData.multiplicador,
      tendidosMult: tendData.multiplicador,
      compCombinacion: form.compCombinacion,
      compEntretela: form.compEntretela,
      compPoquetin: form.compPoquetin,
      compForro: form.compForro,
      complementos,
    })
  }, [form, familias, categorias, telas, trazosOpts, tendidosOpts, complementos])

  // Complement combined multiplier for preview
  const previewCompMult = useMemo(() => {
    if (!complementos.length) return 1
    let mult = 1
    if (form.compCombinacion) mult *= complementos.find(c => c.clave === "comp_combinacion")?.multiplicador ?? 1
    if (form.compEntretela)   mult *= complementos.find(c => c.clave === "comp_entretela")?.multiplicador ?? 1
    if (form.compPoquetin)    mult *= complementos.find(c => c.clave === "comp_poquetin")?.multiplicador ?? 1
    if (form.compForro)       mult *= complementos.find(c => c.clave === "comp_forro")?.multiplicador ?? 1
    return mult
  }, [form, complementos])

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!orden?.id || !orden.folio) return

    if (!form.idfamilia) { toast.error("Campo requerido", { description: "Selecciona la familia de corte." }); return }
    if (!form.categoriaCorte) { toast.error("Campo requerido", { description: "Selecciona la categoría." }); return }
    if (!form.categoriaTela) { toast.error("Campo requerido", { description: "Selecciona el tipo de tela." }); return }
    const trazosNum = parseInt(form.trazos, 10)
    if (isNaN(trazosNum) || trazosNum < 1 || trazosNum > 5) { toast.error("Campo requerido", { description: "Ingresa los trazos (1–5)." }); return }
    const tendidosNum = parseInt(form.tendidos, 10)
    if (isNaN(tendidosNum) || tendidosNum < 1 || tendidosNum > 8) { toast.error("Campo requerido", { description: "Ingresa los tendidos (1–8)." }); return }
    if (horasCalculadas === null) { toast.error("Error de cálculo", { description: "Verifica los valores ingresados." }); return }

    const supabase = getSupabase()
    if (!supabase) return

    setSaving(true)
    const semana = getISOWeek(new Date())

    const { error: insertError } = await supabase
      .from("corte_programacion")
      .insert({
        idempresa: IDEMPRESA,
        folio: orden.folio,
        semana,
        idfamilia_corte: Number(form.idfamilia),
        categoria_corte: form.categoriaCorte,
        categoria_tela: form.categoriaTela,
        trazos: trazosNum,
        tendidos: tendidosNum,
        combinacion: form.compCombinacion,
        comp_entretela: form.compEntretela,
        comp_poquetin: form.compPoquetin,
        comp_forro: form.compForro,
        horas_plan_corte: horasCalculadas,
        idcortador: form.idcortador && form.idcortador !== "__none__" ? Number(form.idcortador) : null,
        idapoyo: form.idapoyo && form.idapoyo !== "__none__" ? Number(form.idapoyo) : null,
        piezas_cortadas: form.piezas_cortadas ? parseInt(form.piezas_cortadas, 10) : null,
      })

    if (insertError) {
      toast.error("No se pudo programar el corte", { description: insertError.message })
      setSaving(false)
      return
    }

    const { error: updateError } = await supabase
      .from("ordenes_produccion")
      .update({ corte_programado: true })
      .eq("id", orden.id)
      .eq("idempresa", IDEMPRESA)

    setSaving(false)

    if (updateError) {
      toast.error("Corte insertado pero no se pudo actualizar la orden", { description: updateError.message })
      return
    }

    toast.success("Programación de Corte guardada", {
      description: `Folio ${orden.folio} · Semana ${semana} · ${horasCalculadas} h`,
    })
    onOpenChange(false)
    onSaved()
  }

  // Group families by grupo for the Select
  const familiasByGrupo = useMemo(() => {
    const groups: Record<string, CatFamiliaCorte[]> = {}
    for (const f of familias) {
      if (!groups[f.grupo]) groups[f.grupo] = []
      groups[f.grupo].push(f)
    }
    return groups
  }, [familias])

  const selectedFamilia  = familias.find(f => String(f.id) === form.idfamilia)
  const selectedCatData  = categorias.find(c => c.nombre === form.categoriaCorte)
  const selectedTelaData = telas.find(t => t.nombre === form.categoriaTela)
  const selectedTrazos   = trazosOpts.find(t => t.cantidad === Number(form.trazos))
  const selectedTendidos = tendidosOpts.find(t => t.cantidad === Number(form.tendidos))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0 overflow-hidden border-l border-white/10"
      >
        {/* ── Header ── */}
        <SheetHeader
          className="relative shrink-0 overflow-hidden p-6"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.18 0.09 295) 0%, oklch(0.22 0.12 305) 50%, oklch(0.18 0.1 320) 100%)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage: "radial-gradient(oklch(1 0 0 / 0.08) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          />
          <div className="relative z-10 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Scissors className="size-5 text-white" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-white text-base font-semibold leading-tight">
                Programar en Corte
              </SheetTitle>
              <SheetDescription className="text-white/55 text-xs mt-0.5">
                {`Folio: ${orden?.folio ?? "—"}`}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* ── Body ── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: "oklch(0.16 0.04 295)", color: "white" }}
        >
          <div className="space-y-6 p-6">

            {/* Datos de la Orden (solo lectura) */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-[10px] font-medium uppercase tracking-widest text-white/40">
                Datos de la Orden
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <OrderField label="Folio" value={orden?.folio} mono />
                <OrderField label="Modelo" value={orden?.modelo} />
                <OrderField label="Familia" value={orden?.familia} />
                <OrderField label="Categoría" value={orden?.categoria} />
                <OrderField label="Cliente" value={orden?.cliente} />
                <OrderField label="Piezas" value={orden?.piezas?.toString()} />
              </dl>
            </div>

            {/* Familia de Corte */}
            <FormSection title="Familia de Corte — Horas Base">
              <div className="space-y-1.5">
                <DLabel htmlFor="idfamilia">Familia / Prenda <Req /></DLabel>
                <Select
                  value={form.idfamilia}
                  onValueChange={(v) => setForm(f => ({ ...f, idfamilia: v }))}
                  disabled={loading}
                >
                  <SelectTrigger id="idfamilia" className={DARK_SELECT_TRIGGER}>
                    {loading ? (
                      <span className="flex items-center gap-2 text-white/40">
                        <Loader2 className="size-3.5 animate-spin" /> Cargando…
                      </span>
                    ) : (
                      <SelectValue placeholder="Seleccionar prenda…" />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(familiasByGrupo).map(([grupo, items]) => (
                      <div key={grupo}>
                        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Grupo {grupo} — {items[0]?.horas_base} h base
                        </div>
                        {items.map(f => (
                          <SelectItem key={f.id} value={String(f.id)}>
                            {f.nombre}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
                {selectedFamilia && (
                  <p className="text-[10px] text-white/40">
                    Grupo {selectedFamilia.grupo} · {selectedFamilia.horas_base} h base
                  </p>
                )}
              </div>
            </FormSection>

            {/* Multiplicadores */}
            <FormSection title="Multiplicadores">
              <div className="grid grid-cols-2 gap-3">

                {/* Categoría */}
                <div className="space-y-1.5">
                  <DLabel htmlFor="categoriaCorte">Categoría <Req /></DLabel>
                  <Select
                    value={form.categoriaCorte}
                    onValueChange={(v) => setForm(f => ({ ...f, categoriaCorte: v }))}
                    disabled={loading}
                  >
                    <SelectTrigger id="categoriaCorte" className={DARK_SELECT_TRIGGER}>
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent>
                      {categorias.map(c => (
                        <SelectItem key={c.id} value={c.nombre}>
                          <span>{c.nombre}</span>
                          <span className="ml-2 text-muted-foreground">×{c.multiplicador}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCatData && (
                    <p className="text-[10px] text-white/40">×{selectedCatData.multiplicador}</p>
                  )}
                </div>

                {/* Tipo de Tela — Combobox con búsqueda */}
                <div className="space-y-1.5">
                  <DLabel>Tipo de Tela <Req /></DLabel>
                  <Popover open={telaPopoverOpen} onOpenChange={setTelaPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={loading}
                        className={cn(
                          "flex h-9 w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                          DARK_SELECT_TRIGGER,
                          !form.categoriaTela && "text-white/40",
                        )}
                      >
                        <span className="truncate">{form.categoriaTela || "Seleccionar tela…"}</span>
                        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar tela…" className="h-9" />
                        <CommandList className="max-h-[220px]">
                          <CommandEmpty>No se encontró la tela.</CommandEmpty>
                          <CommandGroup>
                            {telas.map(t => (
                              <CommandItem
                                key={t.id}
                                value={t.nombre}
                                onSelect={() => {
                                  setForm(f => ({ ...f, categoriaTela: t.nombre }))
                                  setTelaPopoverOpen(false)
                                }}
                              >
                                <Check className={cn("mr-2 size-4 shrink-0", form.categoriaTela === t.nombre ? "opacity-100" : "opacity-0")} />
                                <span className="flex-1 truncate">{t.nombre}</span>
                                <span className="ml-2 text-xs text-muted-foreground">×{t.multiplicador}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedTelaData && (
                    <p className="text-[10px] text-white/40">×{selectedTelaData.multiplicador}</p>
                  )}
                </div>

                {/* Trazos */}
                <div className="space-y-1.5">
                  <DLabel htmlFor="trazos">Trazos (1–5) <Req /></DLabel>
                  <Input
                    id="trazos"
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    placeholder="1"
                    value={form.trazos}
                    onChange={(e) => setForm(f => ({ ...f, trazos: e.target.value }))}
                    className={DARK_INPUT}
                  />
                  {selectedTrazos && (
                    <p className="text-[10px] text-white/40">×{selectedTrazos.multiplicador}</p>
                  )}
                </div>

                {/* Tendidos */}
                <div className="space-y-1.5">
                  <DLabel htmlFor="tendidos">Tendidos (1–8) <Req /></DLabel>
                  <Input
                    id="tendidos"
                    type="number"
                    min="1"
                    max="8"
                    step="1"
                    placeholder="1"
                    value={form.tendidos}
                    onChange={(e) => setForm(f => ({ ...f, tendidos: e.target.value }))}
                    className={DARK_INPUT}
                  />
                  {selectedTendidos && (
                    <p className="text-[10px] text-white/40">×{selectedTendidos.multiplicador}</p>
                  )}
                </div>
              </div>
            </FormSection>

            {/* Complementos */}
            <FormSection title="Complementos">
              {complementos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {complementos.map(comp => {
                    const checked =
                      comp.clave === "comp_combinacion" ? form.compCombinacion :
                      comp.clave === "comp_entretela"   ? form.compEntretela :
                      comp.clave === "comp_poquetin"    ? form.compPoquetin :
                      comp.clave === "comp_forro"       ? form.compForro : false
                    return (
                      <ComplementoCheck
                        key={comp.clave}
                        id={comp.clave}
                        label={comp.nombre}
                        mult={comp.multiplicador}
                        checked={checked}
                        onChange={(v) => setForm(f => ({
                          ...f,
                          ...(comp.clave === "comp_combinacion" ? { compCombinacion: v } :
                              comp.clave === "comp_entretela"   ? { compEntretela: v } :
                              comp.clave === "comp_poquetin"    ? { compPoquetin: v } :
                              comp.clave === "comp_forro"       ? { compForro: v } : {}),
                        }))}
                      />
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/30">Cargando complementos…</p>
              )}
            </FormSection>

            {/* Asignación */}
            <FormSection title="Asignación">
              <div className="space-y-1.5">
                <DLabel htmlFor="piezas_cortadas">Piezas Cortadas</DLabel>
                <Input
                  id="piezas_cortadas"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.piezas_cortadas}
                  onChange={(e) => setForm(f => ({ ...f, piezas_cortadas: e.target.value }))}
                  className={DARK_INPUT}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <DLabel htmlFor="idcortador">Cortador</DLabel>
                  <Select
                    value={form.idcortador || "__none__"}
                    onValueChange={(v) => setForm(f => ({ ...f, idcortador: v }))}
                    disabled={loading}
                  >
                    <SelectTrigger id="idcortador" className={DARK_SELECT_TRIGGER}>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin asignar</SelectItem>
                      {cortadores.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <DLabel htmlFor="idapoyo">Ayudante</DLabel>
                  <Select
                    value={form.idapoyo || "__none__"}
                    onValueChange={(v) => setForm(f => ({ ...f, idapoyo: v }))}
                    disabled={loading}
                  >
                    <SelectTrigger id="idapoyo" className={DARK_SELECT_TRIGGER}>
                      <SelectValue placeholder="Sin ayudante" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin ayudante</SelectItem>
                      {cortadores.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </FormSection>

            {/* Preview Card */}
            {horasCalculadas !== null && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-indigo-300/70">
                  Horas Plan Estimadas
                </p>
                <p className="text-2xl font-bold text-white">
                  {horasCalculadas}{" "}
                  <span className="text-sm font-normal text-white/50">h</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
                  <span>Base: {selectedFamilia?.horas_base}</span>
                  <span>× Cat: {selectedCatData?.multiplicador}</span>
                  <span>× Tela: {selectedTelaData?.multiplicador}</span>
                  <span>× Trazos: {selectedTrazos?.multiplicador}</span>
                  <span>× Tendidos: {selectedTendidos?.multiplicador}</span>
                  {previewCompMult > 1 && (
                    <span>× Comp: {Math.round(previewCompMult * 10000) / 10000}</span>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── Footer ── */}
        <SheetFooter
          className="shrink-0 flex-row justify-end gap-2 border-t border-white/10 p-4"
          style={{ background: "oklch(0.14 0.04 295)" }}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !orden || horasCalculadas === null}
            className="bg-indigo-600 hover:bg-indigo-500 text-white border-0"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : (
              "Programar Corte"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

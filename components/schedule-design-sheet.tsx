"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarIcon, Loader2, AlertCircle, Pencil } from "lucide-react"
import { toast } from "sonner"
import { format, getISOWeek } from "date-fns"
import { es } from "date-fns/locale"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { getSupabase, getSupabaseConfigStatus, IDEMPRESA } from "@/lib/supabase/client"
import { calcHorasCostura, FACTOR_TELA, getValorTrazos, COMPLEMENTOS_HORAS } from "@/lib/costura-calc"

type Catalog = { id: number; nombre: string }
type PrendaCatalog = Catalog & { horas_base: number }

type OrdenContext = {
  folio: string | null
  modelo: string | null
  familia: string | null
  categoria: string | null
  cliente: string | null
}

type Props = {
  ordenId: number | string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onScheduled?: () => void
}

const INITIAL_FORM = {
  fecha: undefined as Date | undefined,
  semana: "",
  semanaOriginal: "",
  tipo: "",
  // costura calc
  idprenda: "",
  categoriaDemografica: "",
  tipoTela: "",
  trazos: "",
  compCombinacion: false,
  compEntretela: false,
  compPoquetin: false,
  compForro: false,
  // asignación
  numeroMuestras: "1",
  iddisenadora: "",
  idcosturera: "",
  comentarios: "",
}

const DARK_INPUT =
  "border-white/15 bg-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20 focus-visible:border-white/30"

const DARK_SELECT_TRIGGER =
  "border-white/15 bg-white/10 text-white data-[placeholder]:text-white/40 focus:ring-white/20"

const CATEGORIAS_DEMOGRAFICAS = ["Bebe", "Niña", "Teen", "Dama", "Extras"]
const TIPOS_TELA = ["LIGERA", "MEDIA", "PESADA", "MUY PESADA"]

export function ScheduleDesignSheet({ ordenId, open, onOpenChange, onScheduled }: Props) {
  const cfg = getSupabaseConfigStatus()
  const configMissing = !cfg.hasUrl || !cfg.hasKey

  const [loadingCatalogs, setLoadingCatalogs] = useState(false)
  const [loadingOrden, setLoadingOrden] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editRegistroId, setEditRegistroId] = useState<number | null>(null)

  const [disenadoras, setDisenadoras] = useState<Catalog[]>([])
  const [costureras, setCostureras] = useState<Catalog[]>([])
  const [prendas, setPrendas] = useState<PrendaCatalog[]>([])
  const [orden, setOrden] = useState<OrdenContext | null>(null)

  const [form, setForm] = useState({ ...INITIAL_FORM })

  const set = <K extends keyof typeof INITIAL_FORM>(
    key: K,
    value: (typeof INITIAL_FORM)[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  // Preview de horas de costura en tiempo real
  const horasCalculadas = useMemo(() => {
    const prenda = prendas.find((p) => String(p.id) === form.idprenda)
    if (!prenda || !form.tipoTela || !form.trazos) return null
    return calcHorasCostura({
      horasBase: prenda.horas_base,
      tipoTela: form.tipoTela,
      trazos: Number(form.trazos),
      comp_combinacion: form.compCombinacion,
      comp_entretela: form.compEntretela,
      comp_poquetin: form.compPoquetin,
      comp_forro: form.compForro,
    })
  }, [form, prendas])

  // Desglose del preview
  const previewDetalle = useMemo(() => {
    const prenda = prendas.find((p) => String(p.id) === form.idprenda)
    if (!prenda || !form.tipoTela || !form.trazos) return null
    const factorTela  = FACTOR_TELA[form.tipoTela] ?? 0
    const valorTrazos = getValorTrazos(form.tipoTela, Number(form.trazos))
    const complementos = (form.compCombinacion ? COMPLEMENTOS_HORAS.comp_combinacion : 0)
                       + (form.compEntretela   ? COMPLEMENTOS_HORAS.comp_entretela   : 0)
                       + (form.compPoquetin    ? COMPLEMENTOS_HORAS.comp_poquetin    : 0)
                       + (form.compForro       ? COMPLEMENTOS_HORAS.comp_forro       : 0)
    return { base: prenda.horas_base, factorTela, valorTrazos, complementos }
  }, [form, prendas])

  // Reset al cerrar
  useEffect(() => {
    if (!open) {
      setForm({ ...INITIAL_FORM })
      setOrden(null)
      setEditRegistroId(null)
    }
  }, [open])

  // Carga paralela: catálogos + datos de la orden
  useEffect(() => {
    if (!open || ordenId == null || configMissing) return

    const supabase = getSupabase()
    if (!supabase) return

    let cancelled = false

    const loadCatalogs = async () => {
      setLoadingCatalogs(true)
      try {
        const [disRes, cosRes, prendaRes] = await Promise.all([
          supabase
            .from("disenadoras")
            .select("id, nombre")
            .eq("idempresa", IDEMPRESA)
            .order("nombre", { ascending: true }),
          supabase
            .from("costureras")
            .select("id, nombre")
            .order("nombre", { ascending: true }),
          supabase
            .from("cat_prendas")
            .select("id, nombre, horas_base")
            .eq("idempresa", IDEMPRESA)
            .order("nombre", { ascending: true }),
        ])

        if (cancelled) return

        if (disRes.error) {
          toast.error("Error al cargar diseñadoras", { description: disRes.error.message })
        } else {
          setDisenadoras((disRes.data ?? []) as Catalog[])
        }
        if (cosRes.error) {
          toast.error("Error al cargar costureras", { description: cosRes.error.message })
        } else {
          setCostureras((cosRes.data ?? []) as Catalog[])
        }
        if (prendaRes.error) {
          toast.error("Error al cargar prendas", { description: prendaRes.error.message })
        } else {
          setPrendas((prendaRes.data ?? []) as PrendaCatalog[])
        }
      } finally {
        if (!cancelled) setLoadingCatalogs(false)
      }
    }

    const loadOrden = async () => {
      setLoadingOrden(true)
      const { data, error } = await supabase
        .from("ordenes_produccion")
        .select("folio, modelo, familia, categoria, cliente")
        .eq("idempresa", IDEMPRESA)
        .eq("id", ordenId)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        toast.error("Error al cargar la orden", { description: error.message })
        setOrden(null)
        setLoadingOrden(false)
        return
      }

      if (!data) { setOrden(null); setLoadingOrden(false); return }

      const d = data as {
        folio: string | null; modelo: string | null; familia: string | null
        categoria: string | null; cliente: string | null
      }
      setOrden({ folio: d.folio, modelo: d.modelo, familia: d.familia, categoria: d.categoria ?? null, cliente: d.cliente })

      if (!d.folio) { setLoadingOrden(false); return }

      const { data: dp } = await supabase
        .from("diseno_programacion")
        .select("id, fecha, semana, semana_original, tipo, idprenda, categoria_demografica, tipo_tela, trazos, comp_combinacion, comp_entretela, comp_poquetin, comp_forro, numero_muestras, iddisenadora, idcosturera, comentarios")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", d.folio)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!cancelled && dp) {
        const r = dp as Record<string, unknown>
        setEditRegistroId(r.id as number)
        setForm({
          fecha: r.fecha ? new Date((r.fecha as string) + "T00:00:00") : undefined,
          semana: r.semana != null ? String(r.semana) : "",
          semanaOriginal: r.semana_original != null ? String(r.semana_original) : "",
          tipo: (r.tipo as string) ?? "",
          idprenda: r.idprenda != null ? String(r.idprenda) : "",
          categoriaDemografica: (r.categoria_demografica as string) ?? "",
          tipoTela: (r.tipo_tela as string) ?? "",
          trazos: r.trazos != null ? String(r.trazos) : "",
          compCombinacion: (r.comp_combinacion as boolean) ?? false,
          compEntretela: (r.comp_entretela as boolean) ?? false,
          compPoquetin: (r.comp_poquetin as boolean) ?? false,
          compForro: (r.comp_forro as boolean) ?? false,
          numeroMuestras: r.numero_muestras != null ? String(r.numero_muestras) : "1",
          iddisenadora: r.iddisenadora != null ? String(r.iddisenadora) : "",
          idcosturera: r.idcosturera != null ? String(r.idcosturera) : "__none__",
          comentarios: (r.comentarios as string) ?? "",
        })
      }

      setLoadingOrden(false)
    }

    loadCatalogs()
    loadOrden()

    return () => {
      cancelled = true
    }
  }, [open, ordenId, configMissing])

  const handleSubmit = async () => {
    if (configMissing || ordenId == null) return

    if (!form.fecha) {
      toast.error("Campo requerido", { description: "Selecciona una fecha." })
      return
    }
    if (!form.tipo) {
      toast.error("Campo requerido", { description: "Selecciona el tipo de programación." })
      return
    }
    if (!form.iddisenadora) {
      toast.error("Campo requerido", { description: "Asigna una diseñadora." })
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setSubmitting(true)
    try {
      const payload = {
        idempresa: IDEMPRESA,
        folio: orden?.folio ?? null,
        modelo: orden?.modelo ?? null,
        familia: orden?.familia ?? null,
        categoria: orden?.categoria ?? null,
        cliente: orden?.cliente ?? null,
        fecha: format(form.fecha, "yyyy-MM-dd"),
        semana: form.semana ? Number(form.semana) : null,
        semana_original: form.semanaOriginal ? Number(form.semanaOriginal) : null,
        tipo: form.tipo,
        // campos costura
        idprenda: form.idprenda ? Number(form.idprenda) : null,
        categoria_demografica: form.categoriaDemografica || null,
        tipo_tela: form.tipoTela || null,
        trazos: form.trazos ? Number(form.trazos) : null,
        comp_combinacion: form.compCombinacion,
        comp_entretela: form.compEntretela,
        comp_poquetin: form.compPoquetin,
        comp_forro: form.compForro,
        horas_plan_costura: horasCalculadas,
        // asignación
        numero_muestras: Number(form.numeroMuestras) || 1,
        iddisenadora: Number(form.iddisenadora),
        idcosturera:
          form.idcosturera && form.idcosturera !== "__none__"
            ? Number(form.idcosturera)
            : null,
        comentarios: form.comentarios.trim() || null,
      }

      if (editRegistroId) {
        const { error } = await supabase
          .from("diseno_programacion")
          .update(payload)
          .eq("id", editRegistroId)
        if (error) {
          toast.error("No se pudo actualizar la programación", { description: error.message })
          return
        }
        toast.success("Programación de Diseño actualizada")
      } else {
        const { data, error } = await supabase
          .from("diseno_programacion")
          .insert(payload)
          .select("*")
          .single()
        if (error) {
          console.error("[v0] diseno insert error:", error)
          toast.error("No se pudo guardar la programación", { description: error.message })
          return
        }
        const row = data as Record<string, unknown>
        toast.success("Programación de Diseño guardada", {
          description: `Horas planificadas — Diseño: ${row.horas_plan_diseno ?? "—"} h · Costura: ${row.horas_plan_costura ?? "—"} h`,
        })
      }

      onOpenChange(false)
      onScheduled?.()
    } finally {
      setSubmitting(false)
    }
  }

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
              <Pencil className="size-5 text-white" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-white text-base font-semibold leading-tight">
                {editRegistroId ? "Reprogramar Diseño" : "Programar en Diseño"}
              </SheetTitle>
              <SheetDescription className="text-white/55 text-xs mt-0.5">
                {loadingOrden
                  ? "Cargando orden..."
                  : editRegistroId
                    ? `Actualizando · Folio: ${orden?.folio ?? "—"}`
                    : `Folio: ${orden?.folio ?? ordenId ?? "—"}`}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* ── Cuerpo ── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: "oklch(0.16 0.04 295)", color: "white" }}
        >
          {configMissing ? (
            <div className="p-6">
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                <AlertDescription>
                  Faltan las variables NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-6 p-6">

              {/* Datos heredados */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-widest text-white/40">
                  Datos de la Orden
                </p>
                {loadingOrden ? (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <Loader2 className="size-4 animate-spin" /> Cargando…
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <OrderField label="Folio" value={orden?.folio} mono />
                    <OrderField label="Modelo" value={orden?.modelo} />
                    <OrderField label="Familia" value={orden?.familia} />
                    <OrderField label="Categoría" value={orden?.categoria} />
                    <OrderField label="Cliente" value={orden?.cliente} />
                  </dl>
                )}
              </div>

              {/* Programación */}
              <FormSection title="Programación">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-3 sm:col-span-1 space-y-1.5">
                    <DLabel>Fecha <Req /></DLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex h-9 w-full items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-left text-sm transition-colors hover:bg-white/15",
                            form.fecha ? "text-white" : "text-white/40",
                          )}
                        >
                          <CalendarIcon className="size-3.5 shrink-0 text-white/50" />
                          {form.fecha ? format(form.fecha, "dd/MM/yyyy") : "Seleccionar"}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.fecha}
                          onSelect={(d) =>
                            setForm((prev) => ({
                              ...prev,
                              fecha: d,
                              semana: d ? String(getISOWeek(d)) : prev.semana,
                            }))
                          }
                          locale={es}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-1.5">
                    <DLabel htmlFor="semana">Semana</DLabel>
                    <Input
                      id="semana"
                      type="number"
                      min={1}
                      max={53}
                      placeholder="Nº"
                      value={form.semana}
                      onChange={(e) => set("semana", e.target.value)}
                      className={DARK_INPUT}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <DLabel htmlFor="semana-orig">Sem. Original</DLabel>
                    <Input
                      id="semana-orig"
                      type="number"
                      min={1}
                      max={53}
                      placeholder="Nº"
                      value={form.semanaOriginal}
                      onChange={(e) => set("semanaOriginal", e.target.value)}
                      className={DARK_INPUT}
                    />
                  </div>
                </div>
              </FormSection>

              {/* Tipo de Programación */}
              <FormSection title="Tipo de Programación">
                <div className="space-y-1.5">
                  <DLabel htmlFor="tipo">Tipo <Req /></DLabel>
                  <Select value={form.tipo} onValueChange={(v) => set("tipo", v)}>
                    <SelectTrigger id="tipo" className={DARK_SELECT_TRIGGER}>
                      <SelectValue placeholder="Selecciona un tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NUEVO">NUEVO</SelectItem>
                      <SelectItem value="RESURTIDO">RESURTIDO</SelectItem>
                      <SelectItem value="RECHAZADO">RECHAZADO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </FormSection>

              {/* Costura — Cálculo de Horas */}
              <FormSection title="Costura — Cálculo de Horas">
                <div className="space-y-4">
                  {/* Fila 1: Prenda + Categoría demográfica */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <DLabel htmlFor="prenda">Prenda</DLabel>
                      <Select
                        value={form.idprenda}
                        onValueChange={(v) => set("idprenda", v)}
                        disabled={loadingCatalogs}
                      >
                        <SelectTrigger id="prenda" className={DARK_SELECT_TRIGGER}>
                          {loadingCatalogs ? (
                            <span className="flex items-center gap-2 text-white/40">
                              <Loader2 className="size-3.5 animate-spin" /> Cargando…
                            </span>
                          ) : (
                            <SelectValue placeholder="Selecciona prenda" />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {prendas.map((p) => (
                            <SelectItem key={String(p.id)} value={String(p.id)}>
                              {p.nombre}
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                ({p.horas_base} h)
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <DLabel htmlFor="cat-demo">Categoría</DLabel>
                      <Select
                        value={form.categoriaDemografica}
                        onValueChange={(v) => set("categoriaDemografica", v)}
                      >
                        <SelectTrigger id="cat-demo" className={DARK_SELECT_TRIGGER}>
                          <SelectValue placeholder="Selecciona" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS_DEMOGRAFICAS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Fila 2: Tipo Tela + Trazos */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <DLabel htmlFor="tipo-tela">Tipo de Tela</DLabel>
                      <Select
                        value={form.tipoTela}
                        onValueChange={(v) => set("tipoTela", v)}
                      >
                        <SelectTrigger id="tipo-tela" className={DARK_SELECT_TRIGGER}>
                          <SelectValue placeholder="Selecciona" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_TELA.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                (×{FACTOR_TELA[t]})
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <DLabel htmlFor="trazos">Cant. de Trazos</DLabel>
                      <Input
                        id="trazos"
                        type="number"
                        min={1}
                        placeholder="Ej: 1800"
                        value={form.trazos}
                        onChange={(e) => set("trazos", e.target.value)}
                        className={DARK_INPUT}
                      />
                    </div>
                  </div>

                  {/* Complementos */}
                  <div>
                    <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
                      Complementos
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <ComplementoCheck
                        id="comp-comb"
                        label="Combinación"
                        horas={COMPLEMENTOS_HORAS.comp_combinacion}
                        checked={form.compCombinacion}
                        onCheckedChange={(v) => set("compCombinacion", v)}
                      />
                      <ComplementoCheck
                        id="comp-entretela"
                        label="Entretela"
                        horas={COMPLEMENTOS_HORAS.comp_entretela}
                        checked={form.compEntretela}
                        onCheckedChange={(v) => set("compEntretela", v)}
                      />
                      <ComplementoCheck
                        id="comp-poquetin"
                        label="Poquetin"
                        horas={COMPLEMENTOS_HORAS.comp_poquetin}
                        checked={form.compPoquetin}
                        onCheckedChange={(v) => set("compPoquetin", v)}
                      />
                      <ComplementoCheck
                        id="comp-forro"
                        label="Forro"
                        horas={COMPLEMENTOS_HORAS.comp_forro}
                        checked={form.compForro}
                        onCheckedChange={(v) => set("compForro", v)}
                      />
                    </div>
                  </div>

                  {/* Preview card */}
                  {horasCalculadas !== null && previewDetalle ? (
                    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-300/70 mb-1">
                        Horas de costura estimadas
                      </p>
                      <p className="text-2xl font-bold text-white">
                        {horasCalculadas}{" "}
                        <span className="text-base font-normal text-white/60">h</span>
                      </p>
                      <p className="mt-1.5 text-[11px] text-white/45">
                        Base {previewDetalle.base} · Tela {previewDetalle.factorTela} · Trazos {previewDetalle.valorTrazos} · Complementos {previewDetalle.complementos}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-xs text-white/30">
                      Completa Prenda, Tipo de Tela y Trazos para ver la estimación de horas.
                    </div>
                  )}
                </div>
              </FormSection>

              {/* Asignación */}
              <FormSection title="Asignación">
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <DLabel htmlFor="num-muestras">Número de Muestras</DLabel>
                    <Input
                      id="num-muestras"
                      type="number"
                      min={1}
                      value={form.numeroMuestras}
                      onChange={(e) => set("numeroMuestras", e.target.value)}
                      className={cn(DARK_INPUT, "w-28")}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <DLabel htmlFor="disenadora">Diseñadora <Req /></DLabel>
                    <Select
                      value={form.iddisenadora}
                      onValueChange={(v) => set("iddisenadora", v)}
                      disabled={loadingCatalogs}
                    >
                      <SelectTrigger id="disenadora" className={DARK_SELECT_TRIGGER}>
                        {loadingCatalogs ? (
                          <span className="flex items-center gap-2 text-white/40">
                            <Loader2 className="size-3.5 animate-spin" /> Cargando…
                          </span>
                        ) : (
                          <SelectValue placeholder="Selecciona una diseñadora" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {disenadoras.map((d) => (
                          <SelectItem key={String(d.id)} value={String(d.id)}>
                            {d.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <DLabel htmlFor="costurera">Costurera</DLabel>
                    <Select
                      value={form.idcosturera}
                      onValueChange={(v) => set("idcosturera", v)}
                      disabled={loadingCatalogs}
                    >
                      <SelectTrigger id="costurera" className={DARK_SELECT_TRIGGER}>
                        {loadingCatalogs ? (
                          <span className="flex items-center gap-2 text-white/40">
                            <Loader2 className="size-3.5 animate-spin" /> Cargando…
                          </span>
                        ) : (
                          <SelectValue placeholder="Sin asignar (opcional)" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground">Sin asignar</span>
                        </SelectItem>
                        {costureras.map((c) => (
                          <SelectItem key={String(c.id)} value={String(c.id)}>
                            {c.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </FormSection>

              {/* Comentarios */}
              <FormSection title="Comentarios">
                <Textarea
                  rows={3}
                  placeholder="Observaciones opcionales…"
                  value={form.comentarios}
                  onChange={(e) => set("comentarios", e.target.value)}
                  className={cn(DARK_INPUT, "resize-none")}
                />
              </FormSection>
            </div>
          )}
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
            disabled={submitting}
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={configMissing || submitting || loadingOrden || loadingCatalogs}
            className="bg-indigo-600 hover:bg-indigo-500 text-white border-0"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : editRegistroId ? "Actualizar Programación" : "Guardar Programación"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

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
      <dd
        className={cn(
          "mt-0.5 truncate text-sm font-medium text-white/90",
          mono && "font-mono text-xs",
        )}
      >
        {value ?? <span className="text-white/25">—</span>}
      </dd>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
        {title}
      </p>
      {children}
    </section>
  )
}

function DLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-white/70">
      {children}
    </label>
  )
}

function ComplementoCheck({
  id,
  label,
  horas,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  horas: number
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="border-white/30 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 shrink-0"
      />
      <label
        htmlFor={id}
        className="cursor-pointer select-none flex-1 text-xs font-medium text-white/70 leading-tight"
      >
        {label}
        <span className="ml-1 text-white/35">+{horas} h</span>
      </label>
    </div>
  )
}

function Req() {
  return <span className="ml-0.5 text-rose-400">*</span>
}

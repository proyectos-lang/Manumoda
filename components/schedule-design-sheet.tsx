"use client"

import { useEffect, useState } from "react"
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
import { Switch } from "@/components/ui/switch"
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

type Catalog = { id: number; nombre: string }

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
  muchasOperaciones: false,
  telasPesadas: false,
  muchasHabilitaciones: false,
  prendaCompleja: false,
  numeroMuestras: "1",
  iddisenadora: "",
  idcosturera: "",
  comentarios: "",
}

// Wrapper para aplicar el tema oscuro sin afectar el resto de la app
const DARK_INPUT =
  "border-white/15 bg-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20 focus-visible:border-white/30"

const DARK_SELECT_TRIGGER =
  "border-white/15 bg-white/10 text-white data-[placeholder]:text-white/40 focus:ring-white/20"

export function ScheduleDesignSheet({ ordenId, open, onOpenChange, onScheduled }: Props) {
  const cfg = getSupabaseConfigStatus()
  const configMissing = !cfg.hasUrl || !cfg.hasKey

  const [loadingCatalogs, setLoadingCatalogs] = useState(false)
  const [loadingOrden, setLoadingOrden] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [disenadoras, setDisenadoras] = useState<Catalog[]>([])
  const [costureras, setCostureras] = useState<Catalog[]>([])
  const [orden, setOrden] = useState<OrdenContext | null>(null)

  const [form, setForm] = useState({ ...INITIAL_FORM })

  const set = <K extends keyof typeof INITIAL_FORM>(
    key: K,
    value: (typeof INITIAL_FORM)[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  // Reset al cerrar
  useEffect(() => {
    if (!open) {
      setForm({ ...INITIAL_FORM })
      setOrden(null)
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
        const [disRes, cosRes] = await Promise.all([
          supabase
            .from("disenadoras")
            .select("id, nombre")
            .eq("idempresa", IDEMPRESA)
            .order("nombre", { ascending: true }),
          supabase
            .from("costureras")
            .select("id, nombre")
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
      } else if (data) {
        const d = data as {
          folio: string | null
          modelo: string | null
          familia: string | null
          categoria: string | null
          cliente: string | null
        }
        setOrden({
          folio: d.folio,
          modelo: d.modelo,
          familia: d.familia,
          categoria: d.categoria ?? null,
          cliente: d.cliente,
        })
      } else {
        setOrden(null)
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
      // Solo enviamos los campos crudos — el trigger de BD calcula las horas planificadas
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
        muchas_operaciones: form.muchasOperaciones,
        telas_pesadas: form.telasPesadas,
        muchas_habilitaciones: form.muchasHabilitaciones,
        prenda_compleja: form.prendaCompleja,
        numero_muestras: Number(form.numeroMuestras) || 1,
        iddisenadora: Number(form.iddisenadora),
        idcosturera:
          form.idcosturera && form.idcosturera !== "__none__"
            ? Number(form.idcosturera)
            : null,
        comentarios: form.comentarios.trim() || null,
      }

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

      // El trigger ya calculó horas_plan_diseno y horas_plan_costura — sólo los mostramos
      const row = data as Record<string, unknown>
      toast.success("Programación de Diseño guardada", {
        description: `Horas planificadas — Diseño: ${row.horas_plan_diseno ?? "—"} h · Costura: ${row.horas_plan_costura ?? "—"} h`,
      })

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
        {/* ── Header con degradado oscuro morado/índigo ── */}
        <SheetHeader
          className="relative shrink-0 overflow-hidden p-6"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.18 0.09 295) 0%, oklch(0.22 0.12 305) 50%, oklch(0.18 0.1 320) 100%)",
          }}
        >
          {/* Capa de puntos decorativos */}
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
                Programar en Diseño
              </SheetTitle>
              <SheetDescription className="text-white/55 text-xs mt-0.5">
                {loadingOrden
                  ? "Cargando orden..."
                  : `Folio: ${orden?.folio ?? ordenId ?? "—"}`}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* ── Cuerpo scrolleable con fondo oscuro ── */}
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

              {/* ── Tarjeta de datos heredados (solo lectura) ── */}
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

              {/* ── Sección: Programación ── */}
              <FormSection title="Programación">
                <div className="grid grid-cols-3 gap-3">
                  {/* Fecha */}
                  <div className="col-span-3 sm:col-span-1 space-y-1.5">
                    <DLabel>
                      Fecha <Req />
                    </DLabel>
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

                  {/* Semana */}
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

                  {/* Semana original */}
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

              {/* ── Sección: Tipo de programación ── */}
              <FormSection title="Tipo de Programación">
                <div className="space-y-1.5">
                  <DLabel htmlFor="tipo">
                    Tipo <Req />
                  </DLabel>
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

              {/* ── Sección: Factores de complejidad (cuadrícula 2×2) ── */}
              <FormSection title="Factores de Complejidad">
                <div className="grid grid-cols-2 gap-2.5">
                  <ComplexitySwitch
                    id="sw-muchas-op"
                    label="Muchas Operaciones"
                    checked={form.muchasOperaciones}
                    onCheckedChange={(v) => set("muchasOperaciones", v)}
                  />
                  <ComplexitySwitch
                    id="sw-telas"
                    label="Telas Pesadas"
                    checked={form.telasPesadas}
                    onCheckedChange={(v) => set("telasPesadas", v)}
                  />
                  <ComplexitySwitch
                    id="sw-muchas-hab"
                    label="Muchas Habilitaciones"
                    checked={form.muchasHabilitaciones}
                    onCheckedChange={(v) => set("muchasHabilitaciones", v)}
                  />
                  <ComplexitySwitch
                    id="sw-prenda-compleja"
                    label="Prenda Compleja"
                    checked={form.prendaCompleja}
                    onCheckedChange={(v) => set("prendaCompleja", v)}
                  />
                </div>
              </FormSection>

              {/* ── Sección: Asignación ── */}
              <FormSection title="Asignación">
                <div className="grid gap-4">
                  {/* Número de muestras */}
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

                  {/* Diseñadora */}
                  <div className="space-y-1.5">
                    <DLabel htmlFor="disenadora">
                      Diseñadora <Req />
                    </DLabel>
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

                  {/* Costurera (opcional) */}
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

              {/* ── Sección: Comentarios ── */}
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
            ) : (
              "Guardar Programación"
            )}
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

function ComplexitySwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <label
        htmlFor={id}
        className="cursor-pointer select-none text-xs font-medium leading-tight text-white/70"
      >
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="shrink-0 data-[state=checked]:bg-indigo-500"
      />
    </div>
  )
}

function Req() {
  return <span className="ml-0.5 text-rose-400">*</span>
}

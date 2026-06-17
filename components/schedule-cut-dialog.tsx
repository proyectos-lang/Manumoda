"use client"

import { useEffect, useState } from "react"
import { getISOWeek } from "date-fns"
import { Loader2, Scissors } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Switch } from "@/components/ui/switch"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatTela = {
  id: number
  tipo_de_tela: string
  complejidad_texto: string | null
}

type FormState = {
  tipo_tela: string
  complejidad_texto: string
  metros_utilizar: string
  trazos: string
  combinacion: boolean
  no_piezas: string
}

const EMPTY_FORM: FormState = {
  tipo_tela: "",
  complejidad_texto: "",
  metros_utilizar: "",
  trazos: "",
  combinacion: false,
  no_piezas: "",
}

// ─── Dark-theme styling constants (mirror de schedule-design-sheet) ───────────

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
  const [telas, setTelas] = useState<CatTela[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loadingTelas, setLoadingTelas] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Load catalog & reset form on open ──────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM)
      return
    }
    const supabase = getSupabase()
    if (!supabase) return

    setLoadingTelas(true)
    supabase
      .from("cat_telas")
      .select("id, tipo_de_tela, complejidad_texto")
      .order("tipo_de_tela")
      .then(({ data }) => {
        setTelas((data as CatTela[]) ?? [])
        setLoadingTelas(false)
      })
  }, [open])

  // ── Auto-fill complejidad when tela changes ────────────────────────────────
  const handleTelaChange = (value: string) => {
    const found = telas.find((t) => t.tipo_de_tela === value)
    setForm((f) => ({
      ...f,
      tipo_tela: value,
      complejidad_texto: found?.complejidad_texto ?? "",
    }))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!orden?.id || !orden.folio) return

    if (!form.tipo_tela) { toast.error("Campo requerido", { description: "Selecciona un tipo de tela." }); return }
    const metros = parseFloat(form.metros_utilizar)
    const trazos = parseInt(form.trazos, 10)
    const piezas = parseInt(form.no_piezas, 10)
    if (isNaN(metros) || metros <= 0) { toast.error("Campo requerido", { description: "Ingresa los metros a utilizar." }); return }
    if (isNaN(trazos) || trazos <= 0) { toast.error("Campo requerido", { description: "Ingresa el número de trazos." }); return }
    if (isNaN(piezas) || piezas <= 0) { toast.error("Campo requerido", { description: "Ingresa el número de piezas." }); return }

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
        tipo_tela: form.tipo_tela,
        metros_utilizar: metros,
        trazos,
        combinacion: form.combinacion,
        no_piezas: piezas,
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
      toast.error("Corte insertado pero no se pudo actualizar la orden", {
        description: updateError.message,
      })
      return
    }

    toast.success("Programación de Corte guardada", {
      description: `Folio ${orden.folio} · Semana ${semana}`,
    })
    onOpenChange(false)
    onSaved()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0 overflow-hidden border-l border-white/10"
      >
        {/* ── Header con degradado oscuro ámbar ── */}
        <SheetHeader
          className="relative shrink-0 overflow-hidden p-6"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.18 0.09 50) 0%, oklch(0.22 0.12 40) 50%, oklch(0.18 0.10 30) 100%)",
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

        {/* ── Cuerpo scrolleable con fondo oscuro ámbar ── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: "oklch(0.16 0.06 50)", color: "white" }}
        >
          <div className="space-y-6 p-6">

            {/* ── Tarjeta de datos heredados (solo lectura) ── */}
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

            {/* ── Sección: Tela ── */}
            <FormSection title="Tela">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <DLabel htmlFor="tipo_tela">
                    Tipo de Tela <Req />
                  </DLabel>
                  <Select
                    value={form.tipo_tela}
                    onValueChange={handleTelaChange}
                    disabled={loadingTelas}
                  >
                    <SelectTrigger id="tipo_tela" className={DARK_SELECT_TRIGGER}>
                      {loadingTelas ? (
                        <span className="flex items-center gap-2 text-white/40">
                          <Loader2 className="size-3.5 animate-spin" /> Cargando…
                        </span>
                      ) : (
                        <SelectValue placeholder="Seleccionar…" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {telas.map((t) => (
                        <SelectItem key={t.id} value={t.tipo_de_tela}>
                          {t.tipo_de_tela}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <DLabel htmlFor="complejidad">Complejidad</DLabel>
                  <Input
                    id="complejidad"
                    value={form.complejidad_texto}
                    readOnly
                    placeholder="—"
                    className={cn(DARK_INPUT, "cursor-default opacity-70")}
                  />
                </div>
              </div>
            </FormSection>

            {/* ── Sección: Medidas ── */}
            <FormSection title="Medidas">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <DLabel htmlFor="metros">
                    Metros <Req />
                  </DLabel>
                  <Input
                    id="metros"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.metros_utilizar}
                    onChange={(e) => setForm((f) => ({ ...f, metros_utilizar: e.target.value }))}
                    className={DARK_INPUT}
                  />
                </div>

                <div className="space-y-1.5">
                  <DLabel htmlFor="trazos">
                    Trazos <Req />
                  </DLabel>
                  <Input
                    id="trazos"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="0"
                    value={form.trazos}
                    onChange={(e) => setForm((f) => ({ ...f, trazos: e.target.value }))}
                    className={DARK_INPUT}
                  />
                </div>

                <div className="space-y-1.5">
                  <DLabel htmlFor="no_piezas">
                    No. Piezas <Req />
                  </DLabel>
                  <Input
                    id="no_piezas"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="0"
                    value={form.no_piezas}
                    onChange={(e) => setForm((f) => ({ ...f, no_piezas: e.target.value }))}
                    className={DARK_INPUT}
                  />
                </div>
              </div>
            </FormSection>

            {/* ── Sección: Configuración ── */}
            <FormSection title="Configuración">
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5"
              >
                <label
                  htmlFor="combinacion"
                  className="cursor-pointer select-none text-xs font-medium leading-tight text-white/70"
                >
                  Corte combinado
                </label>
                <Switch
                  id="combinacion"
                  checked={form.combinacion}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, combinacion: v }))}
                  className="shrink-0 data-[state=checked]:bg-amber-500"
                />
              </div>
            </FormSection>

          </div>
        </div>

        {/* ── Footer ── */}
        <SheetFooter
          className="shrink-0 flex-row justify-end gap-2 border-t border-white/10 p-4"
          style={{ background: "oklch(0.14 0.05 50)" }}
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
            disabled={saving || !orden}
            className="bg-amber-600 hover:bg-amber-500 text-white border-0"
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

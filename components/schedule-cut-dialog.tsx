"use client"

import { useEffect, useState } from "react"
import { getISOWeek } from "date-fns"
import { Loader2, Scissors } from "lucide-react"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { OrdenProduccion } from "@/lib/types"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Req() {
  return <span className="ml-0.5 text-rose-400">*</span>
}

function DLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-[11px] font-semibold uppercase tracking-wide text-white/60"
    >
      {children}
    </Label>
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
      complejidad_texto: found?.complejidad_texto ?? "—",
    }))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!orden?.id || !orden.folio) return

    // Validation
    if (!form.tipo_tela) { toast.error("Selecciona una tela"); return }
    const metros = parseFloat(form.metros_utilizar)
    const trazos = parseInt(form.trazos, 10)
    const piezas = parseInt(form.no_piezas, 10)
    if (isNaN(metros) || metros <= 0) { toast.error("Ingresa los metros a utilizar"); return }
    if (isNaN(trazos) || trazos <= 0) { toast.error("Ingresa el número de trazos"); return }
    if (isNaN(piezas) || piezas <= 0) { toast.error("Ingresa el número de piezas"); return }

    const supabase = getSupabase()
    if (!supabase) return

    setSaving(true)

    const semana = getISOWeek(new Date())

    // 1. Insert into corte_programacion
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

    // 2. Mark order as corte_programado
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

    toast.success("Corte programado correctamente", {
      description: `Folio ${orden.folio} · Semana ${semana}`,
    })
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        {/* ── Dark premium header ─────────────────────────────────────────── */}
        <div
          className="px-6 py-5"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.18 0.09 50) 0%, oklch(0.22 0.12 40) 50%, oklch(0.18 0.10 30) 100%)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/20 ring-1 ring-amber-400/30">
              <Scissors className="size-4 text-amber-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Programar Corte</h2>
              <p className="text-[11px] text-white/50">
                {orden?.folio ?? "—"}
                {orden?.modelo ? ` · ${orden.modelo}` : ""}
              </p>
            </div>
          </div>

          {/* Order summary pill row */}
          {orden && (
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ["Familia", orden.familia],
                ["Categoría", orden.categoria],
                ["Cliente", orden.cliente],
                ["Piezas", orden.piezas?.toString()],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <span
                    key={label}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] text-white/70"
                  >
                    <span className="text-white/40">{label}: </span>
                    {value}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* ── Form body ───────────────────────────────────────────────────── */}
        <div className="space-y-5 px-6 py-5">
          {/* Row 1: Tela + Complejidad */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <DLabel htmlFor="tipo_tela">
                Tipo de Tela <Req />
              </DLabel>
              <Select
                value={form.tipo_tela}
                onValueChange={handleTelaChange}
                disabled={loadingTelas}
              >
                <SelectTrigger id="tipo_tela" className="h-9 text-sm">
                  <SelectValue placeholder={loadingTelas ? "Cargando…" : "Seleccionar…"} />
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
                className={cn(
                  "h-9 cursor-default bg-muted text-sm text-muted-foreground",
                  form.complejidad_texto && "font-medium text-foreground",
                )}
                placeholder="—"
              />
            </div>
          </div>

          {/* Row 2: Metros + Trazos */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <DLabel htmlFor="metros">
                Metros a Utilizar <Req />
              </DLabel>
              <Input
                id="metros"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.metros_utilizar}
                onChange={(e) => setForm((f) => ({ ...f, metros_utilizar: e.target.value }))}
                className="h-9 text-sm"
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
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Row 3: No. Piezas + Combinación */}
          <div className="grid grid-cols-2 gap-4">
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
                className="h-9 text-sm"
              />
            </div>

            <div className="flex flex-col justify-end space-y-1.5 pb-0.5">
              <DLabel>Combinación</DLabel>
              <div className="flex h-9 items-center gap-2.5">
                <Checkbox
                  id="combinacion"
                  checked={form.combinacion}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, combinacion: Boolean(v) }))
                  }
                />
                <label
                  htmlFor="combinacion"
                  className="cursor-pointer select-none text-sm text-muted-foreground"
                >
                  Es corte combinado
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <DialogFooter className="border-t border-border bg-muted/30 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="mr-auto"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !orden}
            className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Guardando…" : "Programar Corte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

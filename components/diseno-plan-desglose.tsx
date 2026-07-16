"use client"

import { useEffect, useState } from "react"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// ── Tipos de catálogo ────────────────────────────────────────────────────────

export type CatPrendaM = { id: number; nombre: string; horas_base: number }
export type CatTipoM = { nombre: string; multiplicador: number }
export type CatCatDemoM = { nombre: string; multiplicador: number }
export type CatAdicionM = { clave: string; nombre: string; horas: number }

export type DisenoMultiplierCats = {
  prendas: CatPrendaM[]
  tipos: CatTipoM[]
  categorias: CatCatDemoM[]
  adiciones: CatAdicionM[]
}

// ── Hook compartido ──────────────────────────────────────────────────────────

export function useDisenoMultiplierCatalogs(configMissing: boolean): DisenoMultiplierCats {
  const [prendas, setPrendas] = useState<CatPrendaM[]>([])
  const [tipos, setTipos] = useState<CatTipoM[]>([])
  const [categorias, setCategorias] = useState<CatCatDemoM[]>([])
  const [adiciones, setAdiciones] = useState<CatAdicionM[]>([])

  useEffect(() => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    let cancelled = false
    Promise.all([
      supabase.from("cat_prendas").select("id, nombre, horas_base").eq("idempresa", IDEMPRESA).order("nombre"),
      supabase.from("cat_tipo_diseno").select("nombre, multiplicador").eq("idempresa", IDEMPRESA).order("id"),
      supabase.from("cat_categoria_demografica").select("nombre, multiplicador").eq("idempresa", IDEMPRESA).order("id"),
      supabase.from("cat_adiciones_diseno").select("clave, nombre, horas").eq("idempresa", IDEMPRESA).order("id"),
    ]).then(([pRes, tRes, cRes, aRes]) => {
      if (cancelled) return
      if (!pRes.error) setPrendas((pRes.data ?? []) as CatPrendaM[])
      if (!tRes.error) setTipos((tRes.data ?? []) as CatTipoM[])
      if (!cRes.error) setCategorias((cRes.data ?? []) as CatCatDemoM[])
      if (!aRes.error) setAdiciones((aRes.data ?? []) as CatAdicionM[])
    })
    return () => { cancelled = true }
  }, [configMissing])

  return { prendas, tipos, categorias, adiciones }
}

// ── Campos mínimos que el popover necesita ───────────────────────────────────

export type DesgloseRowFields = {
  idprenda?: number | null
  tipo?: string | null
  categoria_demografica?: string | null
  muchas_operaciones?: boolean | null
  telas_pesadas?: boolean | null
  muchas_habilitaciones?: boolean | null
  prenda_compleja?: boolean | null
  horas_plan_diseno?: number | null
}

function fmtH(n: number | null | undefined) {
  if (n == null) return "—"
  return n.toFixed(2)
}

// ── Popover de desglose ──────────────────────────────────────────────────────

export function PlanDisenoDesglosePopover({
  row,
  cats,
}: {
  row: DesgloseRowFields
  cats: DisenoMultiplierCats
}) {
  const prenda   = cats.prendas.find((p) => p.id === row.idprenda)
  const tipoData = cats.tipos.find((t) => t.nombre === row.tipo)
  const catData  = cats.categorias.find((c) => c.nombre === row.categoria_demografica)

  const tipoMult = tipoData?.multiplicador ?? 1
  const catMult  = catData?.multiplicador  ?? 1
  const subtotal = prenda ? prenda.horas_base * tipoMult * catMult : null

  const adicionesActivas = cats.adiciones.filter((a) => {
    const k = a.clave as keyof DesgloseRowFields
    return (row as Record<string, unknown>)[k] === true
  })
  const adicionHoras = adicionesActivas.reduce((s, a) => s + Number(a.horas), 0)

  const total = row.horas_plan_diseno
  const hasData = cats.prendas.length > 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums hover:underline cursor-pointer text-indigo-700 font-medium"
          title="Ver desglose del cálculo de plan diseño"
        >
          {fmtH(total)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" side="top">
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs font-semibold text-foreground">Cálculo Plan Diseño</p>

          {!hasData ? (
            <p className="text-xs text-muted-foreground">Cargando catálogos…</p>
          ) : (
            <div className="space-y-1.5 text-xs">
              {prenda ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">
                      Prenda: <span className="text-foreground font-medium">{prenda.nombre}</span>
                    </span>
                    <span className="tabular-nums font-mono shrink-0">{fmtH(prenda.horas_base)} h</span>
                  </div>

                  {tipoData && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">
                        × Tipo: <span className="text-foreground">{tipoData.nombre}</span>
                      </span>
                      <span className="tabular-nums font-mono text-amber-600 shrink-0">×{tipoMult.toFixed(2)}</span>
                    </div>
                  )}

                  {catData && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">
                        × Categoría: <span className="text-foreground">{catData.nombre}</span>
                      </span>
                      <span className="tabular-nums font-mono text-amber-600 shrink-0">×{catMult.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-3 border-t border-border pt-1.5">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums font-mono shrink-0">{fmtH(subtotal)} h</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground italic">Sin prenda vinculada</span>
                  <span className="tabular-nums font-mono shrink-0">{fmtH(total)} h</span>
                </div>
              )}

              {adicionesActivas.length > 0 && (
                <>
                  {adicionesActivas.map((a) => (
                    <div key={a.clave} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">+ {a.nombre}</span>
                      <span className="tabular-nums font-mono text-sky-600 shrink-0">+{Number(a.horas).toFixed(1)} h</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 text-muted-foreground text-[10px]">
                    <span>Adiciones</span>
                    <span className="tabular-nums font-mono">+{adicionHoras.toFixed(1)} h</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex justify-between gap-3 border-t border-border pt-2 text-xs font-semibold">
            <span>Total plan</span>
            <span className="tabular-nums text-indigo-700">{fmtH(total)} h</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

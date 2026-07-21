"use client"

/**
 * Ficha 360° del folio.
 *
 * Un solo lugar donde se ve el ciclo completo de un pedido:
 * orden → diseño → corte → maquila. Se abre desde cualquier tabla
 * vía el contexto `useFolioDetail().openFolio(folio)` o con el
 * componente `<FolioLink folio={...} />`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Circle,
  ClipboardList,
  Loader2,
  Palette,
  Scissors,
  Factory,
} from "lucide-react"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import type { SeguimientoRow } from "@/lib/types"
import {
  computeProgress,
  parseLocalDate,
  projectedFinish,
  relativeDays,
  riskFromServer,
} from "@/lib/risk"
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { EntregadoBadge, FacturarButton } from "@/components/facturar-button"
import { PhaseBubbleTimeline } from "@/components/phase-bubble-timeline"
import { RiskBadge } from "@/components/risk-badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

// ── Contexto ─────────────────────────────────────────────────────────────────

type FolioDetailContextValue = { openFolio: (folio: string) => void }

const FolioDetailContext = createContext<FolioDetailContextValue | null>(null)

export function useFolioDetail(): FolioDetailContextValue {
  const ctx = useContext(FolioDetailContext)
  // Fallback no-op para componentes renderizados fuera del provider
  return ctx ?? { openFolio: () => {} }
}

/** Folio clickeable que abre la ficha 360°. */
export function FolioLink({ folio, className }: { folio: string | null | undefined; className?: string }) {
  const { openFolio } = useFolioDetail()
  if (!folio) return <span className={className}>—</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openFolio(folio)
      }}
      className={cn(
        "font-mono font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline cursor-pointer",
        className,
      )}
      title="Ver ficha completa del folio"
    >
      {folio}
    </button>
  )
}

// ── Datos de la ficha ────────────────────────────────────────────────────────

type DisenoDetail = {
  horas_plan_diseno: number | null
  horas_diseno_cumplidas: number | null
  semana: number | null
  rechazo_orden: boolean | null
}

type CorteDetail = {
  horas_plan_final: number | null
  cortador_nombre: string | null
  apoyo_nombre: string | null
  semana: number | null
  calificacion: number | null
}

type FichaData = {
  row: SeguimientoRow
  diseno: DisenoDetail | null
  corte: CorteDetail | null
  fotosPorEtapa: Record<string, number>
}

function fmtDate(iso: string | null | undefined): string {
  const d = parseLocalDate(iso)
  if (!d) return "—"
  return format(d, "dd MMM yyyy", { locale: es })
}

function fmtH(n: number | null | undefined): string {
  return n == null ? "—" : `${Number(n).toFixed(2)} h`
}

// ── Provider + Drawer ────────────────────────────────────────────────────────

export function FolioDetailProvider({ children }: { children: ReactNode }) {
  const [folio, setFolio] = useState<string | null>(null)
  const [data, setData] = useState<FichaData | null>(null)
  const [loading, setLoading] = useState(false)

  const openFolio = useCallback((f: string) => {
    // Los folios reprogramados llevan sufijo (.2, .3) — la ficha es del pedido base
    setFolio(f.split(".")[0])
  }, [])

  useEffect(() => {
    if (!folio) {
      setData(null)
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [segRes, disRes, corRes, fotosRes] = await Promise.all([
        supabase
          .from("vw_seguimiento_integrado")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .maybeSingle(),
        supabase
          .from("diseno_programacion")
          .select("horas_plan_diseno, horas_diseno_cumplidas, semana, rechazo_orden")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("vw_plan_corte_detalle")
          .select("horas_plan_final, cortador_nombre, apoyo_nombre, semana, calificacion")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .order("registro_id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("ordenes_fotos")
          .select("etapa")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio),
      ])
      if (cancelled) return
      setLoading(false)
      if (!segRes.data) {
        setData(null)
        return
      }
      const fotos: Record<string, number> = {}
      for (const r of (fotosRes.data ?? []) as { etapa: string }[]) {
        fotos[r.etapa] = (fotos[r.etapa] ?? 0) + 1
      }
      setData({
        row: segRes.data as SeguimientoRow,
        diseno: (disRes.data as DisenoDetail | null) ?? null,
        corte: (corRes.data as CorteDetail | null) ?? null,
        fotosPorEtapa: fotos,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [folio])

  const row = data?.row
  const progress = row ? computeProgress(row).progress : 0
  const risk = row ? riskFromServer(row.riesgo_entrega) : "sin-fecha"
  const proyeccion = row && progress < 100 ? projectedFinish(row.fase_actual) : null
  const diffProyeccion =
    proyeccion && row?.fecha_cancelacion
      ? Math.round(
          (proyeccion.getTime() - (parseLocalDate(row.fecha_cancelacion)?.getTime() ?? 0)) /
            86400000,
        )
      : null

  const totalFotos = Object.values(data?.fotosPorEtapa ?? {}).reduce((a, b) => a + b, 0)

  return (
    <FolioDetailContext.Provider value={{ openFolio }}>
      {children}

      <Sheet open={folio !== null} onOpenChange={(o) => { if (!o) setFolio(null) }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border bg-muted/30 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="font-mono text-lg">{folio}</SheetTitle>
                <SheetDescription className="mt-0.5">
                  {loading ? "Cargando…" : row ? `${row.modelo ?? "Sin modelo"} · ${row.cliente ?? "Sin cliente"}` : "Folio no encontrado"}
                </SheetDescription>
              </div>
              {row && <RiskBadge risk={risk} days={row.dias_restantes} />}
            </div>
          </SheetHeader>

          {loading && (
            <div className="space-y-4 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          )}

          {!loading && !row && folio && (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <p className="text-sm font-medium text-foreground">Folio no encontrado</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  El folio <span className="font-mono">{folio}</span> no existe en las órdenes de producción.
                </p>
              </div>
            </div>
          )}

          {!loading && row && (
            <div className="space-y-4 p-5">
              {/* ── Datos del pedido ── */}
              <section className="rounded-xl border border-border bg-card p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ClipboardList className="size-3.5" /> Pedido
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Familia</dt>
                    <dd>{row.familia ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Piezas</dt>
                    <dd className="tabular-nums">{row.piezas ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Maquilero</dt>
                    <dd>{row.maquilero_nombre?.trim() || "Sin asignar"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Fecha entrega</dt>
                    <dd className="font-medium tabular-nums">{fmtDate(row.fecha_cancelacion)}</dd>
                  </div>
                </dl>
                {proyeccion && (
                  <div
                    className={cn(
                      "mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                      diffProyeccion !== null && diffProyeccion > 0
                        ? "border-rose-200 bg-rose-50 text-rose-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800",
                    )}
                  >
                    <CalendarDays className="size-3.5 shrink-0" />
                    <span>
                      Al ritmo estándar de su fase ({row.fase_actual}) terminaría el{" "}
                      <strong>{format(proyeccion, "dd MMM", { locale: es })}</strong>
                      {diffProyeccion !== null && (
                        <>
                          {" "}
                          — {diffProyeccion > 0 ? `${diffProyeccion} día(s) DESPUÉS` : diffProyeccion < 0 ? `${Math.abs(diffProyeccion)} día(s) antes` : "justo"} de la entrega
                        </>
                      )}
                    </span>
                  </div>
                )}
              </section>

              {/* ── Etapa 1: Diseño ── */}
              <StageSection
                icon={<Palette className="size-3.5" />}
                title="1 · Diseño"
                accent="text-sky-700"
                na={Boolean(row.no_requiere_diseno)}
                done={Boolean(row.cumplimiento_diseno)}
                pending={!row.fecha_diseno}
              >
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Fecha</dt>
                    <dd className="tabular-nums">{fmtDate(row.fecha_diseno)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Semana</dt>
                    <dd className="tabular-nums">{data?.diseno?.semana ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Diseñadora</dt>
                    <dd>{row.nombre_disenador ?? "Sin asignar"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Horas plan / cumplidas</dt>
                    <dd className="tabular-nums">
                      {fmtH(data?.diseno?.horas_plan_diseno)} · {fmtH(data?.diseno?.horas_diseno_cumplidas)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Aprobación cliente</dt>
                    <dd className="tabular-nums">{fmtDate(row.fecha_aprobacion_diseno)}</dd>
                  </div>
                  {data?.diseno?.rechazo_orden && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Rechazo</dt>
                      <dd className="font-medium text-rose-600">Orden rechazada</dd>
                    </div>
                  )}
                </dl>
              </StageSection>

              {/* ── Etapa 2: Corte ── */}
              <StageSection
                icon={<Scissors className="size-3.5" />}
                title="2 · Corte"
                accent="text-amber-700"
                na={Boolean(row.no_requiere_corte)}
                done={row.cumplimiento_corte === "Si"}
                pending={!row.fecha_corte}
              >
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Fecha</dt>
                    <dd className="tabular-nums">{fmtDate(row.fecha_corte)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Semana</dt>
                    <dd className="tabular-nums">{data?.corte?.semana ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Cortador</dt>
                    <dd>{data?.corte?.cortador_nombre ?? row.nombre_cortador ?? "Sin asignar"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Horas plan</dt>
                    <dd className="tabular-nums">{fmtH(data?.corte?.horas_plan_final)}</dd>
                  </div>
                  {data?.corte?.apoyo_nombre && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Apoyo</dt>
                      <dd>{data.corte.apoyo_nombre}</dd>
                    </div>
                  )}
                  {data?.corte?.calificacion != null && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Calificación</dt>
                      <dd className="tabular-nums">{data.corte.calificacion}/5</dd>
                    </div>
                  )}
                </dl>
              </StageSection>

              {/* ── Etapa 3: Maquila ── */}
              <section className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                    <Factory className="size-3.5" /> 3 · Maquila
                  </p>
                  {row.fecha_facturacion ? (
                    <EntregadoBadge fechaFacturacion={row.fecha_facturacion} />
                  ) : (
                    <Badge variant="outline" className="text-xs">{row.fase_actual}</Badge>
                  )}
                </div>

                <div className="mb-3 flex items-center gap-3">
                  <PhaseBubbleTimeline row={row} />
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {progress}%
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Última revisión</dt>
                    <dd className="tabular-nums">
                      {fmtDate(row.fecha_ultima_revision)}
                      {row.fecha_ultima_revision && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({relativeDays(row.fecha_ultima_revision)})
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tipo revisión</dt>
                    <dd>{row.tipo_revision ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Insumos</dt>
                    <dd>{row.habilitaciones_insumos ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Calidad</dt>
                    <dd className="tabular-nums">
                      {row.calidad != null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            row.calidad >= 8 ? "text-emerald-600" : row.calidad >= 5 ? "text-amber-600" : "text-rose-600",
                          )}
                        >
                          {row.calidad}/10
                        </span>
                      ) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Contra muestra</dt>
                    <dd className="tabular-nums">{fmtDate(row.fecha_contra_muestra)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Fotos de evidencia</dt>
                    <dd className="flex items-center gap-1.5">
                      <Camera className="size-3.5 text-muted-foreground" />
                      <span className="tabular-nums">{totalFotos}</span>
                      {totalFotos > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({Object.entries(data?.fotosPorEtapa ?? {})
                            .map(([e, n]) => `${e}: ${n}`)
                            .join(" · ")})
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                {row.comentarios_generales && (
                  <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    {row.comentarios_generales}
                  </div>
                )}

                {/* Cierre del ciclo: facturación */}
                <div className="mt-3 border-t border-border pt-3">
                  <FacturarButton
                    folio={row.folio}
                    ordenId={row.id}
                    faseActual={row.fase_actual}
                    fechaFacturacion={row.fecha_facturacion}
                    onDone={(fecha) =>
                      setData((prev) =>
                        prev ? { ...prev, row: { ...prev.row, fecha_facturacion: fecha } } : prev,
                      )
                    }
                    className="w-full justify-center"
                  />
                  {row.fecha_facturacion && (
                    <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                      Facturada el {fmtDate(row.fecha_facturacion)} — no genera alertas
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </FolioDetailContext.Provider>
  )
}

// ── Sección de etapa reutilizable ────────────────────────────────────────────

function StageSection({
  icon,
  title,
  accent,
  na,
  done,
  pending,
  children,
}: {
  icon: ReactNode
  title: string
  accent: string
  na: boolean
  done: boolean
  pending: boolean
  children: ReactNode
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", na && "opacity-60")}>
      <div className="mb-3 flex items-center justify-between">
        <p className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide", accent)}>
          {icon} {title}
        </p>
        {na ? (
          <Badge variant="outline" className="text-xs text-muted-foreground">No aplica</Badge>
        ) : done ? (
          <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-xs">
            <CheckCircle2 className="size-3" /> Cumplida
          </Badge>
        ) : pending ? (
          <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
            <Circle className="size-3" /> Pendiente
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-sky-700 text-xs">
            <Loader2 className="size-3" /> Programada
          </Badge>
        )}
      </div>
      {na ? (
        <p className="text-xs italic text-muted-foreground">Esta orden no pasa por esta etapa.</p>
      ) : (
        children
      )}
    </section>
  )
}

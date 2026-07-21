"use client"

import { useEffect, useState } from "react"
import {
  Upload,
  CalendarClock,
  KanbanSquare,
  ShieldCheck,
  ArrowRight,
  Loader2,
  AlertTriangle,
  ListChecks,
  Activity,
  Clock,
  Palette,
  Scissors,
  EyeOff,
  CalendarX,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { daysUntil } from "@/lib/risk"
import { etapaAtrasada } from "@/lib/lead-times"
import type { ModuleFilter } from "@/lib/module-filter"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import type { ModuleKey } from "@/components/app-sidebar"
import { cn } from "@/lib/utils"

type Stats = {
  porProgramar: number
  enProduccion: number
  porFase: { fase: string; total: number }[]
}

/** Pendientes accionables de hoy, cada uno navega al módulo correspondiente. */
type Atencion = {
  vencidos: number
  porVencer: number
  sinProgramar: number
  disenoPendiente: number
  cortePendiente: number
  sinRevision: number
  /** Fuera del plazo previo a S1 (Diseño 14 d · Corte 7 d) */
  disenoAtrasado: number
  corteAtrasado: number
}

const FASES = ["Programada", "S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const

const BAR_COLORS = [
  "var(--icon-cyan)",
  "var(--icon-teal)",
  "var(--icon-green)",
  "var(--icon-yellow)",
  "var(--icon-coral)",
  "var(--icon-magenta)",
  "var(--icon-purple)",
  "var(--icon-dark)",
]

const ACTIONS: {
  key: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  cta: string
  target: ModuleKey
}[] = [
  {
    key: "ingestion",
    title: "Cargar Nuevas Órdenes",
    description: "Sube el Excel de pedidos para ingestar nuevas órdenes de producción.",
    icon: Upload,
    iconColor: "text-icon-cyan",
    cta: "Ir a Ingestión",
    target: "ingestion",
  },
  {
    key: "programar",
    title: "Programar Producción",
    description: "Asigna compradora, maquilero y fecha de entrega a las órdenes pendientes.",
    icon: CalendarClock,
    iconColor: "text-icon-magenta",
    cta: "Programar Órdenes",
    target: "ingestion",
  },
  {
    key: "tablero",
    title: "Tablero de Avances",
    description: "Visualiza el flujo de producción en Kanban o tabla por fase S1 a S7.",
    icon: KanbanSquare,
    iconColor: "text-icon-yellow",
    cta: "Ver Tablero",
    target: "seguimiento",
  },
  {
    key: "calidad",
    title: "Calidad y Reportes",
    description: "Revisa indicadores de calidad y descarga reportes (próximamente).",
    icon: ShieldCheck,
    iconColor: "text-icon-green",
    cta: "Ver Reportes",
    target: "configuracion",
  },
]

export function HomeDashboard({
  configMissing,
  onNavigate,
}: {
  configMissing: boolean
  /** El segundo argumento abre el módulo destino ya filtrado. */
  onNavigate: (m: ModuleKey, filter?: ModuleFilter) => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [atencion, setAtencion] = useState<Atencion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (configMissing) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const supabase = getSupabase()
        if (!supabase) throw new Error("Supabase client not configured")

        const { count: porProgramar, error: e1 } = await supabase
          .from("ordenes_produccion")
          .select("*", { count: "exact", head: true })
          .eq("idempresa", IDEMPRESA)
          .eq("fase_actual", "Por Programar")
        if (e1) throw e1

        const { count: enProduccion, error: e2 } = await supabase
          .from("ordenes_produccion")
          .select("*", { count: "exact", head: true })
          .eq("idempresa", IDEMPRESA)
          .neq("fase_actual", "Por Programar")
          .neq("fase_actual", "S7")
        if (e2) throw e2

        const { data: faseRows, error: e3 } = await supabase
          .from("ordenes_produccion")
          .select("fase_actual")
          .eq("idempresa", IDEMPRESA)
        if (e3) throw e3

        const counts: Record<string, number> = {}
        for (const f of FASES) counts[f] = 0
        for (const r of faseRows ?? []) {
          const f = (r as { fase_actual: string | null }).fase_actual
          if (f && counts[f] !== undefined) counts[f] += 1
        }
        const porFase = FASES.map((f) => ({ fase: f, total: counts[f] }))

        // ── Pendientes de atención (desde la vista integrada) ──────────────
        const { data: segRows, error: e4 } = await supabase
          .from("vw_seguimiento_integrado")
          .select(
            "folio, fase_actual, riesgo_entrega, fecha_ultima_revision, fecha_diseno, cumplimiento_diseno, no_requiere_diseno, fecha_corte, cumplimiento_corte, no_requiere_corte, fecha_facturacion",
          )
          .eq("idempresa", IDEMPRESA)
        if (e4) throw e4

        const at: Atencion = {
          vencidos: 0,
          porVencer: 0,
          sinProgramar: porProgramar ?? 0,
          disenoPendiente: 0,
          cortePendiente: 0,
          sinRevision: 0,
          disenoAtrasado: 0,
          corteAtrasado: 0,
        }
        const EN_PRODUCCION = new Set(["S1", "S2", "S3", "S4", "S5", "S6"])
        for (const r of (segRows ?? []) as {
          fase_actual: string
          riesgo_entrega: string | null
          fecha_ultima_revision: string | null
          fecha_diseno: string | null
          cumplimiento_diseno: boolean | null
          no_requiere_diseno: boolean | null
          fecha_corte: string | null
          cumplimiento_corte: string | null
          no_requiere_corte: boolean | null
          fecha_facturacion: string | null
        }[]) {
          if (r.fase_actual === "S7") continue // terminadas no cuentan
          if (r.fecha_facturacion) continue // facturadas = entregadas, cierran el ciclo
          if (r.riesgo_entrega === "Vencido") at.vencidos++
          else if (r.riesgo_entrega === "En Riesgo" || r.riesgo_entrega === "A Destiempo") at.porVencer++

          if (!r.no_requiere_diseno && r.fecha_diseno && !r.cumplimiento_diseno) at.disenoPendiente++
          if (!r.no_requiere_corte && r.fecha_corte && r.cumplimiento_corte !== "Si") at.cortePendiente++

          // Plazos previos a S1
          if (etapaAtrasada(r, "diseno")) at.disenoAtrasado++
          if (etapaAtrasada(r, "corte")) at.corteAtrasado++

          if (EN_PRODUCCION.has(r.fase_actual)) {
            const dias = daysUntil(r.fecha_ultima_revision)
            // daysUntil negativo = fecha pasada; null = nunca revisada
            if (dias === null || dias <= -7) at.sinRevision++
          }
        }

        if (!cancelled) {
          setStats({
            porProgramar: porProgramar ?? 0,
            enProduccion: enProduccion ?? 0,
            porFase,
          })
          setAtencion(at)
        }
      } catch (err) {
        console.log("HomeDashboard fetch error:", err)
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar estadísticas")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [configMissing])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Bienvenido, Manufacturas de la Moda
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Centro de control de producción. Monitorea órdenes, programa entregas y supervisa el avance
          en tiempo real.
        </p>
      </div>

      {configMissing && (
        <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
          <AlertTriangle className="size-4" />
          <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
          <AlertDescription>
            Faltan las variables{" "}
            <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> y/o{" "}
            <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </AlertDescription>
        </Alert>
      )}

      {error && !configMissing && (
        <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
          <AlertTriangle className="size-4" />
          <AlertTitle>No se pudieron cargar las estadísticas</AlertTitle>
          <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {/* ── ¿Qué necesita atención hoy? ── */}
      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Atención hoy
        </h3>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : atencion ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
            <AttentionCard
              label="Vencidos"
              value={atencion.vencidos}
              icon={AlertTriangle}
              tone="rose"
              onClick={() => onNavigate("riesgos", "vencidos")}
            />
            <AttentionCard
              label="Por vencer"
              value={atencion.porVencer}
              icon={Clock}
              tone="amber"
              onClick={() => onNavigate("riesgos", "por-vencer")}
              hint="En riesgo o a destiempo"
            />
            <AttentionCard
              label="Sin programar"
              value={atencion.sinProgramar}
              icon={ListChecks}
              tone="cyan"
              onClick={() => onNavigate("ingestion", "sin-programar")}
            />
            <AttentionCard
              label="Diseño por evaluar"
              value={atencion.disenoPendiente}
              icon={Palette}
              tone="indigo"
              onClick={() => onNavigate("diseno", "diseno-pendiente")}
            />
            <AttentionCard
              label="Corte sin cumplir"
              value={atencion.cortePendiente}
              icon={Scissors}
              tone="amber"
              onClick={() => onNavigate("corte", "corte-pendiente")}
            />
            <AttentionCard
              label="Sin revisión +7d"
              value={atencion.sinRevision}
              icon={EyeOff}
              tone="slate"
              onClick={() => onNavigate("seguimiento", "sin-revision")}
              hint="En maquila sin visita reciente"
            />
            <AttentionCard
              label="Diseño a destiempo"
              value={atencion.disenoAtrasado}
              icon={CalendarX}
              tone="rose"
              onClick={() => onNavigate("riesgos", "diseno-atrasado")}
              hint="Fuera del plazo de 14 días antes de S1"
            />
            <AttentionCard
              label="Corte a destiempo"
              value={atencion.corteAtrasado}
              icon={CalendarX}
              tone="rose"
              onClick={() => onNavigate("riesgos", "corte-atrasado")}
              hint="Fuera del plazo de 7 días antes de S1"
            />
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Acciones rápidas
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ACTIONS.map((a) => {
            const Icon = a.icon
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => onNavigate(a.target)}
                className="group glass relative overflow-hidden rounded-2xl border border-border/60 p-5 text-left transition-all hover:border-primary/40 hover:shadow-[0_20px_40px_-20px_oklch(0.65_0.15_220/0.4)]"
              >
                <div className="relative flex flex-col gap-4">
                  <div
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl bg-white/60 ring-1 ring-border/60",
                      a.iconColor,
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{a.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {a.description}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium transition-transform group-hover:translate-x-0.5", a.iconColor)}>
                    {a.cta}
                    <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Estadísticas en vivo
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <StatCard
            icon={ListChecks}
            iconColor="text-icon-cyan"
            label="Órdenes Esperando Programación"
            value={stats?.porProgramar}
            loading={loading}
            disabled={configMissing}
          />
          <StatCard
            icon={Activity}
            iconColor="text-icon-magenta"
            label="Órdenes en Producción Activa"
            value={stats?.enProduccion}
            loading={loading}
            disabled={configMissing}
          />
          <div className="glass rounded-2xl border border-border/60 p-5 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Distribución por Fase
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">Programada · S1 a S7</p>
            <div className="mt-4 h-32">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : stats ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.porFase} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="fase"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: "oklch(0.65 0.15 220 / 0.08)" }}
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--card-foreground)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {stats.porFase.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Sin datos
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

const ATTENTION_TONES = {
  rose: { active: "border-rose-300 bg-rose-50/80 hover:bg-rose-100/80", icon: "text-rose-600 bg-rose-100 ring-rose-200", value: "text-rose-700" },
  amber: { active: "border-amber-300 bg-amber-50/80 hover:bg-amber-100/80", icon: "text-amber-600 bg-amber-100 ring-amber-200", value: "text-amber-700" },
  cyan: { active: "border-cyan-300 bg-cyan-50/80 hover:bg-cyan-100/80", icon: "text-cyan-600 bg-cyan-100 ring-cyan-200", value: "text-cyan-700" },
  indigo: { active: "border-indigo-300 bg-indigo-50/80 hover:bg-indigo-100/80", icon: "text-indigo-600 bg-indigo-100 ring-indigo-200", value: "text-indigo-700" },
  slate: { active: "border-slate-300 bg-slate-50/80 hover:bg-slate-100/80", icon: "text-slate-600 bg-slate-100 ring-slate-200", value: "text-slate-700" },
} as const

function AttentionCard({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
  hint,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  tone: keyof typeof ATTENTION_TONES
  onClick: () => void
  hint?: string
}) {
  const t = ATTENTION_TONES[tone]
  const empty = value === 0
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "group rounded-2xl border p-4 text-left transition-all",
        empty
          ? "border-border/60 bg-white/50 opacity-60 hover:opacity-90"
          : cn("shadow-sm", t.active),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg ring-1",
            empty ? "bg-slate-50 text-slate-400 ring-slate-200" : t.icon,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <ArrowRight className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", empty ? "text-muted-foreground" : t.value)}>
        {value}
      </p>
      <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
    </button>
  )
}

function StatCard({
  icon: Icon,
  iconColor,
  label,
  value,
  loading,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  label: string
  value: number | undefined
  loading: boolean
  disabled: boolean
}) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl border border-border/60 p-5">
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div
            className={cn(
              "mt-3 text-4xl font-semibold tracking-tight tabular-nums text-foreground",
              disabled && "text-muted-foreground",
            )}
          >
            {disabled ? "—" : loading ? <Loader2 className="size-7 animate-spin" /> : value ?? 0}
          </div>
        </div>
        <div className={cn("flex size-10 items-center justify-center rounded-xl bg-white/60 ring-1 ring-border/60", iconColor)}>
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  )
}

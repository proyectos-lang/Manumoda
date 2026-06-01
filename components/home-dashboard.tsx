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
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ModuleKey } from "@/components/app-sidebar"
import { cn } from "@/lib/utils"

type Stats = {
  porProgramar: number
  enProduccion: number
  porFase: { fase: string; total: number }[]
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
  onNavigate: (m: ModuleKey) => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
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

        if (!cancelled) {
          setStats({
            porProgramar: porProgramar ?? 0,
            enProduccion: enProduccion ?? 0,
            porFase,
          })
        }
      } catch (err) {
        console.log("[v0] HomeDashboard fetch error:", err)
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

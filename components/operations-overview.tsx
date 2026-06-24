"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  RefreshCw,
  Activity,
  Layers,
  Package,
  AlertTriangle,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type ResumenRow = {
  idempresa: number
  id: number | string
  folio: string | null
  modelo: string | null
  cliente: string | null
  piezas: number | null
  fase_actual: string | null
  maquilero_nombre: string | null
  riesgo_entrega: string | null
  fecha_cancelacion: string | null
  fecha_limite_confirmacion: string | null
  calidad: number | null
  familia: string | null
  fecha_s1: string | null
  fecha_s2: string | null
  fecha_s3: string | null
  fecha_s4: string | null
  fecha_s5: string | null
  fecha_s6: string | null
  fecha_s7: string | null
  dias_prog_s1: number | null
  dias_s1_s2: number | null
  dias_s2_s3: number | null
  dias_s3_s4: number | null
  dias_s4_s5: number | null
  dias_s5_s6: number | null
  dias_s6_s7: number | null
}

const PHASE_GAPS: { key: keyof ResumenRow; label: string }[] = [
  { key: "dias_prog_s1", label: "Prog-S1" },
  { key: "dias_s1_s2", label: "S1-S2" },
  { key: "dias_s2_s3", label: "S2-S3" },
  { key: "dias_s3_s4", label: "S3-S4" },
  { key: "dias_s4_s5", label: "S4-S5" },
  { key: "dias_s5_s6", label: "S5-S6" },
  { key: "dias_s6_s7", label: "S6-S7" },
]

const PHASE_BUCKETS = ["Programada", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]

const CMYK_COLORS = [
  "oklch(0.62 0.18 220)", // cyan
  "oklch(0.62 0.22 330)", // magenta
  "oklch(0.78 0.16 90)", // yellow-ish
  "oklch(0.62 0.18 145)", // green
  "oklch(0.55 0.2 285)", // violet
  "oklch(0.65 0.2 30)", // orange
  "oklch(0.6 0.18 195)", // teal
]

function formatDate(iso: string | null) {
  if (!iso) return null
  try {
    return format(new Date(iso), "dd MMM yyyy", { locale: es })
  } catch {
    return null
  }
}

function getRiesgoVisuals(r: string | null | undefined) {
  const v = (r ?? "").toLowerCase()
  if (v.includes("vencid")) {
    return { label: r ?? "Vencido", className: "bg-red-500/10 text-red-500 ring-red-500/20" }
  }
  if (v.includes("destiempo") || v.includes("a destiempo")) {
    return { label: r ?? "A Destiempo", className: "bg-orange-500/10 text-orange-500 ring-orange-500/20" }
  }
  if (v.includes("riesgo")) {
    return { label: r ?? "En Riesgo", className: "bg-yellow-500/10 text-yellow-500 ring-yellow-500/20" }
  }
  if (v.includes("tiempo")) {
    return { label: r ?? "A Tiempo", className: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20" }
  }
  return {
    label: r ?? "Sin Fecha",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
  }
}

function isAtTiempo(r: string | null | undefined) {
  return (r ?? "").toLowerCase().includes("tiempo")
}

function MasterBubbleTimeline({ row }: { row: ResumenRow }) {
  const phases: { key: keyof ResumenRow; label: string }[] = [
    { key: "fecha_s1", label: "S1" },
    { key: "fecha_s2", label: "S2" },
    { key: "fecha_s3", label: "S3" },
    { key: "fecha_s4", label: "S4" },
    { key: "fecha_s5", label: "S5" },
    { key: "fecha_s6", label: "S6" },
    { key: "fecha_s7", label: "S7" },
  ]

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex items-center gap-1.5">
        {phases.map((p) => {
          const date = row[p.key] as string | null
          const filled = Boolean(date)
          return (
            <Tooltip key={p.label}>
              <TooltipTrigger asChild>
                <span
                  aria-label={`${p.label}: ${date ? formatDate(date) : "Pendiente"}`}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[9px] font-semibold transition-transform hover:scale-110",
                    filled
                      ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                      : "border border-slate-300 bg-slate-50 text-slate-400",
                  )}
                >
                  {filled ? "" : ""}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="font-medium">
                  {p.label}: {date ? formatDate(date) : "Pendiente"}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export function OperationsOverview({ configMissing }: { configMissing: boolean }) {
  const [rows, setRows] = useState<ResumenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (configMissing) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = getSupabase()
      if (!supabase) throw new Error("Supabase no configurado")

      const { data, error: err } = await supabase
        .from("vw_resumen_operacion")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .order("fecha_cancelacion", { ascending: true, nullsFirst: false })

      if (err) throw err
      setRows((data ?? []) as ResumenRow[])
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al consultar vw_resumen_operacion"
      setError(msg)
      console.log("[v0] OperationsOverview fetch error:", msg)
    } finally {
      setLoading(false)
    }
  }, [configMissing])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // KPIs
  const kpis = useMemo(() => {
    const total = rows.length
    const aTiempo = rows.filter((r) => isAtTiempo(r.riesgo_entrega)).length
    const health = total > 0 ? Math.round((aTiempo / total) * 100) : 0
    const piezas = rows.reduce((acc, r) => acc + (r.piezas ?? 0), 0)
    return { total, health, piezas }
  }, [rows])

  // Bottlenecks: average days per phase gap
  const bottleneckData = useMemo(() => {
    return PHASE_GAPS.map((g) => {
      const values = rows
        .map((r) => r[g.key] as number | null)
        .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
      const avg =
        values.length > 0
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
          : 0
      return { fase: g.label, dias: avg }
    })
  }, [rows])

  // Phase load (count per fase_actual)
  const phaseLoadData = useMemo(() => {
    const counts: Record<string, number> = {}
    PHASE_BUCKETS.forEach((p) => {
      counts[p] = 0
    })
    rows.forEach((r) => {
      const f = r.fase_actual ?? "Sin Fase"
      counts[f] = (counts[f] ?? 0) + 1
    })
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([fase, count]) => ({ fase, count }))
  }, [rows])

  // Maquilero load
  const maquileroLoadData = useMemo(() => {
    const counts: Record<string, number> = {}
    rows.forEach((r) => {
      const name = r.maquilero_nombre?.trim() || "Sin asignar"
      counts[name] = (counts[name] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  }, [rows])

  // Gráfico 1: órdenes por fase × riesgo_entrega (stacked)
  const statusRiskData = useMemo(() => {
    const map: Record<string, { fase: string; vencido: number; a_destiempo: number; a_tiempo: number }> = {}
    rows.forEach((r) => {
      const fase = r.fase_actual ?? "Sin Fase"
      if (!map[fase]) map[fase] = { fase, vencido: 0, a_destiempo: 0, a_tiempo: 0 }
      const v = (r.riesgo_entrega ?? "").toLowerCase()
      if (v.includes("vencid")) {
        map[fase].vencido++
      } else if (v.includes("destiempo")) {
        map[fase].a_destiempo++
      } else {
        map[fase].a_tiempo++
      }
    })
    const order = [...PHASE_BUCKETS, "Sin Fase"]
    const ordered = order.filter((f) => map[f]).map((f) => map[f])
    const rest = Object.keys(map)
      .filter((f) => !order.includes(f))
      .map((f) => map[f])
    return [...ordered, ...rest]
  }, [rows])

  // Gráfico 2: calidad promedio por maquilero
  const calidadData = useMemo(() => {
    const map: Record<string, { sum: number; count: number }> = {}
    rows.forEach((r) => {
      const name = r.maquilero_nombre?.trim() || "Sin asignar"
      const q = r.calidad
      if (q != null && q > 0) {
        if (!map[name]) map[name] = { sum: 0, count: 0 }
        map[name].sum += q
        map[name].count++
      }
    })
    return Object.entries(map)
      .map(([nombre, { sum, count }]) => ({
        nombre,
        promedio: Math.round((sum / count) * 10) / 10,
      }))
      .sort((a, b) => b.promedio - a.promedio)
  }, [rows])

  // Gráfico 3: volumen por familia
  const familiaData = useMemo(() => {
    const map: Record<string, number> = {}
    rows.forEach((r) => {
      const f = r.familia?.trim() || "Sin Familia"
      map[f] = (map[f] ?? 0) + 1
    })
    return Object.entries(map)
      .map(([familia, count]) => ({ familia, count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  if (configMissing) {
    return (
      <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
        <AlertTriangle className="size-4" />
        <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
        <AlertDescription>
          Faltan las variables de entorno requeridas para consultar{" "}
          <code className="font-mono text-xs">vw_resumen_operacion</code>.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* HERO HEADER CARD with dark CMYK gradient */}
      <div className="relative overflow-hidden rounded-2xl hero-cmyk-gradient ring-1 ring-white/10 shadow-2xl shadow-violet-950/30">
        <div className="relative z-10 flex flex-col gap-6 p-6 md:p-8">
          {/* Top row: title + refresh */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
                <Activity className="size-5 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
                  Resumen de Operación
                </p>
                <h3 className="mt-1 text-xl font-semibold text-white text-balance md:text-2xl">
                  Vista macroscópica del estado de producción
                </h3>
                <p className="mt-1 text-xs text-white/60">
                  Datos en vivo desde{" "}
                  <code className="font-mono text-[11px] text-white/75">
                    manumoda.vw_resumen_operacion
                  </code>
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchData()}
              disabled={loading}
              className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              Actualizar
            </Button>
          </div>

          {/* Body: KPIs on left + circular Health Score on right */}
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="grid gap-4 sm:grid-cols-2">
              <HeroKpi
                loading={loading}
                icon={<Activity className="size-5 text-cyan-300" />}
                accentBorder="from-cyan-400/60 to-cyan-400/0"
                title="Órdenes Activas"
                value={kpis.total.toLocaleString("es-MX")}
                subtitle="Total de órdenes en seguimiento"
              />
              <HeroKpi
                loading={loading}
                icon={<Package className="size-5 text-fuchsia-300" />}
                accentBorder="from-fuchsia-400/60 to-fuchsia-400/0"
                title="Piezas en Producción"
                value={kpis.piezas.toLocaleString("es-MX")}
                subtitle="Suma total de piezas activas"
              />
            </div>

            <HealthScoreRing
              loading={loading}
              percent={kpis.health}
              subtitle={`${rows.filter((r) => isAtTiempo(r.riesgo_entrega)).length} a tiempo de ${kpis.total}`}
            />
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* SECTION 2: CHARTS */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* Bottlenecks */}
        <ChartCard
          title="Cuellos de Botella"
          subtitle="Días promedio entre fases"
          loading={loading}
          empty={bottleneckData.every((d) => d.dias === 0)}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={bottleneckData}
              margin={{ top: 8, right: 12, left: -10, bottom: 0 }}
            >
              <CartesianGrid stroke="oklch(0.92 0.02 280)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="fase"
                stroke="oklch(0.45 0.04 280)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="oklch(0.45 0.04 280)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <RechartsTooltip
                cursor={{ fill: "oklch(0.96 0.02 280 / 0.5)" }}
                contentStyle={{
                  background: "white",
                  border: "1px solid oklch(0.9 0.02 280)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number) => [`${v} días`, "Promedio"]}
              />
              <Bar dataKey="dias" radius={[6, 6, 0, 0]}>
                {bottleneckData.map((_, i) => (
                  <Cell key={i} fill={CMYK_COLORS[i % CMYK_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Carga por Fase */}
        <ChartCard
          title="Carga por Fase"
          subtitle="Órdenes en cada fase actual"
          loading={loading}
          empty={phaseLoadData.length === 0}
        >
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={phaseLoadData}
                dataKey="count"
                nameKey="fase"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
              >
                {phaseLoadData.map((_, i) => (
                  <Cell key={i} fill={CMYK_COLORS[i % CMYK_COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip
                contentStyle={{
                  background: "white",
                  border: "1px solid oklch(0.9 0.02 280)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number, n: string) => [`${v} órdenes`, n]}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Carga por Maquilador */}
        <ChartCard
          title="Carga por Maquilador"
          subtitle="Órdenes activas asignadas"
          loading={loading}
          empty={maquileroLoadData.length === 0}
          className="lg:col-span-2 xl:col-span-1"
        >
          <ResponsiveContainer
            width="100%"
            height={Math.max(260, maquileroLoadData.length * 28)}
          >
            <BarChart
              data={maquileroLoadData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            >
              <CartesianGrid
                stroke="oklch(0.92 0.02 280)"
                strokeDasharray="3 3"
                horizontal={false}
              />
              <XAxis
                type="number"
                stroke="oklch(0.45 0.04 280)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                stroke="oklch(0.45 0.04 280)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={120}
              />
              <RechartsTooltip
                cursor={{ fill: "oklch(0.96 0.02 280 / 0.5)" }}
                contentStyle={{
                  background: "white",
                  border: "1px solid oklch(0.9 0.02 280)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number) => [`${v} órdenes`, "Asignadas"]}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="oklch(0.55 0.2 285)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* SECTION 2b: ANÁLISIS DE RIESGO, CALIDAD Y FAMILIA */}
      <div className="grid gap-4">
        {/* Gráfico 1 – Órdenes por Fase y Vencimiento (ancho completo) */}
        <ChartCard
          title="Órdenes por Fase y Vencimiento"
          subtitle="Distribución apilada: A Tiempo vs Vencidas por fase"
          loading={loading}
          empty={statusRiskData.length === 0}
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={statusRiskData}
              margin={{ top: 8, right: 16, left: -10, bottom: 0 }}
            >
              <CartesianGrid stroke="oklch(0.92 0.02 280)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="fase"
                stroke="oklch(0.45 0.04 280)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="oklch(0.45 0.04 280)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <RechartsTooltip
                cursor={{ fill: "oklch(0.15 0.04 295 / 0.12)" }}
                contentStyle={{
                  background: "oklch(0.15 0.04 295)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.9)",
                }}
                labelStyle={{ color: "rgba(255,255,255,0.55)", marginBottom: 4 }}
                formatter={(v: number, name: string) => [
                  `${v} órdenes`,
                  name === "a_tiempo" ? "A Tiempo / En Riesgo" : name === "a_destiempo" ? "A Destiempo" : "Vencidas",
                ]}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
                formatter={(v: string) =>
                  v === "a_tiempo" ? "A Tiempo / En Riesgo" : v === "a_destiempo" ? "A Destiempo" : "Vencidas"
                }
              />
              <Bar dataKey="a_tiempo" stackId="a" fill="#22c55e" name="a_tiempo" radius={[0, 0, 0, 0]} />
              <Bar dataKey="a_destiempo" stackId="a" fill="#f97316" name="a_destiempo" radius={[0, 0, 0, 0]} />
              <Bar dataKey="vencido" stackId="a" fill="#ef4444" name="vencido" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Gráficos 2 y 3 – dos columnas */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Gráfico 2 – Calidad Promedio por Maquilero */}
          <ChartCard
            title="Calidad Promedio por Maquilero"
            subtitle="Promedio del indicador de calidad (escala 0–10)"
            loading={loading}
            empty={calidadData.length === 0}
          >
            <ResponsiveContainer width="100%" height={Math.max(260, calidadData.length * 36)}>
              <BarChart
                data={calidadData}
                margin={{ top: 8, right: 16, left: -10, bottom: 0 }}
              >
                <CartesianGrid stroke="oklch(0.92 0.02 280)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="nombre"
                  stroke="oklch(0.45 0.04 280)"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  domain={[0, 10]}
                  stroke="oklch(0.45 0.04 280)"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip
                  cursor={{ fill: "oklch(0.15 0.04 295 / 0.12)" }}
                  contentStyle={{
                    background: "oklch(0.15 0.04 295)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "rgba(255,255,255,0.9)",
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.55)", marginBottom: 4 }}
                  formatter={(v: number) => [`${v} / 10`, "Calidad promedio"]}
                />
                <Bar dataKey="promedio" radius={[6, 6, 0, 0]} fill="oklch(0.62 0.18 220)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Gráfico 3 – Volumen por Familia (horizontal) */}
          <ChartCard
            title="Volumen por Familia"
            subtitle="Número de órdenes activas por familia de producto"
            loading={loading}
            empty={familiaData.length === 0}
          >
            <ResponsiveContainer width="100%" height={Math.max(260, familiaData.length * 32)}>
              <BarChart
                data={familiaData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid stroke="oklch(0.92 0.02 280)" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="oklch(0.45 0.04 280)"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="familia"
                  stroke="oklch(0.45 0.04 280)"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
                <RechartsTooltip
                  cursor={{ fill: "oklch(0.15 0.04 295 / 0.12)" }}
                  contentStyle={{
                    background: "oklch(0.15 0.04 295)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "rgba(255,255,255,0.9)",
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.55)", marginBottom: 4 }}
                  formatter={(v: number) => [`${v} órdenes`, "Total"]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="oklch(0.62 0.22 330)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* SECTION 3: MASTER TRACKING */}
      <section className="overflow-hidden rounded-xl border border-border/60 bg-white/80 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 ring-1 ring-violet-200">
              <Layers className="size-4 text-violet-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Master Tracking</h3>
              <p className="text-xs text-muted-foreground">
                Folio · Maquilador · Riesgo · Avance S1–S7
              </p>
            </div>
          </div>
          <Badge variant="outline" className="font-mono text-[11px]">
            {rows.length} órdenes
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[140px]">Folio</TableHead>
                <TableHead>Maquilador</TableHead>
                <TableHead className="w-[120px]">F. Entrega</TableHead>
                <TableHead className="w-[120px]">F. Límite Conf.</TableHead>
                <TableHead className="w-[140px]">Riesgo</TableHead>
                <TableHead>Avance S1 → S7</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-44" /></TableCell>
                    </TableRow>
                  ))}
                </>
              )}

              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      No hay órdenes activas en{" "}
                      <code className="font-mono text-xs">vw_resumen_operacion</code>.
                    </p>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                rows.map((r) => {
                  const ri = getRiesgoVisuals(r.riesgo_entrega)
                  return (
                    <TableRow key={String(r.id)} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-semibold text-foreground">
                            {r.folio ?? "—"}
                          </span>
                          {r.modelo && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {r.modelo}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {r.maquilero_nombre?.trim() || (
                            <span className="text-muted-foreground/70 italic">
                              Sin asignar
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {r.fecha_cancelacion
                          ? formatDate(r.fecha_cancelacion)
                          : <span className="text-muted-foreground/60 italic">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {r.fecha_limite_confirmacion
                          ? formatDate(r.fecha_limite_confirmacion)
                          : <span className="text-muted-foreground/60 italic">—</span>}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                            ri.className,
                          )}
                        >
                          {ri.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <MasterBubbleTimeline row={r} />
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function HealthScoreRing({
  loading,
  percent,
  subtitle,
}: {
  loading: boolean
  percent: number
  subtitle: string
}) {
  const safe = Math.max(0, Math.min(100, Math.round(percent || 0)))
  const size = 200
  const stroke = 14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - safe / 100)

  // Tone selection based on score
  const tone =
    safe > 80
      ? {
          stop1: "oklch(0.78 0.18 155)", // emerald light
          stop2: "oklch(0.65 0.2 150)", // emerald
          text: "text-emerald-300",
          label: "Excelente",
          glow: "0 0 24px oklch(0.7 0.2 150 / 0.4)",
        }
      : safe >= 50
        ? {
            stop1: "oklch(0.85 0.16 90)", // amber light
            stop2: "oklch(0.7 0.18 70)", // amber
            text: "text-amber-300",
            label: "Atención",
            glow: "0 0 24px oklch(0.75 0.18 70 / 0.4)",
          }
        : {
            stop1: "oklch(0.75 0.2 25)", // rose light
            stop2: "oklch(0.6 0.22 20)", // rose
            text: "text-rose-300",
            label: "Crítico",
            glow: "0 0 24px oklch(0.65 0.22 20 / 0.4)",
          }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
        Health Score de Entregas
      </p>
      <div
        className="relative"
        style={{ width: size, height: size, filter: loading ? "none" : `drop-shadow(${tone.glow})` }}
        role="img"
        aria-label={`Health score ${safe}%`}
      >
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id="health-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={tone.stop1} />
              <stop offset="100%" stopColor={tone.stop2} />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="oklch(1 0 0 / 0.1)"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#health-ring-gradient)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={loading ? circumference : offset}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {loading ? (
            <Skeleton className="h-10 w-20 bg-white/10" />
          ) : (
            <>
              <span className={cn("text-5xl font-bold tracking-tight tabular-nums", tone.text)}>
                {safe}
                <span className="text-2xl text-white/60">%</span>
              </span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                {tone.label}
              </span>
            </>
          )}
        </div>
      </div>
      <p className="max-w-[180px] text-center text-xs text-white/60">{subtitle}</p>
    </div>
  )
}

function HeroKpi({
  loading,
  icon,
  accentBorder,
  title,
  value,
  subtitle,
}: {
  loading: boolean
  icon: React.ReactNode
  accentBorder: string
  title: string
  value: React.ReactNode
  subtitle: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-md transition hover:bg-white/10">
      <div
        aria-hidden
        className={cn(
          "absolute left-0 top-0 h-1 w-full bg-gradient-to-r",
          accentBorder,
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
            {title}
          </p>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-28 bg-white/10" />
          ) : (
            <div className="mt-2 text-4xl font-bold tracking-tight text-white">
              {value}
            </div>
          )}
          <p className="mt-1 text-xs text-white/60">{subtitle}</p>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
          {icon}
        </div>
      </div>
    </div>
  )
}

function ChartCard({
  title,
  subtitle,
  loading,
  empty,
  className,
  children,
}: {
  title: string
  subtitle: string
  loading: boolean
  empty: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-white/80 p-5 shadow-sm backdrop-blur",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-[260px] w-full" />
      ) : empty ? (
        <div className="flex h-[260px] flex-col items-center justify-center text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Layers className="size-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Sin datos disponibles</p>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

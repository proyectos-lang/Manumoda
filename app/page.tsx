"use client"

import { useState } from "react"
import { AlertTriangle, Database, Loader2, Scissors, Settings as SettingsIcon, Palette } from "lucide-react"
import { ExcelUploader } from "@/components/excel-uploader"
import { OrdersTable } from "@/components/orders-table"
import { ProductionTrackingDashboard } from "@/components/production-tracking-dashboard"
import { AppSidebar, type ModuleKey } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { HomeDashboard } from "@/components/home-dashboard"
import { ConfigCatalogs } from "@/components/config-catalogs"
import { AnalyticsDashboard } from "@/components/analytics-dashboard"
import { OperationsOverview } from "@/components/operations-overview"
import { DesignModule } from "@/components/design-module"
import { CorteModule } from "@/components/corte-module"
import { ColaboradoresModule } from "@/components/colaboradores-module"
import { LoginScreen } from "@/components/login-screen"
import { FolioDetailProvider } from "@/components/folio-detail-drawer"
import type { ModuleFilter } from "@/lib/module-filter"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Toaster } from "@/components/ui/sonner"
import { useAuth } from "@/lib/auth-context"

const TITLES: Record<ModuleKey, string> = {
  inicio: "Página de Inicio",
  ingestion: "Panel General",
  diseno: "Diseño",
  corte: "Corte de Telas",
  seguimiento: "Seguimiento Maquila",
  operacion: "Resumen General de Operación",
  riesgos: "Seguimiento de Ordenes",
  colaboradores: "Registro de Colaboradores",
  configuracion: "Configuración",
}

export default function Page() {
  const { user, loading, logout } = useAuth()
  const [active, setActive] = useState<ModuleKey>("inicio")
  const [refreshKey, setRefreshKey] = useState(0)

  /**
   * Filtro que el módulo destino debe aplicar al abrirse.
   * Lo emiten las tarjetas de "Atención hoy" del inicio.
   */
  const [pendingFilter, setPendingFilter] = useState<ModuleFilter | null>(null)

  const navigate = (m: ModuleKey, filter?: ModuleFilter) => {
    setPendingFilter(filter ?? null)
    setActive(m)
  }

  // Al cambiar de módulo desde el menú lateral, el filtro heredado se descarta
  const handleSidebarChange = (m: ModuleKey) => navigate(m)

  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const configMissing = !hasUrl || !hasKey

  if (loading) {
    return (
      <div className="sidebar-cmyk-gradient flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/60" />
      </div>
    )
  }

  if (!user) {
    return <LoginScreen />
  }

  return (
    <FolioDetailProvider>
    <main className="content-cmyk-gradient min-h-screen">
      <AppSidebar active={active} onChange={handleSidebarChange} user={user} onLogout={logout} />

      <div className="lg:pl-[280px]">
        <AppHeader title={TITLES[active]} />

        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          {active === "inicio" && (
            <HomeDashboard configMissing={configMissing} onNavigate={navigate} />
          )}

          {active === "ingestion" && (
            <div className="space-y-6">
              {configMissing && (
                <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                  <AlertDescription>
                    Faltan las variables de entorno{" "}
                    <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> y/o{" "}
                    <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
                  </AlertDescription>
                </Alert>
              )}

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      Ingestión de Órdenes (Excel)
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Sube el archivo de pedidos. Se parsearán los campos requeridos y se insertarán
                      en{" "}
                      <code className="font-mono text-xs">manumoda.ordenes_produccion</code> con
                      estado <span className="font-medium text-foreground">Por Programar</span>.
                    </p>
                  </div>
                  <div className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs text-muted-foreground sm:flex">
                    <Database className="size-3.5 text-icon-cyan" />
                    idempresa = 1
                  </div>
                </div>

                <ExcelUploader
                  configMissing={configMissing}
                  onUploaded={() => setRefreshKey((k) => k + 1)}
                />
              </section>

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-foreground">Órdenes por Programar</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Listado de órdenes pendientes de programación.
                  </p>
                </div>

                <OrdersTable
                  refreshKey={refreshKey}
                  configMissing={configMissing}
                  initialFilter={pendingFilter}
                />
              </section>
            </div>
          )}

          {active === "diseno" && (
            <div className="space-y-6">
              {configMissing && (
                <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                  <AlertDescription>
                    Faltan las variables de entorno requeridas para conectar a Supabase.
                  </AlertDescription>
                </Alert>
              )}

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-100 ring-1 ring-indigo-200">
                    <Palette className="size-4 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      Programación de Diseño
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Seguimiento semanal de órdenes en diseño ·{" "}
                      <code className="font-mono">manumoda.diseno_programacion</code>
                    </p>
                  </div>
                </div>

                <DesignModule configMissing={configMissing} initialFilter={pendingFilter} />
              </section>
            </div>
          )}

          {active === "corte" && (
            <div className="space-y-6">
              {configMissing && (
                <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                  <AlertDescription>
                    Faltan las variables de entorno requeridas para conectar a Supabase.
                  </AlertDescription>
                </Alert>
              )}

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-200">
                    <Scissors className="size-4 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      Corte e Inventario de Telas
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Plan semanal y liquidación ·{" "}
                      <code className="font-mono">vw_plan_corte_detalle · vw_bonos_corte</code>
                    </p>
                  </div>
                </div>

                <CorteModule configMissing={configMissing} initialFilter={pendingFilter} />
              </section>
            </div>
          )}

          {active === "seguimiento" && (
            <div className="space-y-6">
              {configMissing && (
                <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                  <AlertDescription>
                    Faltan las variables de entorno requeridas para conectar a Supabase.
                  </AlertDescription>
                </Alert>
              )}

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-foreground">
                    Seguimiento Maquila
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Visualiza el avance de las órdenes en producción por fase (S1 a S7), maquilero asignado y fecha de entrega.
                  </p>
                </div>

                <ProductionTrackingDashboard
                  refreshKey={refreshKey}
                  configMissing={configMissing}
                  initialFilter={pendingFilter}
                />
              </section>
            </div>
          )}

          {active === "operacion" && (
            <div className="space-y-6">
              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold text-foreground">
                    Resumen General de Operación
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Salud de producción, cuellos de botella y carga por maquilador a partir de la
                    vista <code className="font-mono text-xs">vw_resumen_operacion</code>.
                  </p>
                </div>

                <OperationsOverview configMissing={configMissing} />
              </section>
            </div>
          )}

          {active === "riesgos" && (
            <div className="space-y-6">
              {configMissing && (
                <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                  <AlertDescription>
                    Faltan las variables de entorno requeridas para conectar a Supabase.
                  </AlertDescription>
                </Alert>
              )}

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold text-foreground">
                    Seguimiento de Ordenes
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Visión global del avance, fechas límite y semáforo de riesgo de entrega de
                    todas las órdenes.
                  </p>
                </div>

                <AnalyticsDashboard configMissing={configMissing} initialFilter={pendingFilter} />
              </section>
            </div>
          )}

          {active === "colaboradores" && (
            <ColaboradoresModule configMissing={configMissing} />
          )}

          {active === "configuracion" && (
            <div className="space-y-6">
              {configMissing && (
                <Alert variant="destructive" className="border-destructive/40 bg-white/80 backdrop-blur">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
                  <AlertDescription>
                    Faltan las variables de entorno requeridas para conectar a Supabase.
                  </AlertDescription>
                </Alert>
              )}

              <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 ring-1 ring-violet-200">
                    <SettingsIcon className="size-4 text-violet-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      Gestión de Catálogos
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Administra compradores, maquileros y submaquileros del sistema.
                    </p>
                  </div>
                </div>

                <ConfigCatalogs configMissing={configMissing} user={user} />
              </section>
            </div>
          )}
        </div>
      </div>

      <Toaster richColors position="top-right" />
    </main>
    </FolioDetailProvider>
  )
}

"use client"

import Image from "next/image"
import { Home, Upload, KanbanSquare, Scissors, Settings, User, BarChart3, Activity, Palette, Users, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SessionUser } from "@/lib/types"

export type ModuleKey =
  | "inicio"
  | "ingestion"
  | "diseno"
  | "corte"
  | "seguimiento"
  | "operacion"
  | "riesgos"
  | "colaboradores"
  | "configuracion"

export const NAV: {
  key: ModuleKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}[] = [
  { key: "inicio", label: "Inicio", icon: Home, color: "text-icon-cyan" },
  { key: "ingestion", label: "Panel General", icon: Upload, color: "text-icon-magenta" },
  {
    key: "diseno",
    label: "Diseño",
    icon: Palette,
    color: "text-indigo-400",
  },
  {
    key: "corte",
    label: "Corte de Telas",
    icon: Scissors,
    color: "text-amber-400",
  },
  {
    key: "seguimiento",
    label: "Seguimiento Maquila",
    icon: KanbanSquare,
    color: "text-icon-yellow",
  },
  {
    key: "operacion",
    label: "Resumen de Operación",
    icon: Activity,
    color: "text-violet-300",
  },
  {
    key: "riesgos",
    label: "Seguimiento de Ordenes",
    icon: BarChart3,
    color: "text-rose-400",
  },
  {
    key: "colaboradores",
    label: "Colaboradores",
    icon: Users,
    color: "text-violet-300",
  },
  { key: "configuracion", label: "Configuración", icon: Settings, color: "text-icon-green" },
]

export function AppSidebar({
  active,
  onChange,
  user,
  onLogout,
}: {
  active: ModuleKey
  onChange: (m: ModuleKey) => void
  user: SessionUser
  onLogout: () => void
}) {
  const visibleNav = NAV.filter(
    (item) => item.key === "inicio" || item.key === "configuracion" || user.es_admin || user.permisos.includes(item.key)
  )

  return (
    <aside className="sidebar-cmyk-gradient fixed inset-y-0 left-0 z-40 hidden w-[280px] flex-col border-r border-sidebar-border lg:flex">
      <div className="flex flex-col items-center gap-3 px-6 pb-6 pt-8">
        <div className="overflow-hidden rounded-2xl ring-1 ring-white/20 shadow-lg shadow-black/30">
          <Image
            src="/logo-manufacturas.jpeg"
            alt="Manufacturas de la Moda"
            width={120}
            height={120}
            className="size-24 object-cover"
            priority
          />
        </div>
      </div>

      <div className="mx-4 mb-2 h-px bg-white/10" />

      <nav className="flex-1 space-y-1 px-3 py-2">
        <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
          Navegación
        </p>
        {visibleNav.map((item) => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-white/10 text-sidebar-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.15)]"
                  : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground",
              )}
            >
              {isActive && (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-1 left-0 w-1 rounded-r-full", item.color.replace("text-", "bg-"))}
                />
              )}
              <Icon className={cn("size-4 transition-colors", item.color)} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="m-4 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            <User className="size-4 text-sidebar-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{user.nombre}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{user.es_admin ? "Administrador" : "Operador"}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Cerrar sesión"
            className="shrink-0 rounded-lg p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

"use client"

import { Bell, Search } from "lucide-react"
import { Input } from "@/components/ui/input"

export function AppHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-white/70 backdrop-blur-md">
      <div className="flex h-16 items-center gap-4 px-6">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>

        <div className="ml-auto flex items-center gap-3">
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar órdenes, folios..."
              className="h-9 w-72 border-border/60 bg-card/80 pl-9 text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
            />
          </div>

          <button
            type="button"
            aria-label="Notificaciones"
            className="relative inline-flex size-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition hover:text-foreground hover:bg-card/80"
          >
            <Bell className="size-4" />
            <span className="absolute right-2 top-2 size-1.5 rounded-full bg-icon-magenta" />
          </button>
        </div>
      </div>
    </header>
  )
}

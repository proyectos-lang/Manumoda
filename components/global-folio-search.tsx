"use client"

/**
 * Búsqueda global de folios (Ctrl/⌘+K).
 * Busca en ordenes_produccion y abre la ficha 360° del folio elegido.
 */

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useFolioDetail } from "@/components/folio-detail-drawer"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

type Result = {
  folio: string
  modelo: string | null
  cliente: string | null
  fase_actual: string
}

export function GlobalFolioSearch() {
  const { openFolio } = useFolioDetail()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Atajo de teclado Ctrl/⌘+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Cerrar al hacer clic fuera
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  // Búsqueda con debounce
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    const t = setTimeout(async () => {
      const supabase = getSupabase()
      if (!supabase) return
      setLoading(true)
      const { data } = await supabase
        .from("ordenes_produccion")
        .select("folio, modelo, cliente, fase_actual")
        .eq("idempresa", IDEMPRESA)
        .or(`folio.ilike.%${q}%,modelo.ilike.%${q}%`)
        .order("folio")
        .limit(8)
      setLoading(false)
      setResults((data ?? []) as Result[])
      setHighlighted(0)
      setOpen(true)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const select = (folio: string) => {
    openFolio(folio)
    setQuery("")
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={containerRef} className="relative hidden md:block">
      {loading ? (
        <Loader2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : (
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlighted((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlighted((h) => Math.max(h - 1, 0))
          } else if (e.key === "Enter") {
            e.preventDefault()
            select(results[highlighted].folio)
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
        placeholder="Buscar folio o modelo…  (Ctrl+K)"
        className="h-9 w-72 border-border/60 bg-card/80 pl-9 text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
      />

      {open && (
        <div className="absolute right-0 top-11 z-50 w-96 overflow-hidden rounded-xl border border-border bg-white shadow-xl">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Sin resultados para «{query.trim()}»
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={r.folio}>
                  <button
                    type="button"
                    onClick={() => select(r.folio)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                      i === highlighted ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="font-mono font-semibold text-foreground">{r.folio}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {r.modelo ?? "—"} · {r.cliente ?? "—"}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {r.fase_actual}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

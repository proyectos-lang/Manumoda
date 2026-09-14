"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, Search, Download, ClipboardList } from "lucide-react"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { cn } from "@/lib/utils"
import type { CatEtapaProduccion, EstadoEtapa, VwOrdenEtapa } from "@/lib/types"
import { EtapasOrdenSheet } from "@/components/etapas-orden-sheet"

/**
 * El tablero extendido: un renglón por folio y una columna por etapa,
 * con la fecha en que se completó cada una.
 *
 * POR QUÉ UNA MATRIZ Y NO UNA LISTA:
 *   La pregunta que responde esta pantalla es «¿dónde está atorada la
 *   producción?», y eso se ve comparando folios entre sí. Con una fila
 *   por folio y una columna por etapa, una columna roja de arriba abajo
 *   señala la etapa que frena todo.
 *
 * SOBRE EL COLOR:
 *   Verde = completada, rojo = pendiente, ámbar = en proceso, gris =
 *   no aplica. El color no va solo: cada celda lleva la fecha o un
 *   guion, porque un tablero que solo distingue por color es ilegible
 *   para quien no distingue rojo y verde, y además no dice CUÁNDO.
 *
 * CARGA:
 *   Esta pestaña sí trae `vw_orden_etapas` completa (9 filas por folio)
 *   porque necesita la fecha de cada una. Por eso vive en su propia
 *   pestaña y no en la tabla principal: se paga el costo solo cuando
 *   alguien la abre.
 */

const ESTILO_CELDA: Record<EstadoEtapa, string> = {
  Completada: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "En proceso": "bg-amber-50 text-amber-700 border-amber-200",
  Pendiente: "bg-rose-50 text-rose-700 border-rose-200",
  "No aplica": "bg-muted/50 text-muted-foreground border-border",
}

/** Marca corta para que la celda se lea sin depender solo del color. */
const MARCA: Record<EstadoEtapa, string> = {
  Completada: "✓",
  "En proceso": "•",
  Pendiente: "—",
  "No aplica": "n/a",
}

function fmtFecha(iso: string | null): string {
  if (!iso) return ""
  // Se parte la cadena en vez de usar Date: `new Date("2026-09-14")` se
  // interpreta como UTC y en México muestra el día anterior.
  const [a, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${a.slice(2)}`
}

export function EtapasTablero({ configMissing }: { configMissing: boolean }) {
  const [filas, setFilas] = useState<VwOrdenEtapa[]>([])
  const [etapas, setEtapas] = useState<CatEtapaProduccion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [filtroEstado, setFiltroEstado] = useState<string>("todos")
  const [filtroEtapa, setFiltroEtapa] = useState<string>("todas")
  const [folioAbierto, setFolioAbierto] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const cargar = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)

    const [cat, det] = await Promise.all([
      fetchAll<CatEtapaProduccion>(() =>
        supabase
          .from("cat_etapas_produccion")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .eq("activo", true)
          .order("numero"),
      ),
      fetchAll<VwOrdenEtapa>(() =>
        supabase
          .from("vw_orden_etapas")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("folio")
          .order("numero"),
      ),
    ])

    setLoading(false)
    if (cat.error || det.error) {
      const msg = cat.error?.message ?? det.error?.message ?? "Error desconocido"
      setError(msg)
      toast.error("No se pudo cargar el tablero de etapas", {
        description: msg,
      })
      return
    }
    setEtapas(cat.data)
    setFilas(det.data)
  }, [configMissing])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Una entrada por folio, con sus etapas indexadas por número. */
  const porFolio = useMemo(() => {
    const mapa = new Map<
      string,
      {
        folio: string
        modelo: string | null
        cliente: string | null
        etapas: Map<number, VwOrdenEtapa>
      }
    >()
    for (const f of filas) {
      let e = mapa.get(f.folio)
      if (!e) {
        e = {
          folio: f.folio,
          modelo: f.modelo,
          cliente: f.cliente,
          etapas: new Map(),
        }
        mapa.set(f.folio, e)
      }
      e.etapas.set(f.numero, f)
    }
    return [...mapa.values()]
  }, [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return porFolio.filter((f) => {
      if (q && !`${f.folio} ${f.modelo ?? ""} ${f.cliente ?? ""}`.toLowerCase().includes(q))
        return false

      // Filtrar por el estado de una etapa concreta: así se responde
      // «cuáles folios traen el corte pendiente».
      if (filtroEtapa !== "todas") {
        const e = f.etapas.get(Number(filtroEtapa))
        if (!e) return false
        if (filtroEstado !== "todos" && e.estado !== filtroEstado) return false
        return true
      }
      if (filtroEstado !== "todos") {
        let alguna = false
        for (const e of f.etapas.values()) if (e.estado === filtroEstado) alguna = true
        if (!alguna) return false
      }
      return true
    })
  }, [porFolio, busqueda, filtroEstado, filtroEtapa])

  /** Cuántos folios hay en cada estado, por etapa. Es la lectura de arriba. */
  const resumen = useMemo(() => {
    const r = new Map<number, Record<EstadoEtapa, number>>()
    for (const e of etapas)
      r.set(e.numero, {
        Completada: 0,
        "En proceso": 0,
        Pendiente: 0,
        "No aplica": 0,
      })
    for (const f of visibles)
      for (const [num, e] of f.etapas) {
        const fila = r.get(num)
        if (fila) fila[e.estado]++
      }
    return r
  }, [visibles, etapas])

  function exportar() {
    const filasExcel = visibles.map((f) => {
      const fila: Record<string, string> = {
        Folio: f.folio,
        Modelo: f.modelo ?? "",
        Cliente: f.cliente ?? "",
      }
      for (const e of etapas) {
        const d = f.etapas.get(e.numero)
        fila[`${e.numero}. ${e.nombre}`] = d
          ? d.fecha_completada
            ? `${d.estado} ${fmtFecha(d.fecha_completada)}`
            : d.estado
          : ""
      }
      return fila
    })
    const hoja = XLSX.utils.json_to_sheet(filasExcel)
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, "Etapas")
    XLSX.writeFile(libro, `etapas-produccion-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`${filasExcel.length} folios exportados`)
  }

  return (
    <div className="space-y-4">
      {/* ── Controles ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Folio, modelo o cliente…"
            className="h-9 w-64 pl-8"
          />
        </div>

        <Select value={filtroEtapa} onValueChange={setFiltroEtapa}>
          <SelectTrigger className="h-9 w-56 bg-transparent">
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las etapas</SelectItem>
            {etapas.map((e) => (
              <SelectItem key={e.id} value={String(e.numero)}>
                {e.numero}. {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="h-9 w-44 bg-transparent">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Cualquier estado</SelectItem>
            <SelectItem value="Completada">Completada</SelectItem>
            <SelectItem value="En proceso">En proceso</SelectItem>
            <SelectItem value="Pendiente">Pendiente</SelectItem>
            <SelectItem value="No aplica">No aplica</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={visibles.length === 0}
            className="h-9 gap-1.5 bg-transparent"
          >
            <Download className="size-3.5" />
            Exportar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={cargar}
            disabled={loading || configMissing}
            className="h-9 gap-2 bg-transparent"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Actualizar
          </Button>
        </div>
      </div>

      {/* ── Leyenda: el color nunca va solo ── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium">
          {visibles.length} folios · {etapas.length} etapas
        </span>
        {(["Completada", "En proceso", "Pendiente", "No aplica"] as EstadoEtapa[]).map(
          (s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex size-4 items-center justify-center rounded border text-[9px] font-bold",
                  ESTILO_CELDA[s],
                )}
              >
                {MARCA[s]}
              </span>
              {s}
            </span>
          ),
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* ── La matriz ── */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="sticky left-0 z-20 bg-muted font-semibold">
                  Folio
                </TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                {etapas.map((e) => (
                  <TableHead
                    key={e.id}
                    className="min-w-[92px] text-center text-xs font-semibold"
                    title={e.descripcion ?? e.nombre}
                  >
                    <span className="block">{e.numero}</span>
                    <span className="block font-normal leading-tight opacity-75">
                      {e.nombre}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-24 text-center font-semibold">Gestionar</TableHead>
              </TableRow>

              {/* Cuántos folios hay en cada estado por etapa */}
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="sticky left-0 z-20 bg-muted/60 text-[11px] font-normal text-muted-foreground">
                  Resumen
                </TableHead>
                <TableHead />
                {etapas.map((e) => {
                  const r = resumen.get(e.numero)
                  return (
                    <TableHead key={e.id} className="text-center text-[11px] font-normal">
                      {r ? (
                        <span className="tabular-nums">
                          <span className="text-emerald-600">{r.Completada}</span>
                          {" / "}
                          <span className="text-rose-600">{r.Pendiente}</span>
                        </span>
                      ) : null}
                    </TableHead>
                  )
                })}
                <TableHead />
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={etapas.length + 3}
                    className="h-32 text-center text-muted-foreground"
                  >
                    <Loader2 className="mr-2 inline size-4 animate-spin" />
                    Cargando etapas…
                  </TableCell>
                </TableRow>
              ) : visibles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={etapas.length + 3}
                    className="h-32 text-center text-muted-foreground"
                  >
                    {porFolio.length === 0
                      ? "No hay folios con etapas registradas."
                      : "Sin resultados para los filtros aplicados."}
                  </TableCell>
                </TableRow>
              ) : (
                visibles.map((f) => (
                  <TableRow key={f.folio} className="hover:bg-muted/30">
                    <TableCell className="sticky left-0 z-10 bg-card font-mono text-xs font-semibold">
                      {f.folio}
                      {f.modelo && f.modelo !== f.folio && (
                        <span className="ml-1 font-sans font-normal text-muted-foreground">
                          · {f.modelo}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                      {f.cliente ?? "—"}
                    </TableCell>

                    {etapas.map((e) => {
                      const d = f.etapas.get(e.numero)
                      if (!d)
                        return (
                          <TableCell key={e.id} className="text-center text-xs">
                            —
                          </TableCell>
                        )
                      return (
                        <TableCell key={e.id} className="p-1 text-center">
                          <div
                            className={cn(
                              "rounded border px-1 py-1 text-[11px] leading-tight",
                              ESTILO_CELDA[d.estado],
                            )}
                            title={`${e.nombre}: ${d.estado}${
                              d.fecha_completada
                                ? ` el ${fmtFecha(d.fecha_completada)}`
                                : ""
                            }${d.responsable ? ` · ${d.responsable}` : ""}`}
                          >
                            <span className="block font-bold">{MARCA[d.estado]}</span>
                            <span className="block tabular-nums">
                              {d.fecha_completada ? fmtFecha(d.fecha_completada) : " "}
                            </span>
                          </div>
                        </TableCell>
                      )
                    })}

                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => {
                          setFolioAbierto(f.folio)
                          setSheetOpen(true)
                        }}
                      >
                        <ClipboardList className="size-3" />
                        Registrar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <EtapasOrdenSheet
        folio={folioAbierto}
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o)
          if (!o) setFolioAbierto(null)
        }}
        onSaved={cargar}
      />
    </div>
  )
}

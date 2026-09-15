"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import type { SituacionEtapa, VwEtapaCola } from "@/lib/types"
import { EtapasOrdenSheet } from "@/components/etapas-orden-sheet"

/**
 * Folios por etapa: qué tiene que trabajar hoy cada etapa.
 *
 * Es la vista inversa del tablero: en vez de preguntar «¿en qué punto va
 * este folio?», pregunta «¿qué le toca a esta etapa?». Sirve para
 * repartir trabajo, no para seguir una orden.
 *
 * LAS TRES SITUACIONES:
 *   Lista      la etapa anterior ya está resuelta: se puede empezar.
 *   En proceso ya arrancó y no termina.
 *   Bloqueada  la etapa anterior todavía no está lista.
 *
 * POR QUÉ SOLO LA ETAPA ANTERIOR Y NO TODAS:
 *   Decisión de operación. Exigir que todas las anteriores estén
 *   completas amontonaría hoy los 630 folios en la etapa 1 y dejaría
 *   las otras ocho vacías, porque las seis etapas nuevas aún no tienen
 *   captura. Mirando solo la previa, el tablero refleja que Diseño y
 *   Corte ya avanzaron.
 *
 * LOS BLOQUEADOS SE MUESTRAN, NO SE ESCONDEN:
 *   Se listan aparte y colapsados. Una etapa que solo ve lo que puede
 *   hacer no sabe qué la está frenando ni a quién reclamarle.
 */

const ESTILO_SITUACION: Record<SituacionEtapa, string> = {
  Lista: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "En proceso": "bg-amber-50 text-amber-700 border-amber-200",
  Bloqueada: "bg-rose-50 text-rose-700 border-rose-200",
  Completada: "bg-muted text-muted-foreground border-border",
  "No aplica": "bg-muted text-muted-foreground border-border",
}

function fmtFecha(iso: string | null): string {
  if (!iso) return "—"
  // Se parte la cadena en vez de usar Date: `new Date("2026-09-14")` se
  // interpreta como UTC y en México muestra el día anterior.
  const [a, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${a.slice(2)}`
}

/** Un folio que lleva mucho esperando se marca, para que salte a la vista. */
function estiloEspera(dias: number | null): string {
  if (dias == null) return "text-muted-foreground"
  if (dias >= 90) return "font-semibold text-rose-600"
  if (dias >= 45) return "font-semibold text-amber-600"
  return "text-muted-foreground"
}

export function EtapasCola({ configMissing }: { configMissing: boolean }) {
  const [filas, setFilas] = useState<VwEtapaCola[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [abierta, setAbierta] = useState<number | null>(null)
  const [verBloqueados, setVerBloqueados] = useState<Set<number>>(new Set())
  const [folioAbierto, setFolioAbierto] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const cargar = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)

    // Solo lo accionable: completadas y no-aplica no son cola de trabajo.
    const { data, error: err } = await fetchAll<VwEtapaCola>(() =>
      supabase
        .from("vw_etapas_cola")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .in("situacion", ["Lista", "En proceso", "Bloqueada"])
        .order("numero")
        .order("fecha_pedido", { nullsFirst: false }),
    )

    setLoading(false)
    if (err) {
      setError(err.message)
      toast.error("No se pudo cargar la cola de etapas", { description: err.message })
      return
    }
    setFilas(data)
  }, [configMissing])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Agrupado por etapa, y dentro por situación. */
  const porEtapa = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const mapa = new Map<
      number,
      {
        numero: number
        etapa: string
        listas: VwEtapaCola[]
        enProceso: VwEtapaCola[]
        bloqueadas: VwEtapaCola[]
      }
    >()
    for (const f of filas) {
      if (
        q &&
        !`${f.folio} ${f.modelo ?? ""} ${f.cliente ?? ""}`.toLowerCase().includes(q)
      )
        continue
      let e = mapa.get(f.numero)
      if (!e) {
        e = { numero: f.numero, etapa: f.etapa, listas: [], enProceso: [], bloqueadas: [] }
        mapa.set(f.numero, e)
      }
      if (f.situacion === "Lista") e.listas.push(f)
      else if (f.situacion === "En proceso") e.enProceso.push(f)
      else if (f.situacion === "Bloqueada") e.bloqueadas.push(f)
    }
    // Lo más viejo primero: es lo que hay que atender antes.
    const porEspera = (a: VwEtapaCola, b: VwEtapaCola) =>
      (b.dias_espera ?? -1) - (a.dias_espera ?? -1)
    for (const e of mapa.values()) {
      e.listas.sort(porEspera)
      e.enProceso.sort(porEspera)
      e.bloqueadas.sort(porEspera)
    }
    return [...mapa.values()].sort((a, b) => a.numero - b.numero)
  }, [filas, busqueda])

  function exportar() {
    const filasExcel = filas
      .filter((f) => f.situacion !== "Bloqueada")
      .map((f) => ({
        Etapa: `${f.numero}. ${f.etapa}`,
        Situación: f.situacion,
        Folio: f.folio,
        Modelo: f.modelo ?? "",
        Cliente: f.cliente ?? "",
        Piezas: f.piezas ?? "",
        "Días esperando": f.dias_espera ?? "",
        "Fecha pedido": fmtFecha(f.fecha_pedido),
        "Límite entrega": fmtFecha(f.fecha_cancelacion),
        "Etapa previa": f.etapa_previa ?? "",
      }))
    const hoja = XLSX.utils.json_to_sheet(filasExcel)
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, "Folios por etapa")
    XLSX.writeFile(libro, `folios-por-etapa-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`${filasExcel.length} renglones exportados`)
  }

  return (
    <div className="space-y-4">
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
        <p className="text-xs text-muted-foreground">
          Cada etapa ve los folios cuya etapa anterior ya quedó resuelta.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={filas.length === 0}
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

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Cargando…
        </div>
      ) : porEtapa.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-muted-foreground">
          {filas.length === 0
            ? "No hay folios pendientes en ninguna etapa."
            : "Sin resultados para la búsqueda."}
        </div>
      ) : (
        /*
         * Bloque simple con space-y, NO flex-col con altura fija: en un
         * contenedor flex acotado los hijos heredan flex-shrink 1 y las
         * tarjetas se aplastan, aunque haya overflow-y-auto.
         */
        <div className="space-y-3">
          {porEtapa.map((e) => {
            const expandida = abierta === e.numero
            const accionables = e.listas.length + e.enProceso.length
            return (
              <div key={e.numero} className="overflow-hidden rounded-lg border border-border bg-card">
                {/* Encabezado de la etapa */}
                <button
                  type="button"
                  onClick={() => setAbierta(expandida ? null : e.numero)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  {expandida ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-mono text-xs text-muted-foreground">{e.numero}</span>
                  <span className="font-medium">{e.etapa}</span>

                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {e.listas.length > 0 && (
                      <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        {e.listas.length} lista{e.listas.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {e.enProceso.length > 0 && (
                      <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                        {e.enProceso.length} en proceso
                      </span>
                    )}
                    {e.bloqueadas.length > 0 && (
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-muted-foreground">
                        {e.bloqueadas.length} bloqueada{e.bloqueadas.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {accionables === 0 && e.bloqueadas.length === 0 && (
                      <span className="text-muted-foreground">sin pendientes</span>
                    )}
                  </span>
                </button>

                {expandida && (
                  <div className="border-t border-border">
                    {accionables === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Nada que trabajar por ahora en esta etapa.
                      </p>
                    ) : (
                      <TablaFolios
                        filas={[...e.enProceso, ...e.listas]}
                        onRegistrar={(folio) => {
                          setFolioAbierto(folio)
                          setSheetOpen(true)
                        }}
                      />
                    )}

                    {/* Los bloqueados, aparte: no son trabajo de hoy, pero
                        explican qué está frenando esta etapa. */}
                    {e.bloqueadas.length > 0 && (
                      <div className="border-t border-border bg-muted/20">
                        <button
                          type="button"
                          onClick={() =>
                            setVerBloqueados((prev) => {
                              const s = new Set(prev)
                              if (s.has(e.numero)) s.delete(e.numero)
                              else s.add(e.numero)
                              return s
                            })
                          }
                          className="w-full px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                        >
                          {verBloqueados.has(e.numero) ? "▾" : "▸"} {e.bloqueadas.length}{" "}
                          folios bloqueados — esperan a{" "}
                          <span className="font-medium">
                            {e.bloqueadas[0]?.etapa_previa ?? "la etapa anterior"}
                          </span>
                        </button>
                        {verBloqueados.has(e.numero) && (
                          <TablaFolios
                            filas={e.bloqueadas}
                            onRegistrar={(folio) => {
                              setFolioAbierto(folio)
                              setSheetOpen(true)
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

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

function TablaFolios({
  filas,
  onRegistrar,
}: {
  filas: VwEtapaCola[]
  onRegistrar: (folio: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="font-semibold">Folio</TableHead>
            <TableHead className="font-semibold">Cliente</TableHead>
            <TableHead className="font-semibold">Modelo</TableHead>
            <TableHead className="text-right font-semibold">Piezas</TableHead>
            <TableHead className="text-right font-semibold">Esperando</TableHead>
            <TableHead className="font-semibold">Límite entrega</TableHead>
            <TableHead className="font-semibold">Situación</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filas.map((f) => (
            <TableRow key={`${f.folio}-${f.numero}`} className="hover:bg-muted/30">
              <TableCell className="font-mono text-xs font-semibold">{f.folio}</TableCell>
              <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                {f.cliente ?? "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {f.modelo ?? "—"}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {f.piezas ?? "—"}
              </TableCell>
              <TableCell
                className={cn("text-right text-xs tabular-nums", estiloEspera(f.dias_espera))}
                title={
                  f.fecha_pedido
                    ? `Pedido el ${fmtFecha(f.fecha_pedido)}`
                    : "Sin fecha de pedido"
                }
              >
                {f.dias_espera == null ? "—" : `${f.dias_espera} d`}
              </TableCell>
              <TableCell className="text-xs tabular-nums text-muted-foreground">
                {fmtFecha(f.fecha_cancelacion)}
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[11px] font-medium",
                    ESTILO_SITUACION[f.situacion],
                  )}
                  title={
                    f.situacion === "Bloqueada"
                      ? `Espera a: ${f.etapa_previa} (${f.etapa_previa_estado})`
                      : undefined
                  }
                >
                  {f.situacion}
                </span>
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={() => onRegistrar(f.folio)}
                >
                  <ClipboardList className="size-3" />
                  Registrar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

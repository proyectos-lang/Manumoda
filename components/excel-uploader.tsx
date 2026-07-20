"use client"

import { useCallback, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { parseExcelFile, type ParseIssue } from "@/lib/excel-parser"
import type { ParsedRow } from "@/lib/types"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"

type Stats = {
  total: number
  inserted: number
  updated: number
  skippedExisting: number
  failed: number
}

type UpdateDiff = {
  folio: string
  id: number | string
  payload: Record<string, unknown>
  cambios: { campo: string; antes: string; despues: string }[]
}

/** Resultado del análisis previo (dry-run) — nada se ha escrito aún. */
type PendingUpload = {
  fileName: string
  totalRows: number
  toInsert: ParsedRow[]
  toUpdate: UpdateDiff[]
  sinCambios: number
  duplicados: string[]
  issues: ParseIssue[]
  unmatchedComp: string[]
  compNameToId: Map<string, number>
}

type Props = {
  onUploaded: () => void
  configMissing: boolean
}

export function ExcelUploader({ onUploaded, configMissing }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Fase 1: analizar el archivo sin escribir nada ──────────────────────────

  const analyzeFile = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const file = files[0]
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        toast.error("Formato no soportado. Sube un archivo .xlsx, .xls o .csv")
        return
      }
      if (configMissing) {
        toast.error("Conexión a Supabase no configurada.")
        return
      }

      setIsProcessing(true)
      setProgress(10)
      setStats(null)

      try {
        const { rows: allRows, issues, duplicados } = await parseExcelFile(file)
        setProgress(30)

        if (allRows.length === 0) {
          toast.warning("No se encontraron filas válidas con FOLIO en el archivo.")
          return
        }

        const supabase = getSupabase()
        if (!supabase) {
          toast.error("Cliente de Supabase no inicializado.")
          return
        }

        // Folios existentes con los campos que podrían actualizarse
        const allFolios = allRows.map((r) => r.folio)
        const existingMap = new Map<
          string,
          {
            id: number | string
            maquilero: string | null
            cliente: string | null
            modelo: string | null
            fecha_cancelacion: string | null
          }
        >()
        const FOLIO_BATCH = 500

        for (let i = 0; i < allFolios.length; i += FOLIO_BATCH) {
          const slice = allFolios.slice(i, i + FOLIO_BATCH)
          const { data, error } = await supabase
            .from("ordenes_produccion")
            .select("id, folio, maquilero, cliente, modelo, fecha_cancelacion")
            .eq("idempresa", IDEMPRESA)
            .in("folio", slice)

          if (error) {
            toast.error("Error al verificar folios existentes", { description: error.message })
            return
          }

          for (const row of (data ?? []) as {
            id: number | string
            folio: string
            maquilero: string | null
            cliente: string | null
            modelo: string | null
            fecha_cancelacion: string | null
          }[]) {
            if (row?.folio) existingMap.set(row.folio, row)
          }
        }

        setProgress(60)

        // Clasificar: nuevas / a actualizar (con diff) / sin cambios
        const toInsert: ParsedRow[] = []
        const toUpdate: UpdateDiff[] = []
        let sinCambios = 0

        for (const r of allRows) {
          const existing = existingMap.get(r.folio)
          if (!existing) {
            toInsert.push(r)
            continue
          }

          const payload: Record<string, unknown> = {}
          const cambios: UpdateDiff["cambios"] = []

          if (!existing.maquilero?.trim() && r.maquilero_nombre?.trim()) {
            payload.maquilero = r.maquilero_nombre
            payload.fase_actual = "S1"
            cambios.push({ campo: "maquilero", antes: "—", despues: r.maquilero_nombre.trim() })
          }
          if (r.cliente?.trim() && r.cliente.trim() !== (existing.cliente ?? "").trim()) {
            payload.cliente = r.cliente.trim()
            cambios.push({
              campo: "cliente",
              antes: existing.cliente?.trim() || "—",
              despues: r.cliente.trim(),
            })
          }
          if (r.modelo?.trim() && r.modelo.trim() !== (existing.modelo ?? "").trim()) {
            payload.modelo = r.modelo.trim()
            cambios.push({
              campo: "modelo",
              antes: existing.modelo?.trim() || "—",
              despues: r.modelo.trim(),
            })
          }
          if (r.fecha_cancelacion != null && r.fecha_cancelacion !== existing.fecha_cancelacion) {
            payload.fecha_cancelacion = r.fecha_cancelacion
            cambios.push({
              campo: "fecha entrega",
              antes: existing.fecha_cancelacion ?? "—",
              despues: r.fecha_cancelacion,
            })
          }

          if (cambios.length > 0) {
            toUpdate.push({ folio: r.folio, id: existing.id, payload, cambios })
          } else {
            sinCambios++
          }
        }

        // Catálogo de compradores (solo lo necesitan las filas nuevas)
        const compNameToId = new Map<string, number>()
        const compradoraNames = Array.from(
          new Set(
            toInsert.map((r) => r.cliente?.trim()).filter((n): n is string => !!n),
          ),
        )
        let unmatchedComp: string[] = []

        if (compradoraNames.length > 0) {
          const compRes = await supabase
            .from("compradores")
            .select("id, nombre")
            .eq("idempresa", IDEMPRESA)
          if (compRes.error) {
            toast.error("Error al consultar el catálogo de Compradores", {
              description: compRes.error.message,
            })
            return
          }
          for (const c of (compRes.data ?? []) as { id: number; nombre: string }[]) {
            if (c?.nombre) compNameToId.set(c.nombre.trim().toLowerCase(), Number(c.id))
          }
          unmatchedComp = compradoraNames.filter((n) => !compNameToId.has(n.toLowerCase()))
        }

        setProgress(100)

        if (toInsert.length === 0 && toUpdate.length === 0) {
          setStats({ total: allRows.length, inserted: 0, updated: 0, skippedExisting: sinCambios, failed: 0 })
          toast.info("No hay cambios que aplicar.", {
            description: `${sinCambios} folio(s) ya están idénticos en el sistema.`,
          })
          return
        }

        // Abrir la previsualización — nada se escribe hasta confirmar
        setPending({
          fileName: file.name,
          totalRows: allRows.length,
          toInsert,
          toUpdate,
          sinCambios,
          duplicados,
          issues,
          unmatchedComp,
          compNameToId,
        })
      } catch (err) {
        console.error("Error al analizar el archivo:", err)
        toast.error("Error al procesar el archivo.", {
          description: err instanceof Error ? err.message : undefined,
        })
      } finally {
        setIsProcessing(false)
        setProgress(0)
        if (inputRef.current) inputRef.current.value = ""
      }
    },
    [configMissing],
  )

  // ── Fase 2: confirmado — escribir con reporte de fallos por folio ──────────

  const commitUpload = useCallback(async () => {
    if (!pending) return
    const supabase = getSupabase()
    if (!supabase) return

    const { toInsert, toUpdate, sinCambios, totalRows, compNameToId } = pending
    setPending(null)
    setIsProcessing(true)
    setProgress(5)

    const failedFolios: string[] = []
    let inserted = 0
    let updated = 0

    try {
      const buildInsertRow = (r: ParsedRow) => {
        const { maquilero_nombre, ...rest } = r
        const maquilero = maquilero_nombre?.trim() || null
        const idcompradora =
          rest.cliente && compNameToId.has(rest.cliente.trim().toLowerCase())
            ? compNameToId.get(rest.cliente.trim().toLowerCase())!
            : null
        const fase_actual = maquilero ? "S1" : "Por Programar"
        return { ...rest, idempresa: IDEMPRESA, fase_actual, maquilero, idcompradora }
      }

      // INSERT por lotes; si un lote falla, reintento fila por fila para
      // saber exactamente qué folios fallaron
      const BATCH_SIZE = 200
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const slice = toInsert.slice(i, i + BATCH_SIZE)
        const { error } = await supabase
          .from("ordenes_produccion")
          .insert(slice.map(buildInsertRow))

        if (!error) {
          inserted += slice.length
        } else {
          for (const r of slice) {
            const { error: rowError } = await supabase
              .from("ordenes_produccion")
              .insert(buildInsertRow(r))
            if (rowError) failedFolios.push(r.folio)
            else inserted++
          }
        }

        const pct = 5 + Math.round(((i + slice.length) / Math.max(toInsert.length, 1)) * 55)
        setProgress(Math.min(pct, 60))
      }

      // UPDATE fila por fila (los payloads difieren entre folios)
      for (let i = 0; i < toUpdate.length; i++) {
        const u = toUpdate[i]
        const { error } = await supabase
          .from("ordenes_produccion")
          .update(u.payload)
          .eq("id", u.id)
          .eq("idempresa", IDEMPRESA)

        if (error) failedFolios.push(u.folio)
        else updated++

        if ((i + 1) % 20 === 0 || i === toUpdate.length - 1) {
          const pct = 60 + Math.round(((i + 1) / toUpdate.length) * 35)
          setProgress(Math.min(pct, 95))
        }
      }

      setProgress(100)
      const failed = failedFolios.length
      setStats({ total: totalRows, inserted, updated, skippedExisting: sinCambios, failed })

      const failedDesc =
        failed > 0
          ? `Folios con error: ${failedFolios.slice(0, 8).join(", ")}${failed > 8 ? ` y ${failed - 8} más` : ""}`
          : undefined

      if (failed === 0) {
        toast.success(
          `${inserted} nuevas${updated > 0 ? `, ${updated} actualizadas` : ""}.`,
        )
      } else if (inserted + updated === 0) {
        toast.error(`Falló la carga de ${failed} filas.`, { description: failedDesc })
      } else {
        toast.warning(`${inserted} nuevas, ${updated} actualizadas, ${failed} con error.`, {
          description: failedDesc,
        })
      }

      onUploaded()
    } catch (err) {
      console.error("Error durante la carga:", err)
      toast.error("Error durante la carga.", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setTimeout(() => {
        setIsProcessing(false)
        setProgress(0)
      }, 600)
    }
  }, [pending, onUploaded])

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!isProcessing) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (isProcessing) return
          analyzeFile(e.dataTransfer.files)
        }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-10 transition-colors",
          isDragging
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-border bg-muted/30 hover:bg-muted/50",
          (isProcessing || configMissing) && "pointer-events-none opacity-70",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => analyzeFile(e.target.files)}
        />

        <div className="flex size-14 items-center justify-center rounded-full bg-background ring-1 ring-border">
          {isProcessing ? (
            <Loader2 className="size-6 animate-spin text-emerald-600" />
          ) : (
            <Upload className="size-6 text-muted-foreground" />
          )}
        </div>

        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {isProcessing ? "Procesando archivo..." : "Arrastra tu archivo Excel o CSV aquí"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Formatos soportados: .xlsx, .xls, .csv · Verás una previsualización antes de aplicar
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={isProcessing || configMissing}
          className="gap-2"
        >
          <FileSpreadsheet className="size-4" />
          Seleccionar archivo
        </Button>

        {isProcessing && (
          <div className="w-full max-w-md space-y-2">
            <Progress value={progress} />
            <p className="text-center text-xs text-muted-foreground">{progress}%</p>
          </div>
        )}

        {stats && !isProcessing && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            {stats.inserted > 0 && (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="size-4" />
                {stats.inserted} nuevas
              </span>
            )}
            {stats.updated > 0 && (
              <span className="text-blue-600">{stats.updated} actualizada(s)</span>
            )}
            {stats.skippedExisting > 0 && (
              <span className="text-muted-foreground">{stats.skippedExisting} sin cambios</span>
            )}
            {stats.failed > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="size-4" />
                {stats.failed} con error
              </span>
            )}
            <span className="text-muted-foreground">de {stats.total} filas</span>
          </div>
        )}
      </div>

      {/* ── Previsualización (dry-run) ─────────────────────────────────────── */}
      <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirmar carga — {pending?.fileName}</DialogTitle>
            <DialogDescription>
              Nada se ha escrito todavía. Revisa los cambios antes de aplicar.
            </DialogDescription>
          </DialogHeader>

          {pending && (
            <div className="space-y-4 text-sm">
              {/* Resumen */}
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  {pending.toInsert.length} nuevas
                </span>
                <span className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  {pending.toUpdate.length} a actualizar
                </span>
                <span className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {pending.sinCambios} sin cambios
                </span>
              </div>

              {/* Advertencias */}
              {(pending.duplicados.length > 0 ||
                pending.issues.length > 0 ||
                pending.unmatchedComp.length > 0) && (
                <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-3">
                  {pending.duplicados.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        <strong>{pending.duplicados.length} folio(s) repetidos en el archivo</strong>{" "}
                        (se usará la última fila de cada uno):{" "}
                        {pending.duplicados.slice(0, 6).join(", ")}
                        {pending.duplicados.length > 6 && "…"}
                      </span>
                    </p>
                  )}
                  {pending.unmatchedComp.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        <strong>Compradores sin match en catálogo</strong> (quedarán sin vincular):{" "}
                        {pending.unmatchedComp.slice(0, 6).join(", ")}
                        {pending.unmatchedComp.length > 6 && "…"}
                      </span>
                    </p>
                  )}
                  {pending.issues.length > 0 && (
                    <div className="text-xs text-amber-800">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {pending.issues.length} dato(s) descartados por formato:
                      </p>
                      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto pl-5">
                        {pending.issues.slice(0, 20).map((iss, i) => (
                          <li key={i}>
                            Fila {iss.fila}
                            {iss.folio ? ` (${iss.folio})` : ""}: {iss.problema}
                          </li>
                        ))}
                        {pending.issues.length > 20 && (
                          <li>…y {pending.issues.length - 20} más</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Diff de actualizaciones */}
              {pending.toUpdate.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-foreground">
                    Cambios sobre folios existentes:
                  </p>
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-medium">Folio</th>
                          <th className="px-3 py-1.5 text-left font-medium">Campo</th>
                          <th className="px-3 py-1.5 text-left font-medium">Actual</th>
                          <th className="px-3 py-1.5 text-left font-medium">Nuevo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {pending.toUpdate.flatMap((u) =>
                          u.cambios.map((c, ci) => (
                            <tr key={`${u.folio}-${ci}`}>
                              <td className="px-3 py-1 font-mono">{ci === 0 ? u.folio : ""}</td>
                              <td className="px-3 py-1">{c.campo}</td>
                              <td className="px-3 py-1 text-muted-foreground">{c.antes}</td>
                              <td className="px-3 py-1 font-medium text-blue-700">{c.despues}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button onClick={commitUpload} className="gap-1.5">
              <CheckCircle2 className="size-4" />
              Aplicar {pending ? pending.toInsert.length + pending.toUpdate.length : 0} cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

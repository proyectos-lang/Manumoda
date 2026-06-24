"use client"

import { useCallback, useRef, useState } from "react"
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"
import { parseExcelFile } from "@/lib/excel-parser"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type Stats = {
  total: number
  inserted: number
  updatedMaquilero: number
  skippedExisting: number
  failed: number
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
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
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
      setProgress(5)
      setStats(null)

      try {
        // 1. Parse ALL rows — no pre-filtering por maquilero
        const allRows = await parseExcelFile(file)
        setProgress(15)

        if (allRows.length === 0) {
          toast.warning("No se encontraron filas válidas con FOLIO en el archivo.")
          setIsProcessing(false)
          setProgress(0)
          return
        }

        const supabase = getSupabase()
        if (!supabase) {
          toast.error("Cliente de Supabase no inicializado.")
          setIsProcessing(false)
          setProgress(0)
          return
        }

        // 2. Fetch folios existentes con su maquilero, cliente y fecha_aprobacion_diseno actual
        const allFolios = Array.from(new Set(allRows.map((r) => r.folio)))
        const existingMap = new Map<string, { id: number | string; maquilero: string | null; cliente: string | null; fecha_aprobacion_diseno: string | null }>()
        const FOLIO_BATCH = 500

        for (let i = 0; i < allFolios.length; i += FOLIO_BATCH) {
          const slice = allFolios.slice(i, i + FOLIO_BATCH)
          const { data, error } = await supabase
            .from("ordenes_produccion")
            .select("id, folio, maquilero, cliente, fecha_aprobacion_diseno")
            .eq("idempresa", IDEMPRESA)
            .in("folio", slice)

          if (error) {
            console.error("[v0] existing folios lookup error:", error)
            toast.error("Error al verificar folios existentes", { description: error.message })
            setIsProcessing(false)
            setProgress(0)
            return
          }

          for (const row of (data ?? []) as {
            id: number | string
            folio: string
            maquilero: string | null
            cliente: string | null
            fecha_aprobacion_diseno: string | null
          }[]) {
            if (row?.folio) {
              existingMap.set(row.folio, {
                id: row.id,
                maquilero: row.maquilero ?? null,
                cliente: row.cliente ?? null,
                fecha_aprobacion_diseno: row.fecha_aprobacion_diseno ?? null,
              })
            }
          }
        }

        // 3. Separar en: nuevos para insertar / existentes para actualizar
        const toInsert = allRows.filter((r) => !existingMap.has(r.folio))

        // Actualiza si: DB no tiene maquilero Y Excel trae uno,
        // O si: cliente del Excel difiere del cliente en DB
        const toUpdateCandidates = allRows.filter((r) => {
          const existing = existingMap.get(r.folio)
          if (!existing) return false
          const dbHasMaq = !!(existing.maquilero?.trim())
          const excelHasMaq = !!r.maquilero_nombre?.trim()
          const clienteDifiere = r.cliente?.trim() && r.cliente.trim() !== (existing.cliente ?? "").trim()
          return (!dbHasMaq && excelHasMaq) || !!clienteDifiere
        })

        // Folios existentes que ya tenían maquilero (no se tocan)
        const skippedExisting = allRows.length - toInsert.length - toUpdateCandidates.length

        if (toInsert.length === 0 && toUpdateCandidates.length === 0) {
          setStats({ total: allRows.length, inserted: 0, updatedMaquilero: 0, skippedExisting, failed: 0 })
          toast.info("No hay cambios que aplicar.", {
            description:
              skippedExisting > 0
                ? `${skippedExisting} folio(s) ya tenían maquilero asignado.`
                : undefined,
          })
          setIsProcessing(false)
          setProgress(0)
          return
        }

        setProgress(30)

        // 4. Resolver catálogo de compradores (maquilero viaja directo como texto)
        const compradoraNames = Array.from(
          new Set(
            toInsert
              .map((r) => r.cliente?.trim())
              .filter((n): n is string => !!n && n.length > 0),
          ),
        )

        const compNameToId = new Map<string, number>()

        const compRes = compradoraNames.length > 0
          ? await supabase.from("compradores").select("id, nombre").eq("idempresa", IDEMPRESA)
          : { data: [], error: null }

        if (compRes.error) {
          console.error("[v0] compradores lookup error:", compRes.error)
          toast.error("Error al consultar el catálogo de Compradores", {
            description: compRes.error.message,
          })
          setIsProcessing(false)
          setProgress(0)
          return
        }

        for (const c of (compRes.data ?? []) as { id: number; nombre: string }[]) {
          if (c?.nombre) compNameToId.set(c.nombre.trim().toLowerCase(), Number(c.id))
        }

        const unmatchedComp = compradoraNames.filter((n) => !compNameToId.has(n.toLowerCase()))
        if (unmatchedComp.length > 0) {
          toast.warning(`${unmatchedComp.length} comprador(es) no encontrado(s) en catálogo`, {
            description:
              unmatchedComp.slice(0, 6).join(", ") + (unmatchedComp.length > 6 ? "..." : ""),
          })
        }

        setProgress(40)

        const BATCH_SIZE = 200
        let inserted = 0
        let updatedMaquilero = 0
        let failed = 0

        // 5a. INSERT filas nuevas
        for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
          const batch = toInsert.slice(i, i + BATCH_SIZE).map((r) => {
            const { maquilero_nombre, ...rest } = r
            const maquilero = maquilero_nombre?.trim() || null
            const idcompradora =
              rest.cliente && compNameToId.has(rest.cliente.trim().toLowerCase())
                ? compNameToId.get(rest.cliente.trim().toLowerCase())!
                : null

            // fase_actual: S1 si el Excel trae maquilero con texto, Por Programar si no
            const fase_actual = maquilero ? "S1" : "Por Programar"

            return { ...rest, idempresa: IDEMPRESA, fase_actual, maquilero, idcompradora }
          })

          const { error } = await supabase.from("ordenes_produccion").insert(batch)
          if (error) {
            console.error("[v0] Insert error:", error)
            failed += batch.length
          } else {
            inserted += batch.length
          }

          const pct = 40 + Math.round(((i + batch.length) / Math.max(toInsert.length, 1)) * 30)
          setProgress(Math.min(pct, 70))
        }

        // 5b. UPDATE campos faltantes en filas existentes (maquilero y/o fecha_aprobacion_diseno)
        for (let i = 0; i < toUpdateCandidates.length; i++) {
          const r = toUpdateCandidates[i]
          const existing = existingMap.get(r.folio)
          if (!existing) continue

          const updatePayload: Record<string, unknown> = {}

          if (!existing.maquilero?.trim() && r.maquilero_nombre?.trim()) {
            updatePayload.maquilero = r.maquilero_nombre
            updatePayload.fase_actual = "S1"
          }
          if (r.cliente?.trim() && r.cliente.trim() !== (existing.cliente ?? "").trim()) {
            updatePayload.cliente = r.cliente.trim()
          }

          if (Object.keys(updatePayload).length === 0) continue

          const { error } = await supabase
            .from("ordenes_produccion")
            .update(updatePayload)
            .eq("id", existing.id)
            .eq("idempresa", IDEMPRESA)

          if (error) {
            console.error("[v0] Update maquilero error:", error)
            failed++
          } else {
            updatedMaquilero++
          }

          if ((i + 1) % 20 === 0 || i === toUpdateCandidates.length - 1) {
            const pct = 70 + Math.round(((i + 1) / toUpdateCandidates.length) * 25)
            setProgress(Math.min(pct, 95))
          }
        }

        setProgress(100)
        setStats({ total: allRows.length, inserted, updatedMaquilero, skippedExisting, failed })

        const descParts: string[] = []
        if (skippedExisting > 0) descParts.push(`${skippedExisting} ya tenían maquilero`)
        const description = descParts.length > 0 ? descParts.join(", ") : undefined

        if (failed === 0) {
          toast.success(
            `${inserted} nuevas${updatedMaquilero > 0 ? `, ${updatedMaquilero} maquileros asignados` : ""}.`,
            { description },
          )
        } else if (inserted + updatedMaquilero === 0) {
          toast.error(`Falló la carga de ${failed} filas.`, { description })
        } else {
          toast.warning(
            `${inserted} nuevas, ${updatedMaquilero} actualizadas, ${failed} con error.`,
            { description },
          )
        }

        onUploaded()
      } catch (err) {
        console.error("[v0] Parse error:", err)
        toast.error("Error al procesar el archivo.")
      } finally {
        setTimeout(() => {
          setIsProcessing(false)
          setProgress(0)
        }, 600)
      }
    },
    [configMissing, onUploaded],
  )

  return (
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
        handleFiles(e.dataTransfer.files)
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
        onChange={(e) => handleFiles(e.target.files)}
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
          Formatos soportados: .xlsx, .xls, .csv
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
          {stats.updatedMaquilero > 0 && (
            <span className="text-blue-600">
              {stats.updatedMaquilero} registro(s) actualizado(s)
            </span>
          )}
          {stats.skippedExisting > 0 && (
            <span className="text-muted-foreground">
              {stats.skippedExisting} sin cambios
            </span>
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
  )
}

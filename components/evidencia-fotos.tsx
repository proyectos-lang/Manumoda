"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Loader2, X, ZoomIn } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

type Foto = {
  id?: number
  url_foto: string
}

type Props = {
  folio: string
  etapa: string
  onFotoAdded?: () => void
  readOnly?: boolean
}

export function EvidenciaFotos({ folio, etapa, onFotoAdded, readOnly }: Props) {
  const [fotos, setFotos] = useState<Foto[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchFotos = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase
      .from("ordenes_fotos")
      .select("id, url_foto")
      .eq("idempresa", IDEMPRESA)
      .eq("folio", folio)
      .eq("etapa", etapa)
      .order("id", { ascending: true })

    if (error) {
      toast.error("No se pudieron cargar las fotos")
    } else {
      setFotos((data as Foto[]) ?? [])
    }
    setLoading(false)
  }, [folio, etapa])

  useEffect(() => {
    fetchFotos()
  }, [fetchFotos])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const supabase = getSupabase()
    if (!supabase) return

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const path = `fotos/${IDEMPRESA}/${folio}/${etapa}_${Date.now()}.${ext}`

    setUploading(true)
    try {
      const { error: uploadError } = await supabase.storage
        .from("documentosmanumoda")
        .upload(path, file, { contentType: file.type, upsert: false })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from("documentosmanumoda")
        .getPublicUrl(path)

      const url_foto = urlData.publicUrl

      const { error: insertError } = await supabase
        .from("ordenes_fotos")
        .insert({ idempresa: IDEMPRESA, folio, etapa, url_foto })

      if (insertError) throw insertError

      setFotos((prev) => [...prev, { url_foto }])
      onFotoAdded?.()
      toast.success("Foto adjuntada correctamente")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al subir la foto"
      toast.error(msg)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-3">
      {/* Upload trigger — oculto en modo lectura */}
      {!readOnly && (
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Camera className="size-4" />
            )}
            {uploading ? "Subiendo…" : "Adjuntar foto"}
          </Button>
          {fotos.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {fotos.length} foto{fotos.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
      {readOnly && fotos.length > 0 && (
        <p className="text-xs text-muted-foreground">{fotos.length} foto{fotos.length !== 1 ? "s" : ""}</p>
      )}

      {/* Thumbnail gallery */}
      {loading ? (
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="size-16 rounded-md" />
          ))}
        </div>
      ) : fotos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {fotos.map((foto, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setPreview(foto.url_foto)}
              className="group relative size-16 overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={foto.url_foto}
                alt={`Foto ${idx + 1} — ${etapa}`}
                className="size-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <ZoomIn className="size-4 text-white" />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sin fotos adjuntas para esta etapa.</p>
      )}

      {/* Fullscreen preview dialog */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="px-2 pt-2">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-sm font-medium">
                Evidencia — {folio} / {etapa}
              </DialogTitle>
              <button
                onClick={() => setPreview(null)}
                className="rounded-sm text-muted-foreground opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="size-4" />
                <span className="sr-only">Cerrar</span>
              </button>
            </div>
          </DialogHeader>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Vista ampliada"
              className="w-full rounded-md object-contain"
              style={{ maxHeight: "75vh" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

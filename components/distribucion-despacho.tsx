"use client"

import { useEffect, useState } from "react"
import { FileText, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"

/**
 * El empaque de un folio, de solo lectura: lo que se capturó en la
 * etapa 11 (Programar despacho a cliente).
 *
 * Se abre desde el calendario al hacer clic en un movimiento, para que
 * almacén vea qué va a salir —cuántas cajas o bultos y cuántas piezas en
 * cada uno— sin ir al Panel General. Se carga al abrirse: el calendario
 * trae cientos de folios y pedir el empaque de todos de entrada sería
 * pagar por datos que casi nunca se miran.
 */

type Cabecera = {
  cedi_destino: string | null
  total_piezas: number | null
  distribucion: number[] | null
  pdf_path: string | null
  pdf_nombre: string | null
  notas: string | null
}

type Empaque = { numero: number; tipo: string; piezas: number }

export function DistribucionDespacho({
  folio,
  onCerrar,
}: {
  folio: string
  onCerrar: () => void
}) {
  const [cargando, setCargando] = useState(true)
  const [cab, setCab] = useState<Cabecera | null>(null)
  const [empaques, setEmpaques] = useState<Empaque[]>([])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    let vivo = true
    ;(async () => {
      setCargando(true)
      const [c, e] = await Promise.all([
        supabase
          .from("despachos")
          .select("cedi_destino, total_piezas, distribucion, pdf_path, pdf_nombre, notas")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .maybeSingle(),
        supabase
          .from("despacho_empaques")
          .select("numero, tipo, piezas")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .order("numero"),
      ])
      if (!vivo) return
      if (c.error || e.error) {
        toast.error("No se pudo cargar el empaque", {
          description: (c.error ?? e.error)?.message,
        })
      }
      setCab((c.data as Cabecera) ?? null)
      setEmpaques((e.data as Empaque[]) ?? [])
      setCargando(false)
    })()
    return () => {
      vivo = false
    }
  }, [folio])

  async function verPdf() {
    const supabase = getSupabase()
    if (!supabase || !cab?.pdf_path) return
    // El bucket es privado: enlace firmado que caduca en 10 minutos.
    const { data, error } = await supabase.storage.from("despachos").createSignedUrl(cab.pdf_path, 600)
    if (error || !data) {
      toast.error("No se pudo abrir el PDF", { description: error?.message })
      return
    }
    window.open(data.signedUrl, "_blank", "noopener")
  }

  const total = empaques.reduce((s, x) => s + Number(x.piezas || 0), 0)
  const tipo = empaques[0]?.tipo ?? "Caja"
  const unidad = (n: number) =>
    tipo === "Bulto" ? (n === 1 ? "bulto" : "bultos") : n === 1 ? "caja" : "cajas"

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Empaque del folio {folio}</p>
        <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onCerrar}>
          <X className="size-3.5" />
        </Button>
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Cargando…
        </p>
      ) : empaques.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Este folio todavía no tiene empaque capturado. Se registra en la etapa
          11, Programar despacho a cliente, del Panel General.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              <span className="text-muted-foreground">Empaque: </span>
              <span className="font-medium">
                {empaques.length} {unidad(empaques.length)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Total: </span>
              <span className="font-medium tabular-nums">{total.toLocaleString("es-MX")} piezas</span>
            </span>
            {cab?.distribucion && cab.distribucion.length > 0 && (
              <span>
                <span className="text-muted-foreground">Distribución: </span>
                <span className="font-mono">{cab.distribucion.join(", ")}</span>
              </span>
            )}
            <span>
              <span className="text-muted-foreground">CEDI: </span>
              <span className="font-medium">{cab?.cedi_destino ?? "—"}</span>
            </span>
          </div>

          {/* Una ficha por empaque: es lo que se rotula y se carga. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1.5">
            {empaques.map((x) => (
              <div
                key={x.numero}
                className="rounded border border-violet-200 bg-background px-2 py-1 text-center"
              >
                <p className="text-[10px] text-muted-foreground">
                  {x.tipo} {x.numero}
                </p>
                <p className="text-sm font-semibold tabular-nums">
                  {Number(x.piezas).toLocaleString("es-MX")}
                </p>
              </div>
            ))}
          </div>

          {(cab?.notas || cab?.pdf_path) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {cab?.notas && <span className="text-muted-foreground">{cab.notas}</span>}
              {cab?.pdf_path && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={verPdf}>
                  <FileText className="size-3" /> {cab.pdf_nombre ?? "Ver PDF"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

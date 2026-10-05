"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FileText, Loader2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"

/**
 * Programar el despacho a cliente (etapa 11): día, hora y empaque.
 *
 * LA DISTRIBUCIÓN ES UNA PROPORCIÓN, NO UN DETALLE:
 *   Se captura el total a despachar y una distribución como "1, 2, 1,
 *   2". Cada número es una caja, y el total se reparte en esa
 *   proporción: 600 piezas con 1,2,1,2 → 100, 200, 100, 200. Antes se
 *   pedía color y piezas por talla en cada caja; operación lo
 *   simplificó (05-oct-2026).
 *
 * EL REPARTO SIEMPRE SUMA EL TOTAL:
 *   600 entre 1,1,1,1,1,1,1 no da enteros. Se usa el método del mayor
 *   residuo: cada caja recibe su parte redondeada hacia abajo y las
 *   piezas que sobran van, de una en una, a las cajas con mayor
 *   fracción pendiente. Así ninguna caja queda con piezas a medias y la
 *   suma es exactamente el total. La base lo vuelve a comprobar.
 *
 * TODO SE GUARDA JUNTO:
 *   Una sola llamada a `fn_guardar_despacho` (scripts 080 y 083), que
 *   escribe en una transacción.
 */

const BUCKET = "despachos"
/** El límite del bucket: más grande, Storage lo rechaza con un error poco claro. */
const MAX_PDF = 10 * 1024 * 1024

type Tipo = "Caja" | "Bulto"

/** "1, 2, 1,2" → [1, 2, 1, 2]. Ignora lo que no sea un entero positivo. */
function leerDistribucion(texto: string): number[] {
  return texto
    .split(/[\s,;-]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0)
}

/**
 * Reparte `total` según `pesos` con el método del mayor residuo: la
 * suma del resultado es exactamente `total`.
 */
export function repartir(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0)
  if (total <= 0 || suma <= 0) return pesos.map(() => 0)
  const exactos = pesos.map((p) => (total * p) / suma)
  const base = exactos.map(Math.floor)
  let sobran = total - base.reduce((a, b) => a + b, 0)
  // A igual residuo, gana la caja de menor número: el reparto es estable.
  const orden = exactos
    .map((x, i) => ({ i, residuo: x - Math.floor(x) }))
    .sort((a, b) => b.residuo - a.residuo || a.i - b.i)
  for (const { i } of orden) {
    if (sobran <= 0) break
    base[i]++
    sobran--
  }
  return base
}

export function DespachoEditor({
  folio,
  fecha,
  hora,
  readOnly,
  onGuardado,
  onCancelar,
}: {
  folio: string
  fecha: string | null
  hora: string | null
  readOnly: boolean
  onGuardado: () => void
  onCancelar: () => void
}) {
  const { user } = useAuth()
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const [dia, setDia] = useState(fecha ?? "")
  // La base devuelve "HH:MM:SS"; el input type=time quiere "HH:MM".
  const [hr, setHr] = useState(hora ? hora.slice(0, 5) : "")
  const [cedi, setCedi] = useState("")
  const [notas, setNotas] = useState("")

  const [total, setTotal] = useState("")
  const [distTexto, setDistTexto] = useState("")
  /** El tipo de cada caja, por posición. Se conserva al editar la distribución. */
  const [tipos, setTipos] = useState<Tipo[]>([])
  /** Para el atajo "repartir parejo en N cajas". */
  const [parejo, setParejo] = useState("")

  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [pdfNombre, setPdfNombre] = useState<string | null>(null)
  /** El archivo elegido y aún no subido: se sube al guardar. */
  const [pdfNuevo, setPdfNuevo] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [piezasRef, setPiezasRef] = useState<{ cortadas: number | null; pedidas: number | null }>({
    cortadas: null,
    pedidas: null,
  })
  /** Los CEDI ya usados, como sugerencia: el mismo cliente repite destino. */
  const [cedisPrevios, setCedisPrevios] = useState<string[]>([])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    let vivo = true
    ;(async () => {
      setCargando(true)
      const [cab, emp, ord, ced] = await Promise.all([
        supabase
          .from("despachos")
          .select("cedi_destino, pdf_path, pdf_nombre, notas, total_piezas, distribucion")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .maybeSingle(),
        supabase
          .from("despacho_empaques")
          .select("numero, tipo, piezas")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .order("numero"),
        supabase
          .from("ordenes_produccion")
          .select("piezas, piezas_cortadas")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .maybeSingle(),
        supabase
          .from("despachos")
          .select("cedi_destino")
          .eq("idempresa", IDEMPRESA)
          .not("cedi_destino", "is", null),
      ])
      if (!vivo) return

      const err = cab.error ?? emp.error
      if (err) {
        // El caso típico: el script 083 aún no se corrió.
        toast.error("No se pudo cargar el despacho", { description: err.message })
      }

      const cortadas = ord.data?.piezas_cortadas ?? null
      const pedidas = ord.data?.piezas ?? null
      setPiezasRef({ cortadas, pedidas })

      const empaques = (emp.data ?? []) as { tipo: string; piezas: number }[]
      const dist = (cab.data?.distribucion ?? []) as number[]

      if (cab.data) {
        setCedi(cab.data.cedi_destino ?? "")
        setNotas(cab.data.notas ?? "")
        setPdfPath(cab.data.pdf_path)
        setPdfNombre(cab.data.pdf_nombre)
      }

      if (dist.length > 0) {
        setDistTexto(dist.join(", "))
        setTotal(String(cab.data?.total_piezas ?? ""))
      } else if (empaques.length > 0) {
        // Un despacho guardado con el detalle anterior (script 080): la
        // distribución son sus piezas, que reproducen el mismo reparto.
        setDistTexto(empaques.map((e) => e.piezas).join(", "))
        setTotal(String(empaques.reduce((s, e) => s + Number(e.piezas || 0), 0)))
      } else {
        // Nuevo: se propone despachar lo cortado, o lo pedido.
        setTotal(String(cortadas ?? pedidas ?? ""))
      }
      setTipos(empaques.map((e) => (e.tipo === "Bulto" ? "Bulto" : "Caja")))

      setCedisPrevios(
        [...new Set(((ced.data ?? []) as { cedi_destino: string }[]).map((c) => c.cedi_destino))].sort(),
      )
      setCargando(false)
    })()
    return () => {
      vivo = false
    }
  }, [folio])

  // ── El reparto, derivado ──
  const pesos = useMemo(() => leerDistribucion(distTexto), [distTexto])
  const totalNum = Math.max(0, Math.floor(Number(total) || 0))
  const piezasPorCaja = useMemo(() => repartir(totalNum, pesos), [totalNum, pesos])
  /** El tipo de la caja i; las nuevas nacen como caja. */
  const tipoDe = (i: number): Tipo => tipos[i] ?? "Caja"
  const cajas = pesos.filter((_, i) => tipoDe(i) === "Caja").length
  const bultos = pesos.length - cajas

  const referencia = piezasRef.cortadas ?? piezasRef.pedidas
  const descuadre = referencia != null && totalNum > 0 ? totalNum - referencia : null

  function cambiarTipo(i: number, t: Tipo) {
    setTipos((prev) => {
      const out = [...prev]
      for (let k = out.length; k < i; k++) out[k] = "Caja"
      out[i] = t
      return out
    })
  }

  function repartirParejo() {
    const n = Math.max(1, Math.min(500, Math.floor(Number(parejo) || 0)))
    if (!Number(parejo)) return
    setDistTexto(Array.from({ length: n }, () => "1").join(", "))
  }

  function elegirPdf(f: File | undefined) {
    if (!f) return
    if (f.type !== "application/pdf") {
      toast.error("Solo se aceptan archivos PDF")
      return
    }
    if (f.size > MAX_PDF) {
      toast.error("El PDF pasa de 10 MB", { description: "Comprímelo o divídelo." })
      return
    }
    setPdfNuevo(f)
  }

  async function verPdf() {
    const supabase = getSupabase()
    if (!supabase || !pdfPath) return
    // Enlace firmado: el bucket es privado y el respaldo lleva datos del
    // cliente. Caduca en 10 minutos.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfPath, 600)
    if (error || !data) {
      toast.error("No se pudo abrir el PDF", { description: error?.message })
      return
    }
    window.open(data.signedUrl, "_blank", "noopener")
  }

  async function guardar() {
    const supabase = getSupabase()
    if (!supabase) return
    if (!dia) {
      toast.error("Falta el día del despacho")
      return
    }
    if (pesos.length > 0 && totalNum <= 0) {
      toast.error("Falta el total de piezas a repartir")
      return
    }
    setGuardando(true)

    // 1. El PDF primero: si falla la subida, no se guarda un despacho
    //    que diga tener respaldo y no lo tenga.
    let ruta = pdfPath
    let nombre = pdfNombre
    if (pdfNuevo) {
      // Storage rechaza acentos y espacios raros con un error que no
      // dice cuál carácter fue: el nombre se limpia.
      const limpio = pdfNuevo.name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
      const destino = `${folio}/${Date.now()}-${limpio}`
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(destino, pdfNuevo, { contentType: "application/pdf", upsert: false })
      if (error) {
        setGuardando(false)
        toast.error("No se pudo subir el PDF", { description: error.message })
        return
      }
      if (pdfPath) await supabase.storage.from(BUCKET).remove([pdfPath])
      ruta = destino
      nombre = pdfNuevo.name
    }

    // 2. Todo lo demás, en una sola transacción.
    const { data, error } = await supabase.rpc("fn_guardar_despacho", {
      p_idempresa: IDEMPRESA,
      p_folio: folio,
      p_fecha: dia,
      p_hora: hr || null,
      p_cedi: cedi,
      p_tallas: [],
      p_empaques: pesos.map((_, i) => ({ tipo: tipoDe(i), piezas: piezasPorCaja[i] })),
      p_pdf_path: ruta,
      p_pdf_nombre: nombre,
      p_notas: notas,
      p_usuario: user?.nombre ?? null,
      p_total: pesos.length > 0 ? totalNum : null,
      p_distribucion: pesos,
    })
    setGuardando(false)
    if (error) {
      toast.error("No se pudo guardar el despacho", { description: error.message })
      return
    }
    toast.success("Despacho guardado", {
      description: `${cajas} caja(s), ${bultos} bulto(s), ${Number(data ?? 0).toLocaleString("es-MX")} piezas`,
    })
    onGuardado()
  }

  async function quitarProgramacion() {
    const supabase = getSupabase()
    if (!supabase) return
    // Solo des-programa el día: el empaque capturado se conserva por si
    // se reprograma.
    setGuardando(true)
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ fecha_despacho_cliente: null, hora_despacho_cliente: null })
      .eq("idempresa", IDEMPRESA)
      .eq("folio", folio)
    setGuardando(false)
    if (error) {
      toast.error("No se pudo quitar el despacho", { description: error.message })
      return
    }
    toast.success("Despacho sin programar", { description: "El empaque capturado se conserva." })
    onGuardado()
  }

  if (cargando) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Cargando despacho…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Cuándo y a dónde ── */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Día</label>
          <Input
            type="date"
            value={dia}
            disabled={readOnly}
            onChange={(ev) => {
              setDia(ev.target.value)
              if (!ev.target.value) setHr("")
            }}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Hora</label>
          <Input
            type="time"
            value={hr}
            disabled={readOnly || !dia}
            onChange={(ev) => setHr(ev.target.value)}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">CEDI de destino</label>
          <Input
            list="cedis-previos"
            value={cedi}
            disabled={readOnly}
            onChange={(ev) => setCedi(ev.target.value)}
            placeholder="Ubicación del CEDI"
            className="mt-1 h-8 text-sm"
          />
          <datalist id="cedis-previos">
            {cedisPrevios.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      {/* ── Total y distribución ── */}
      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Total de piezas</label>
          <Input
            type="number"
            min="0"
            value={total}
            disabled={readOnly}
            onChange={(ev) => setTotal(ev.target.value)}
            className="sin-flechas mt-1 h-8 text-right text-sm tabular-nums"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">
            Distribución por caja
          </label>
          <Input
            value={distTexto}
            disabled={readOnly}
            onChange={(ev) => setDistTexto(ev.target.value)}
            placeholder="1, 2, 1, 2"
            className="mt-1 h-8 font-mono text-sm"
          />
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">
        Cada número es una caja y el total se reparte en esa proporción: 600
        piezas con 1, 2, 1, 2 dan 100, 200, 100 y 200.
      </p>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">O repartir parejo en</span>
          <Input
            type="number"
            min="1"
            value={parejo}
            onChange={(ev) => setParejo(ev.target.value)}
            className="sin-flechas h-7 w-16 text-center text-xs"
          />
          <span className="text-[11px] text-muted-foreground">cajas</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={repartirParejo}>
            Aplicar
          </Button>
        </div>
      )}

      {/* ── El reparto ── */}
      {pesos.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-1 py-1.5 font-medium">Tipo</th>
                <th className="px-2 py-1.5 text-right font-medium">Proporción</th>
                <th className="px-2 py-1.5 text-right font-medium">Piezas</th>
              </tr>
            </thead>
            <tbody>
              {pesos.map((p, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1 text-xs font-semibold tabular-nums">{i + 1}</td>
                  <td className="px-1 py-1">
                    <select
                      value={tipoDe(i)}
                      disabled={readOnly}
                      onChange={(ev) => cambiarTipo(i, ev.target.value as Tipo)}
                      className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                    >
                      <option>Caja</option>
                      <option>Bulto</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">{p}</td>
                  <td className="px-2 py-1 text-right text-sm font-semibold tabular-nums">
                    {piezasPorCaja[i].toLocaleString("es-MX")}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/50">
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-xs font-semibold">
                  {cajas} caja{cajas === 1 ? "" : "s"} · {bultos} bulto{bultos === 1 ? "" : "s"}
                </td>
                <td className="px-2 py-1.5 text-right text-xs font-bold tabular-nums">
                  {piezasPorCaja.reduce((a, b) => a + b, 0).toLocaleString("es-MX")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/*
        El cuadre contra lo cortado. Avisa, no bloquea: un despacho
        parcial es normal, y quien captura lo sabe.
      */}
      {descuadre != null && descuadre !== 0 && (
        <p className={cn("text-xs", descuadre > 0 ? "text-sky-700" : "text-amber-700")}>
          El total a despachar es {totalNum.toLocaleString("es-MX")} piezas;{" "}
          {piezasRef.cortadas != null ? "se cortaron" : "se pidieron"} {referencia!.toLocaleString("es-MX")} (
          {descuadre > 0 ? `${descuadre} de más` : `faltan ${-descuadre}`}). Se puede guardar igual.
        </p>
      )}

      {/* ── PDF y notas ── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Respaldo de entrega (PDF)</label>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {pdfNuevo ? (
              <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs">
                <FileText className="size-3" /> {pdfNuevo.name}
                <span className="text-muted-foreground">(se sube al guardar)</span>
                <button type="button" onClick={() => setPdfNuevo(null)}>
                  <X className="size-3" />
                </button>
              </span>
            ) : pdfPath ? (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={verPdf}>
                <FileText className="size-3" /> {pdfNombre ?? "Ver PDF"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Sin archivo</span>
            )}
            {!readOnly && (
              <>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-3" /> {pdfPath || pdfNuevo ? "Reemplazar" : "Adjuntar PDF"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(ev) => {
                    elegirPdf(ev.target.files?.[0])
                    ev.target.value = ""
                  }}
                />
              </>
            )}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Notas</label>
          <Input
            value={notas}
            disabled={readOnly}
            onChange={(ev) => setNotas(ev.target.value)}
            placeholder="Opcional"
            className="mt-1 h-8 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={readOnly || guardando || !dia} onClick={guardar}>
          {guardando && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Guardar despacho
        </Button>
        {fecha && (
          <Button size="sm" variant="ghost" disabled={readOnly || guardando} onClick={quitarProgramacion}>
            Quitar programación
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

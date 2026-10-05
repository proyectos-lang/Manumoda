"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Copy, FileText, Loader2, Plus, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"
import { ESCALAS_TALLA } from "@/lib/types"

/**
 * Programar el despacho a cliente (etapa 11): día, hora y empaque.
 *
 * QUÉ SE CAPTURA:
 *   Día y hora, el CEDI de destino, cada caja o bulto con su color y
 *   piezas por talla, y un PDF de respaldo de la entrega.
 *
 * LOS TOTALES NO SE TECLEAN:
 *   Cuántas cajas, cuántos bultos y cuántas piezas salen del detalle.
 *   Capturarlos aparte invitaría a que no cuadren con lo que de verdad
 *   va en cada empaque.
 *
 * LAS TALLAS:
 *   Se proponen las de la ficha cuando el folio tiene reparto; si no,
 *   se elige una escala o se escriben. Sin tallas, cada empaque lleva
 *   solo su total de piezas: hay despachos que no se detallan.
 *
 * TODO SE GUARDA JUNTO:
 *   Una sola llamada a `fn_guardar_despacho` (script 080), que escribe
 *   en una transacción. Desde aquí serían varias, y un corte a media
 *   operación dejaría las cajas borradas y sin reemplazo.
 */

const BUCKET = "despachos"
/** El límite del bucket: más grande, Storage lo rechaza con un error poco claro. */
const MAX_PDF = 10 * 1024 * 1024

type Empaque = {
  /** Clave solo de pantalla, para que React no confunda filas al borrar. */
  k: string
  tipo: "Caja" | "Bulto"
  color: string
  cantidades: Record<string, number>
  /** Solo manda cuando no hay tallas; si las hay, es la suma. */
  piezas: number
}

let contador = 0
const nuevaClave = () => `e${Date.now()}-${contador++}`

function totalDe(e: Empaque, tallas: string[]): number {
  if (tallas.length === 0) return Number(e.piezas || 0)
  return tallas.reduce((s, t) => s + Number(e.cantidades[t] || 0), 0)
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
  const [tallas, setTallas] = useState<string[]>([])
  const [nuevaTalla, setNuevaTalla] = useState("")
  const [empaques, setEmpaques] = useState<Empaque[]>([])

  /** Cuántos empaques agregar de golpe, y de qué tipo. */
  const [lote, setLote] = useState("1")
  const [loteTipo, setLoteTipo] = useState<"Caja" | "Bulto">("Caja")

  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [pdfNombre, setPdfNombre] = useState<string | null>(null)
  /** El archivo elegido y aún no subido: se sube al guardar. */
  const [pdfNuevo, setPdfNuevo] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** Referencias para comparar: lo cortado y lo pedido. */
  const [piezasRef, setPiezasRef] = useState<{ cortadas: number | null; pedidas: number | null }>({
    cortadas: null,
    pedidas: null,
  })
  /** Tallas de la ficha, si el folio tiene reparto. */
  const [tallasFicha, setTallasFicha] = useState<string[]>([])
  /** Los CEDI ya usados, como sugerencia: el mismo cliente repite destino. */
  const [cedisPrevios, setCedisPrevios] = useState<string[]>([])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    let vivo = true
    ;(async () => {
      setCargando(true)
      const [cab, emp, ord, ft, ced] = await Promise.all([
        supabase
          .from("despachos")
          .select("cedi_destino, tallas, pdf_path, pdf_nombre, notas")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio)
          .maybeSingle(),
        supabase
          .from("despacho_empaques")
          .select("numero, tipo, color, cantidades, piezas")
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
          .from("ficha_tallas")
          .select("bloque, cantidades")
          .eq("idempresa", IDEMPRESA)
          .eq("folio", folio),
        supabase
          .from("despachos")
          .select("cedi_destino")
          .eq("idempresa", IDEMPRESA)
          .not("cedi_destino", "is", null),
      ])
      if (!vivo) return

      const err = cab.error ?? emp.error
      if (err) {
        // El caso típico: el script 080 aún no se corrió.
        toast.error("No se pudo cargar el detalle de empaque", {
          description: err.message,
        })
      }

      // Las tallas de la ficha: primero lo cortado, que es lo que se
      // despacha; si no hay, lo planeado.
      const filas = (ft.data ?? []) as { bloque: string; cantidades: Record<string, number> }[]
      const delBloque = (b: string) => [
        ...new Set(filas.filter((f) => f.bloque === b).flatMap((f) => Object.keys(f.cantidades ?? {}))),
      ]
      const deFicha = delBloque("Cortadas").length ? delBloque("Cortadas") : delBloque("Especificacion")
      setTallasFicha(deFicha)

      if (cab.data) {
        setCedi(cab.data.cedi_destino ?? "")
        setNotas(cab.data.notas ?? "")
        setTallas(cab.data.tallas ?? [])
        setPdfPath(cab.data.pdf_path)
        setPdfNombre(cab.data.pdf_nombre)
      } else {
        // Despacho nuevo: se proponen las tallas de la ficha.
        setTallas(deFicha)
      }
      setEmpaques(
        ((emp.data ?? []) as Omit<Empaque, "k">[]).map((e) => ({
          k: nuevaClave(),
          tipo: e.tipo === "Bulto" ? "Bulto" : "Caja",
          color: e.color ?? "",
          cantidades: (e.cantidades ?? {}) as Record<string, number>,
          piezas: Number(e.piezas ?? 0),
        })),
      )
      setPiezasRef({
        cortadas: ord.data?.piezas_cortadas ?? null,
        pedidas: ord.data?.piezas ?? null,
      })
      setCedisPrevios([
        ...new Set(((ced.data ?? []) as { cedi_destino: string }[]).map((c) => c.cedi_destino)),
      ].sort())
      setCargando(false)
    })()
    return () => {
      vivo = false
    }
  }, [folio])

  // ── Totales, derivados del detalle ──
  const resumen = useMemo(() => {
    const cajas = empaques.filter((e) => e.tipo === "Caja").length
    const bultos = empaques.filter((e) => e.tipo === "Bulto").length
    const piezas = empaques.reduce((s, e) => s + totalDe(e, tallas), 0)
    const porTalla: Record<string, number> = {}
    for (const t of tallas) {
      porTalla[t] = empaques.reduce((s, e) => s + Number(e.cantidades[t] || 0), 0)
    }
    return { cajas, bultos, piezas, porTalla }
  }, [empaques, tallas])

  /** Contra qué se compara: lo cortado si existe, si no lo pedido. */
  const referencia = piezasRef.cortadas ?? piezasRef.pedidas

  // ── Edición ──
  function cambiar(k: string, cambios: Partial<Empaque>) {
    setEmpaques((prev) => prev.map((e) => (e.k === k ? { ...e, ...cambios } : e)))
  }

  function agregarLote() {
    const n = Math.max(1, Math.min(200, Math.floor(Number(lote) || 1)))
    // Las nuevas copian color y distribución de la última: lo normal
    // es empacar varias cajas iguales y ajustar la de cierre.
    const ultima = empaques[empaques.length - 1]
    setEmpaques((prev) => [
      ...prev,
      ...Array.from({ length: n }, () => ({
        k: nuevaClave(),
        tipo: loteTipo,
        color: ultima?.color ?? "",
        cantidades: { ...(ultima?.cantidades ?? {}) },
        piezas: ultima?.piezas ?? 0,
      })),
    ])
  }

  function duplicar(e: Empaque) {
    setEmpaques((prev) => {
      const i = prev.findIndex((x) => x.k === e.k)
      const copia = { ...e, k: nuevaClave(), cantidades: { ...e.cantidades } }
      return [...prev.slice(0, i + 1), copia, ...prev.slice(i + 1)]
    })
  }

  function agregarTalla(t: string) {
    const v = t.trim().toUpperCase()
    if (!v || tallas.includes(v)) return
    setTallas((prev) => [...prev, v])
    setNuevaTalla("")
  }

  function quitarTalla(t: string) {
    // Quitar la columna borra lo capturado en ella: se avisa con el total.
    const enUso = resumen.porTalla[t] ?? 0
    if (enUso > 0 && !confirm(`La talla ${t} tiene ${enUso} piezas capturadas. ¿Quitarla?`)) return
    setTallas((prev) => prev.filter((x) => x !== t))
    setEmpaques((prev) =>
      prev.map((e) => {
        const { [t]: _, ...resto } = e.cantidades
        return { ...e, cantidades: resto }
      }),
    )
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
    setGuardando(true)

    // 1. El PDF primero: si falla la subida, no se guarda un despacho
    //    que diga tener respaldo y no lo tenga.
    let ruta = pdfPath
    let nombre = pdfNombre
    if (pdfNuevo) {
      // El nombre del archivo se limpia: Storage rechaza acentos y
      // espacios raros con un error que no dice cuál carácter fue.
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
      // El anterior se borra para no dejar archivos huérfanos. Si falla
      // no importa: el despacho ya apunta al nuevo.
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
      p_tallas: tallas,
      p_empaques: empaques.map((e) => ({
        tipo: e.tipo,
        color: e.color,
        // Solo las tallas vigentes y con piezas: una columna quitada no
        // debe dejar cantidades fantasma en el jsonb.
        cantidades: Object.fromEntries(
          tallas
            .filter((t) => Number(e.cantidades[t] || 0) > 0)
            .map((t) => [t, Number(e.cantidades[t])]),
        ),
        piezas: totalDe(e, tallas),
      })),
      p_pdf_path: ruta,
      p_pdf_nombre: nombre,
      p_notas: notas,
      p_usuario: user?.nombre ?? null,
    })
    setGuardando(false)
    if (error) {
      toast.error("No se pudo guardar el despacho", { description: error.message })
      return
    }
    toast.success("Despacho guardado", {
      description: `${resumen.cajas} caja(s), ${resumen.bultos} bulto(s), ${Number(data ?? 0).toLocaleString("es-MX")} piezas`,
    })
    onGuardado()
  }

  async function quitarProgramacion() {
    const supabase = getSupabase()
    if (!supabase) return
    // Quitar solo des-programa el día: el empaque capturado se conserva
    // por si se reprograma.
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

  const descuadre = referencia != null && resumen.piezas > 0 ? resumen.piezas - referencia : null

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

      {/* ── Tallas de la distribución ── */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Tallas:</span>
          {tallas.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs"
            >
              {t}
              {!readOnly && (
                <button type="button" onClick={() => quitarTalla(t)} title={`Quitar ${t}`}>
                  <X className="size-3 text-muted-foreground" />
                </button>
              )}
            </span>
          ))}
          {!readOnly && (
            <Input
              value={nuevaTalla}
              onChange={(ev) => setNuevaTalla(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault()
                  agregarTalla(nuevaTalla)
                }
              }}
              placeholder="+ talla"
              className="h-6 w-20 text-xs"
            />
          )}
        </div>
        {!readOnly && tallas.length === 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Usar escala:</span>
            {tallasFicha.length > 0 && (
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setTallas(tallasFicha)}>
                De la ficha ({tallasFicha.join(" ")})
              </Button>
            )}
            {ESCALAS_TALLA.map((e) => (
              <Button
                key={e.nombre}
                size="sm"
                variant="outline"
                className="h-6 text-[11px]"
                onClick={() => setTallas(e.tallas)}
              >
                {e.nombre}
              </Button>
            ))}
            <span className="text-[11px] text-muted-foreground">
              · sin tallas, cada empaque lleva solo su total
            </span>
          </div>
        )}
      </div>

      {/* ── Los empaques ── */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-1 py-1.5 font-medium">Tipo</th>
              <th className="px-1 py-1.5 font-medium">Color</th>
              {tallas.map((t) => (
                <th key={t} className="px-1 py-1.5 text-center font-medium">
                  {t}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">Piezas</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {empaques.length === 0 && (
              <tr>
                <td colSpan={5 + tallas.length} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sin empaques. Agrega las cajas o bultos abajo.
                </td>
              </tr>
            )}
            {empaques.map((e, i) => (
              <tr key={e.k} className="border-t border-border">
                <td className="px-2 py-1 text-xs font-semibold tabular-nums">{i + 1}</td>
                <td className="px-1 py-1">
                  <select
                    value={e.tipo}
                    disabled={readOnly}
                    onChange={(ev) => cambiar(e.k, { tipo: ev.target.value as Empaque["tipo"] })}
                    className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                  >
                    <option>Caja</option>
                    <option>Bulto</option>
                  </select>
                </td>
                <td className="px-1 py-1">
                  <Input
                    value={e.color}
                    disabled={readOnly}
                    onChange={(ev) => cambiar(e.k, { color: ev.target.value.toUpperCase() })}
                    className="h-7 min-w-[80px] text-xs"
                  />
                </td>
                {tallas.map((t) => (
                  <td key={t} className="px-1 py-1">
                    <Input
                      type="number"
                      min="0"
                      disabled={readOnly}
                      value={e.cantidades[t] ?? ""}
                      onChange={(ev) =>
                        cambiar(e.k, {
                          cantidades: {
                            ...e.cantidades,
                            [t]: Math.max(0, Math.floor(Number(ev.target.value) || 0)),
                          },
                        })
                      }
                      className="sin-flechas h-7 w-14 text-center text-xs tabular-nums"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  {tallas.length > 0 ? (
                    <span className="text-xs font-semibold tabular-nums">{totalDe(e, tallas)}</span>
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      disabled={readOnly}
                      value={e.piezas || ""}
                      onChange={(ev) =>
                        cambiar(e.k, { piezas: Math.max(0, Math.floor(Number(ev.target.value) || 0)) })
                      }
                      className="sin-flechas ml-auto h-7 w-20 text-right text-xs tabular-nums"
                    />
                  )}
                </td>
                <td className="px-1 py-1">
                  {!readOnly && (
                    <div className="flex">
                      <Button size="icon" variant="ghost" className="size-6" title="Duplicar" onClick={() => duplicar(e)}>
                        <Copy className="size-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        title="Quitar"
                        onClick={() => setEmpaques((prev) => prev.filter((x) => x.k !== e.k))}
                      >
                        <Trash2 className="size-3 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {empaques.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/50">
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-xs font-semibold">
                  {resumen.cajas} caja{resumen.cajas === 1 ? "" : "s"} · {resumen.bultos} bulto
                  {resumen.bultos === 1 ? "" : "s"}
                </td>
                {tallas.map((t) => (
                  <td key={t} className="px-1 py-1.5 text-center text-xs font-semibold tabular-nums">
                    {resumen.porTalla[t] || ""}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-xs font-bold tabular-nums">
                  {resumen.piezas.toLocaleString("es-MX")}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Agregar</span>
          <Input
            type="number"
            min="1"
            value={lote}
            onChange={(ev) => setLote(ev.target.value)}
            className="sin-flechas h-7 w-14 text-center text-xs"
          />
          <select
            value={loteTipo}
            onChange={(ev) => setLoteTipo(ev.target.value as "Caja" | "Bulto")}
            className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
          >
            <option value="Caja">cajas</option>
            <option value="Bulto">bultos</option>
          </select>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={agregarLote}>
            <Plus className="size-3" /> Agregar
          </Button>
          <span className="text-[11px] text-muted-foreground">
            · copian el color y la distribución del último empaque
          </span>
        </div>
      )}

      {/*
        El cuadre contra lo cortado. Avisa, no bloquea: un despacho
        parcial o con segundas es normal, y quien captura lo sabe.
      */}
      {descuadre != null && descuadre !== 0 && (
        <p className={cn("text-xs", descuadre > 0 ? "text-sky-700" : "text-amber-700")}>
          El empaque suma {resumen.piezas.toLocaleString("es-MX")} piezas;{" "}
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => fileRef.current?.click()}
                >
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

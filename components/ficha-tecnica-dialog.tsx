"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Loader2, Plus, Printer, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { cn } from "@/lib/utils"
import type {
  FichaMaterial,
  FichaTalla,
  TipoMaterialFicha,
  VwFichaTecnica,
  VwInventarioArticulo,
} from "@/lib/types"
import { FichaTecnicaImpresa } from "@/components/ficha-tecnica-impresa"
import {
  FichaProporciones,
  type ProporcionesState,
} from "@/components/ficha-proporciones"
import { BuscadorTela } from "@/components/buscador-tela"
import { fetchAll } from "@/lib/supabase/fetch-all"

/**
 * La ficha técnica de la etapa 1 (Pre orden).
 *
 * Reproduce la ficha del sistema anterior: los datos generales, los dos
 * cuadros de tallas, los dos de materiales, la foto de la prenda, y el
 * botón de imprimir que genera el mismo PDF.
 *
 * SOBRE EL PDF:
 *   Se usa `window.print()` con CSS `@media print`, el mismo patrón que
 *   las etiquetas de rollos. No se agrega una librería de PDF: el
 *   navegador ya sabe imprimir a PDF, respeta el CSS y no suma 300 KB
 *   al bundle. El usuario hace "Imprimir → Guardar como PDF", igual
 *   que en el sistema anterior.
 */

/** Las tallas de la ficha. Editables porque cambian por cliente y familia. */
const TALLAS_DEFAULT = ["CH", "M", "G", "XG"]

const BUCKET_FOTOS = "fichas"

type Props = {
  folio: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved?: () => void
}

export function FichaTecnicaDialog({ folio, open, onOpenChange, onSaved }: Props) {
  const [ficha, setFicha] = useState<VwFichaTecnica | null>(null)
  const [tallas, setTallas] = useState<FichaTalla[]>([])
  const [materiales, setMateriales] = useState<FichaMaterial[]>([])
  /** El catálogo de telas de Inventarios, para el buscador por clave. */
  const [catalogoTelas, setCatalogoTelas] = useState<VwInventarioArticulo[]>([])
  const [loading, setLoading] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [imprimiendo, setImprimiendo] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /**
   * Las proporciones del pedido. Se reconstruyen de lo guardado al cargar:
   * la de talla vive en el primer renglon del bloque `proporciones`, la de
   * color en `proporcion` de cada renglon.
   */
  const [proporciones, setProporciones] = useState<ProporcionesState>({
    total: null,
    tallas: {},
    colores: {},
  })
  const readOnly = useReadOnly()
  const { user } = useAuth()

  /** Los encabezados de talla salen de lo capturado; si no hay, los default. */
  const columnasTalla = useMemo(() => {
    const vistas = new Set<string>()
    // Primero las de la proporcion: son las que definio quien captura.
    for (const t of Object.keys(proporciones.tallas)) vistas.add(t)
    for (const t of tallas) for (const k of Object.keys(t.cantidades ?? {})) vistas.add(k)
    return vistas.size > 0 ? [...vistas] : TALLAS_DEFAULT
  }, [tallas, proporciones])

  const cargar = useCallback(async () => {
    if (!folio) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)

    const [f, t, m] = await Promise.all([
      supabase
        .from("vw_ficha_tecnica")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", folio)
        .maybeSingle(),
      supabase
        .from("ficha_tallas")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", folio)
        .order("bloque")
        .order("orden"),
      supabase
        .from("ficha_materiales")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", folio)
        .order("tipo")
        .order("orden"),
    ])

    setLoading(false)

    if (f.error) {
      toast.error("No se pudo cargar la ficha", { description: f.error.message })
      return
    }
    const filasTalla = (t.data as FichaTalla[]) ?? []
    setFicha((f.data as VwFichaTecnica) ?? null)
    setTallas(filasTalla)
    setMateriales((m.data as FichaMaterial[]) ?? [])

    // Reconstruir las proporciones de lo guardado. La de talla es del
    // bloque (se lee del primer renglon); la de color, de cada renglon.
    const espec = filasTalla.filter((x) => x.bloque === "Especificacion")
    const colores: Record<string, number> = {}
    for (const x of espec) colores[x.color] = Number(x.proporcion ?? 0)
    // Si lo guardado no venia en porcentaje (fichas capturadas antes del
    // cambio, o con la proporcion vacia), se normaliza a 100 para que la
    // pantalla arranque cuadrada en vez de con un aviso falso.
    const sumaC = Object.values(colores).reduce((a, b) => a + b, 0)
    if (espec.length > 0 && Math.abs(sumaC - 100) > 0.05) {
      const parejo = 100 / espec.length
      for (const k of Object.keys(colores)) {
        colores[k] = Math.round(parejo * 100) / 100
      }
    }
    setProporciones({
      total:
        (f.data as VwFichaTecnica | null)?.piezas_ficha ??
        (f.data as VwFichaTecnica | null)?.piezas_orden ??
        null,
      tallas: (espec[0]?.proporciones as Record<string, number>) ?? {},
      // la proporcion de talla ya se guarda en porcentaje desde el 064
      colores,
    })

    // La foto se guarda como ruta, no como URL: si el bucket cambia de
    // política, la ruta sigue sirviendo y solo cambia cómo se resuelve.
    const path = (f.data as VwFichaTecnica | null)?.foto_path
    if (path) {
      const { data } = supabase.storage.from(BUCKET_FOTOS).getPublicUrl(path)
      setFotoUrl(data.publicUrl)
    } else {
      setFotoUrl(null)
    }
  }, [folio])

  useEffect(() => {
    if (open && folio) void cargar()
  }, [open, folio, cargar])

  /**
   * El catálogo de telas se trae una vez al abrir la ficha, no en cada
   * `cargar()`: son 756 renglones que no cambian mientras se captura.
   */
  useEffect(() => {
    if (!open || catalogoTelas.length > 0) return
    const supabase = getSupabase()
    if (!supabase) return
    void (async () => {
      const { data } = await fetchAll<VwInventarioArticulo>(() =>
        supabase
          .from("vw_inventario_articulos")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .eq("tipo", "Tela")
          .eq("activo", true)
          .order("clave"),
      )
      setCatalogoTelas(data)
    })()
  }, [open, catalogoTelas.length])

  function campo<K extends keyof VwFichaTecnica>(k: K, v: VwFichaTecnica[K]) {
    setFicha((prev) => (prev ? { ...prev, [k]: v } : prev))
  }

  async function guardar() {
    if (!folio || !ficha) return
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)

    // Los campos simples viven en la orden; la vista es solo de lectura.
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({
        razon_social: ficha.razon_social,
        marca: ficha.marca,
        compradora: ficha.compradora,
        num_pedido: ficha.num_pedido,
        modelo_cliente: ficha.modelo_cliente,
        descripcion_completa: ficha.descripcion_completa,
        costo_fijo: ficha.costo_fijo,
        precio_venta: ficha.precio_venta,
        precio_publico: ficha.precio_publico,
        fecha_confirmacion: ficha.fecha_confirmacion,
        piezas_ficha: proporciones.total,
      })
      .eq("idempresa", IDEMPRESA)
      .eq("folio", folio)

    if (error) {
      setGuardando(false)
      toast.error("No se pudo guardar la ficha", { description: error.message })
      return
    }

    // Marcar la etapa 1 como capturada, para que el avance lo refleje.
    const { data: etapa } = await supabase
      .from("cat_etapas_produccion")
      .select("id")
      .eq("idempresa", IDEMPRESA)
      .eq("clave", "pre_orden")
      .maybeSingle()

    if (etapa?.id) {
      await supabase.from("orden_etapas").upsert(
        {
          idempresa: IDEMPRESA,
          folio,
          idetapa: etapa.id,
          estado: "Completada",
          fecha_completada: new Date().toISOString().slice(0, 10),
          capturado_por: user?.username ?? null,
        },
        { onConflict: "idempresa,folio,idetapa" },
      )
    }

    setGuardando(false)
    toast.success("Ficha técnica guardada")
    await cargar()
    onSaved?.()
  }

  async function subirFoto(file: File) {
    if (!folio) return
    const supabase = getSupabase()
    if (!supabase) return

    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen")
      return
    }
    // 5 MB: una foto de prenda no necesita más, y un archivo enorme
    // hace lentas todas las cargas de la ficha después.
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen no debe pasar de 5 MB")
      return
    }

    setSubiendo(true)
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const path = `${IDEMPRESA}/${folio}/prenda.${ext}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET_FOTOS)
      .upload(path, file, { upsert: true, contentType: file.type })

    if (upErr) {
      setSubiendo(false)
      toast.error("No se pudo subir la foto", { description: upErr.message })
      return
    }

    const { error: dbErr } = await supabase
      .from("ordenes_produccion")
      .update({ foto_path: path })
      .eq("idempresa", IDEMPRESA)
      .eq("folio", folio)

    setSubiendo(false)
    if (dbErr) {
      toast.error("La foto se subió pero no se pudo asociar", { description: dbErr.message })
      return
    }
    toast.success("Foto actualizada")
    await cargar()
  }

  /**
   * Escribe el reparto calculado en el cuadro de Especificacion: da de alta
   * los colores que falten y actualiza cantidades y proporciones.
   *
   * Solo toca ese bloque. "Piezas cortadas" es lo que REALMENTE salio del
   * corte y no se deduce de un plan.
   */
  async function aplicarReparto(reparto: Record<string, Record<string, number>>) {
    if (!folio) return
    const supabase = getSupabase()
    if (!supabase) return

    const sumaC = Object.values(proporciones.colores).reduce(
      (a, b) => a + (Number(b) || 0), 0)
    const existentes = new Map(
      tallas.filter((t) => t.bloque === "Especificacion").map((t) => [t.color, t]),
    )

    let orden = 0
    for (const [color, fila] of Object.entries(reparto)) {
      orden++
      const comun = {
        cantidades: fila,
        proporciones: proporciones.tallas,
        proporcion: sumaC > 0 ? proporciones.colores[color] ?? 1 : null,
      }
      const previo = existentes.get(color)
      const { error } = previo
        ? await supabase.from("ficha_tallas").update(comun).eq("id", previo.id)
        : await supabase.from("ficha_tallas").insert({
            idempresa: IDEMPRESA,
            folio,
            bloque: "Especificacion",
            color,
            orden,
            ...comun,
          })
      if (error) {
        toast.error(`No se pudo aplicar el reparto a ${color}`, {
          description: error.message,
        })
        return
      }
    }
    toast.success("Reparto aplicado — ya puedes ajustar tallas a mano")
    await cargar()
  }

  // ── Tallas ────────────────────────────────────────────────────────────────

  /**
   * El color se captura en la propia tabla, no con window.prompt: el
   * prompt del navegador queda bloqueado cuando la ficha se abre sobre
   * otro panel modal, y el boton parecia no hacer nada.
   */
  async function agregarTalla(bloque: "Especificacion" | "Cortadas", color: string) {
    if (!folio) {
      toast.error("No se pudo identificar el folio. Cierra y vuelve a abrir la ficha.")
      return
    }
    const limpio = color.trim().toUpperCase()
    if (!limpio) {
      toast.error("Escribe el color del renglon")
      return
    }
    // La clave unica es (folio, bloque, color): avisar antes es mas claro
    // que dejar que la base rechace con un error tecnico.
    if (tallas.some((t) => t.bloque === bloque && t.color.toUpperCase() === limpio)) {
      toast.error(`Ya hay un renglon para ${limpio} en este bloque`)
      return
    }
    const supabase = getSupabase()
    if (!supabase) return

    const { error } = await supabase.from("ficha_tallas").insert({
      idempresa: IDEMPRESA,
      folio,
      bloque,
      color: limpio,
      orden: tallas.filter((t) => t.bloque === bloque).length + 1,
      cantidades: Object.fromEntries(columnasTalla.map((c) => [c, 0])),
      // La proporción se hereda del primer renglón del bloque: es del
      // tendido, la misma para todos los colores.
      proporciones:
        tallas.find((t) => t.bloque === bloque)?.proporciones ?? {},
    })
    if (error) {
      toast.error("No se pudo agregar el renglón", { description: error.message })
      return
    }
    toast.success(`Color ${limpio} agregado`)
    await cargar()
  }

  async function guardarTalla(fila: FichaTalla, talla: string, valor: number) {
    const supabase = getSupabase()
    if (!supabase) return
    const cantidades = { ...(fila.cantidades ?? {}), [talla]: valor }
    setTallas((prev) => prev.map((t) => (t.id === fila.id ? { ...t, cantidades } : t)))
    const { error } = await supabase
      .from("ficha_tallas")
      .update({ cantidades })
      .eq("id", fila.id)
    if (error) toast.error("No se pudo guardar", { description: error.message })
  }

  /**
   * La proporcion del tendido se guarda en el PRIMER renglon del bloque:
   * es una sola por bloque, no una por color, y asi el PDF la encuentra
   * donde la espera.
   */
  async function guardarProporcion(
    bloque: "Especificacion" | "Cortadas",
    talla: string,
    valor: number,
  ) {
    const supabase = getSupabase()
    if (!supabase) return
    const primera = tallas.find((t) => t.bloque === bloque)
    if (!primera) {
      toast.error("Agrega primero un renglon de color")
      return
    }
    const proporciones = { ...(primera.proporciones ?? {}), [talla]: valor }
    setTallas((prev) =>
      prev.map((t) => (t.id === primera.id ? { ...t, proporciones } : t)),
    )
    const { error } = await supabase
      .from("ficha_tallas")
      .update({ proporciones })
      .eq("id", primera.id)
    if (error) toast.error("No se pudo guardar", { description: error.message })
  }

  async function borrarTalla(id: number) {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase.from("ficha_tallas").delete().eq("id", id)
    if (error) {
      toast.error("No se pudo borrar", { description: error.message })
      return
    }
    await cargar()
  }

  // ── Materiales ────────────────────────────────────────────────────────────

  async function agregarMaterial(tipo: TipoMaterialFicha) {
    if (!folio) {
      toast.error("No se pudo identificar el folio. Cierra y vuelve a abrir la ficha.")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase.from("ficha_materiales").insert({
      idempresa: IDEMPRESA,
      folio,
      tipo,
      orden: materiales.filter((m) => m.tipo === tipo).length + 1,
      descripcion: "",
      cantidad: 0,
      costo: 0,
    })
    if (error) {
      toast.error("No se pudo agregar la línea", { description: error.message })
      return
    }
    // La línea nace vacía; sin aviso, agregarla se siente como que no pasó
    // nada hasta que uno mira el final de la tabla.
    toast.success("Línea agregada — captura clave, descripción y costo")
    await cargar()
  }

  async function guardarMaterial(fila: FichaMaterial, cambios: Partial<FichaMaterial>) {
    const supabase = getSupabase()
    if (!supabase) return
    setMateriales((prev) => prev.map((m) => (m.id === fila.id ? { ...m, ...cambios } : m)))
    const { error } = await supabase
      .from("ficha_materiales")
      .update(cambios)
      .eq("id", fila.id)
    if (error) toast.error("No se pudo guardar", { description: error.message })
  }

  async function borrarMaterial(id: number) {
    const supabase = getSupabase()
    if (!supabase) return
    const { error } = await supabase.from("ficha_materiales").delete().eq("id", id)
    if (error) {
      toast.error("No se pudo borrar", { description: error.message })
      return
    }
    await cargar()
  }

  if (!open) return null

  const espec = tallas.filter((t) => t.bloque === "Especificacion")
  const cortadas = tallas.filter((t) => t.bloque === "Cortadas")
  const telas = materiales.filter((m) => m.tipo === "Tela")
  /** Los usos ya escritos en esta ficha, como sugerencia al capturar. */
  const usosSugeridos = [
    ...new Set(
      [...materiales.map((m) => m.uso), "PRINCIPAL", "FORRO", "ENTRETELA", "VISTA"]
        .filter((u): u is string => Boolean(u)),
    ),
  ]
  const habilitacion = materiales.filter((m) => m.tipo === "Habilitacion")

  // Al imprimir se monta solo la hoja: el formulario no debe salir en el PDF.
  if (imprimiendo && ficha) {
    return (
      <FichaTecnicaImpresa
        ficha={ficha}
        tallas={tallas}
        materiales={materiales}
        columnasTalla={columnasTalla}
        fotoUrl={fotoUrl}
        onCerrar={() => setImprimiendo(false)}
      />
    )
  }

  /*
    Vista completa, no modal. Como modal se apilaba sobre la hoja de etapas
    —otro panel modal— y eso dio tres fallos seguidos: el prompt bloqueado,
    el overlay tragandose los clics y el folio perdido al cerrarse el panel
    de abajo. Una pantalla de este tamano no cabe en un modal.
  */
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => onOpenChange(false)}
            >
              <ArrowLeft className="size-4" />
              Volver
            </Button>
            <div>
              <h2 className="text-lg font-semibold">Ficha técnica · folio {folio}</h2>
              <p className="text-xs text-muted-foreground">Etapa 1 · Pre orden</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!ficha || loading}
              onClick={() => setImprimiendo(true)}
            >
              <Printer className="size-4" />
              Imprimir / PDF
            </Button>
            <Button size="sm" disabled={readOnly || guardando || loading} onClick={guardar}>
              {guardando && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Guardar
            </Button>

          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Cargando ficha…
          </div>
        ) : !ficha ? (
          <div className="py-20 text-center text-muted-foreground">
            No se encontró el folio.
          </div>
        ) : (
          <div className="p-5">
            <div className="space-y-6">
              {/* ── Datos generales + foto ── */}
              <section className="grid gap-5 md:grid-cols-[220px_1fr]">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Foto de la prenda
                  </p>
                  <div
                    className={cn(
                      "flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border-2 border-dashed",
                      fotoUrl && "border-solid",
                    )}
                  >
                    {fotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fotoUrl} alt="Prenda" className="size-full object-contain" />
                    ) : (
                      <span className="px-3 text-center text-xs text-muted-foreground">
                        Sin foto
                      </span>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void subirFoto(f)
                      e.target.value = ""
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full gap-1.5"
                    disabled={readOnly || subiendo}
                    onClick={() => fileRef.current?.click()}
                  >
                    {subiendo ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {fotoUrl ? "Cambiar foto" : "Subir foto"}
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label="Razón Social" value={ficha.razon_social} readOnly={readOnly}
                    onChange={(v) => campo("razon_social", v)} />
                  <Campo label="Marca" value={ficha.marca} readOnly={readOnly}
                    onChange={(v) => campo("marca", v)} />
                  <Campo label="Compradora" value={ficha.compradora} readOnly={readOnly}
                    onChange={(v) => campo("compradora", v)} />
                  <Campo label="Núm. Pedido" value={ficha.num_pedido} readOnly={readOnly}
                    onChange={(v) => campo("num_pedido", v)} />
                  <Campo label="Modelo Interno" value={ficha.modelo} readOnly disabled
                    onChange={() => {}} />
                  <Campo label="Modelo Cliente" value={ficha.modelo_cliente} readOnly={readOnly}
                    onChange={(v) => campo("modelo_cliente", v)} />
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Descripción Completa
                    </label>
                    <Textarea
                      rows={2}
                      disabled={readOnly}
                      value={ficha.descripcion_completa ?? ""}
                      onChange={(e) => campo("descripcion_completa", e.target.value)}
                      className="mt-1 text-sm"
                    />
                  </div>
                </div>
              </section>

              {/* ── Tallas ── */}
              <FichaProporciones
                valor={proporciones}
                onChange={setProporciones}
                onAplicar={aplicarReparto}
                readOnly={readOnly}
              />

              <CuadroTallas
                titulo="Especificación de Talla"
                filas={espec}
                columnas={columnasTalla}
                readOnly={readOnly}
                onAgregar={(color) => agregarTalla("Especificacion", color)}
                onCambiar={guardarTalla}
                onCambiarProporcion={(talla, v) =>
                  guardarProporcion("Especificacion", talla, v)
                }
                onBorrar={borrarTalla}
              />

              <CuadroTallas
                titulo="Piezas Cortadas"
                filas={cortadas}
                columnas={columnasTalla}
                readOnly={readOnly}
                onAgregar={(color) => agregarTalla("Cortadas", color)}
                onCambiar={guardarTalla}
                onCambiarProporcion={(talla, v) =>
                  guardarProporcion("Cortadas", talla, v)
                }
                onBorrar={borrarTalla}
              />

              {/* ── Costos ── */}
              <section>
                <h3 className="mb-2 text-sm font-semibold">Costos y precios</h3>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <CampoNum label="Costo Fijo" value={ficha.costo_fijo} readOnly={readOnly}
                    onChange={(v) => campo("costo_fijo", v)} />
                  <Derivado label="Costo Neto" value={ficha.costo_neto} />
                  <CampoNum label="Precio Venta" value={ficha.precio_venta} readOnly={readOnly}
                    onChange={(v) => campo("precio_venta", v)} />
                  <Derivado label="Margen %" value={ficha.margen_pct} sufijo="%" />
                  <CampoNum label="Precio Público" value={ficha.precio_publico} readOnly={readOnly}
                    onChange={(v) => campo("precio_publico", v)} />
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Fecha confirmación
                    </label>
                    <Input
                      type="date"
                      disabled={readOnly}
                      value={ficha.fecha_confirmacion ?? ""}
                      onChange={(e) => campo("fecha_confirmacion", e.target.value || null)}
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Costo Neto y Margen se calculan solos: Costo Neto = fijo + maquila +
                  lavandería + tela + habilitación.
                </p>
              </section>

              {/* ── Materiales ── */}
              <CuadroMateriales
                titulo="Composición de Tela"
                filas={telas}
                readOnly={readOnly}
                esTela
                catalogoTelas={catalogoTelas}
                usosSugeridos={usosSugeridos}
                onAgregar={() => agregarMaterial("Tela")}
                onCambiar={guardarMaterial}
                onBorrar={borrarMaterial}
              />

              <CuadroMateriales
                titulo="Habilitación"
                filas={habilitacion}
                readOnly={readOnly}
                onAgregar={() => agregarMaterial("Habilitacion")}
                onCambiar={guardarMaterial}
                onBorrar={borrarMaterial}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Piezas del formulario ───────────────────────────────────────────────────

function Campo({
  label, value, onChange, readOnly, disabled,
}: {
  label: string
  value: string | null
  onChange: (v: string) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        disabled={readOnly || disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-8 text-sm"
      />
    </div>
  )
}

function CampoNum({
  label, value, onChange, readOnly,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  readOnly?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        type="number"
        step="0.01"
        min="0"
        disabled={readOnly}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 h-8 text-sm"
      />
    </div>
  )
}

/** Un valor calculado por la base. Se muestra, no se edita. */
function Derivado({ label, value, sufijo }: { label: string; value: number | null; sufijo?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1 flex h-8 items-center rounded-md border border-border bg-muted/50 px-3 text-sm tabular-nums">
        {value == null ? "—" : `${sufijo ? "" : "$"}${Number(value).toFixed(2)}${sufijo ?? ""}`}
      </div>
    </div>
  )
}

function CuadroTallas({
  titulo, filas, columnas, readOnly, onAgregar, onCambiar, onCambiarProporcion, onBorrar,
}: {
  titulo: string
  filas: FichaTalla[]
  columnas: string[]
  readOnly: boolean
  onAgregar: (color: string) => void
  onCambiar: (fila: FichaTalla, talla: string, valor: number) => void
  onCambiarProporcion: (talla: string, valor: number) => void
  onBorrar: (id: number) => void
}) {
  const [nuevoColor, setNuevoColor] = useState("")
  const total = filas.reduce(
    (s, f) => s + Object.values(f.cantidades ?? {}).reduce((a, b) => a + Number(b || 0), 0),
    0,
  )
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {/*
          El color se teclea aqui mismo. Antes lo pedia window.prompt, que
          el navegador bloquea cuando la ficha se abre sobre otro panel
          modal: el boton parecia no hacer nada.
        */}
        <div className="flex items-center gap-1.5">
          <Input
            value={nuevoColor}
            onChange={(e) => setNuevoColor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nuevoColor.trim()) {
                onAgregar(nuevoColor)
                setNuevoColor("")
              }
            }}
            placeholder="Color…"
            disabled={readOnly}
            className="h-7 w-36 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={readOnly || !nuevoColor.trim()}
            onClick={() => {
              onAgregar(nuevoColor)
              setNuevoColor("")
            }}
          >
            <Plus className="size-3" />
            Color
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Color</th>
              {columnas.map((c) => (
                <th key={c} className="px-2 py-1.5 text-center font-medium">{c}</th>
              ))}
              <th className="px-3 py-1.5 text-right font-medium">Total</th>
              <th className="w-10" />
            </tr>
            {/*
              La proporción del tendido: un valor por talla, no por color.
              Se guarda en el primer renglón del bloque, que es donde la
              busca el PDF.
            */}
            {filas.length > 0 && (
              <tr className="border-t border-border">
                <td className="px-3 py-1 text-xs font-medium text-muted-foreground">
                  Proporción
                </td>
                {columnas.map((c) => (
                  <td key={c} className="px-1 py-1">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={readOnly}
                      defaultValue={String(filas[0]?.proporciones?.[c] ?? "")}
                      onBlur={(e) =>
                        onCambiarProporcion(c, Number(e.target.value) || 0)
                      }
                      className="h-7 w-full min-w-[60px] text-center text-xs tabular-nums"
                    />
                  </td>
                ))}
                <td />
                <td />
              </tr>
            )}
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={columnas.length + 3}
                  className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sin renglones. Agrega un color.
                </td>
              </tr>
            ) : (
              filas.map((f) => {
                const suma = Object.values(f.cantidades ?? {}).reduce(
                  (a, b) => a + Number(b || 0), 0)
                return (
                  <tr key={f.id} className="border-t border-border">
                    <td className="px-3 py-1 font-medium">{f.color}</td>
                    {columnas.map((c) => (
                      <td key={c} className="px-1 py-1">
                        <Input
                          type="number"
                          min="0"
                          disabled={readOnly}
                          value={String(f.cantidades?.[c] ?? 0)}
                          onChange={(e) => onCambiar(f, c, Number(e.target.value) || 0)}
                          className="h-7 w-full min-w-[60px] text-center text-sm tabular-nums"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1 text-right font-medium tabular-nums">{suma}</td>
                    <td className="px-1 py-1">
                      <Button size="sm" variant="ghost" className="size-7 p-0"
                        disabled={readOnly} onClick={() => onBorrar(f.id)}>
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
          {filas.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/50">
              <tr>
                <td className="px-3 py-1.5 font-semibold" colSpan={columnas.length + 1}>
                  Piezas Totales
                </td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{total}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}

function CuadroMateriales({
  titulo, filas, readOnly, esTela, catalogoTelas, usosSugeridos,
  onAgregar, onCambiar, onBorrar,
}: {
  titulo: string
  filas: FichaMaterial[]
  readOnly: boolean
  /** Las telas traen buscador de catálogo y uso; las habilitaciones no. */
  esTela?: boolean
  catalogoTelas?: VwInventarioArticulo[]
  /** Usos ya capturados, para no teclear "FORRO" cada vez. */
  usosSugeridos?: string[]
  onAgregar: () => void
  onCambiar: (fila: FichaMaterial, cambios: Partial<FichaMaterial>) => void
  onBorrar: (id: number) => void
}) {
  const total = filas.reduce((s, f) => s + Number(f.cantidad || 0) * Number(f.costo || 0), 0)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
          disabled={readOnly} onClick={onAgregar}>
          <Plus className="size-3" />
          Línea
        </Button>
      </div>
      {esTela && (
        <datalist id="usos-tela">
          {(usosSugeridos ?? []).map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Clave</th>
              {esTela && <th className="px-2 py-1.5 text-left font-medium">Tipo</th>}
              <th className="px-2 py-1.5 text-left font-medium">Descripción</th>
              <th className="px-2 py-1.5 text-right font-medium">Cantidad</th>
              <th className="px-2 py-1.5 text-right font-medium">Costo</th>
              <th className="px-2 py-1.5 text-right font-medium">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={esTela ? 7 : 6}
                  className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sin líneas.
                </td>
              </tr>
            ) : (
              filas.map((f) => (
                <tr key={f.id} className="border-t border-border">
                  <td className="px-1 py-1">
                    {esTela ? (
                      <BuscadorTela
                        valor={f.clave}
                        telas={catalogoTelas ?? []}
                        disabled={readOnly}
                        onSelect={(tela, claveManual) =>
                          // Al elegir del catálogo se traen también nombre y
                          // costo: son el dato bueno, y retecleárlos solo
                          // introduce diferencias con Inventarios.
                          onCambiar(f, {
                            clave: claveManual || null,
                            idarticulo: tela?.id ?? null,
                            descripcion: tela?.nombre ?? f.descripcion,
                            costo: tela?.costo_unitario ?? f.costo,
                          })
                        }
                      />
                    ) : (
                      <Input disabled={readOnly} defaultValue={f.clave ?? ""}
                        onBlur={(e) => onCambiar(f, { clave: e.target.value })}
                        className="h-7 min-w-[130px] text-xs" />
                    )}
                  </td>
                  {esTela && (
                    <td className="px-1 py-1">
                      <Input
                        disabled={readOnly}
                        defaultValue={f.uso ?? ""}
                        onBlur={(e) =>
                          onCambiar(f, { uso: e.target.value.toUpperCase() || null })
                        }
                        placeholder="Forro, entretela…"
                        list="usos-tela"
                        className="h-7 min-w-[110px] text-xs"
                      />
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <Input disabled={readOnly} defaultValue={f.descripcion ?? ""}
                      onBlur={(e) => onCambiar(f, { descripcion: e.target.value })}
                      className="h-7 min-w-[220px] text-xs" />
                  </td>
                  <td className="px-1 py-1">
                    <Input type="number" step="0.0001" min="0" disabled={readOnly}
                      defaultValue={String(f.cantidad ?? 0)}
                      onBlur={(e) => onCambiar(f, { cantidad: Number(e.target.value) || 0 })}
                      className="h-7 w-[90px] text-right text-xs tabular-nums" />
                  </td>
                  <td className="px-1 py-1">
                    <Input type="number" step="0.0001" min="0" disabled={readOnly}
                      defaultValue={String(f.costo ?? 0)}
                      onBlur={(e) => onCambiar(f, { costo: Number(e.target.value) || 0 })}
                      className="h-7 w-[90px] text-right text-xs tabular-nums" />
                  </td>
                  <td className="px-2 py-1 text-right text-xs tabular-nums">
                    ${(Number(f.cantidad || 0) * Number(f.costo || 0)).toFixed(2)}
                  </td>
                  <td className="px-1 py-1">
                    <Button size="sm" variant="ghost" className="size-7 p-0"
                      disabled={readOnly} onClick={() => onBorrar(f.id)}>
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {filas.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/50">
              <tr>
                <td colSpan={esTela ? 5 : 4} className="px-3 py-1.5 text-right font-semibold">
                  Total
                </td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  ${total.toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}

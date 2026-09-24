"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Loader2, Plus, Printer, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { puedeVerCostos, puedeEditarFicha } from "@/lib/permisos-ficha"
import { cn } from "@/lib/utils"
import type {
  FichaMaterial,
  FichaTalla,
  FichaEan,
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
import { FichaResultadoCorte } from "@/components/ficha-resultado-corte"
import { FichaEanMatriz, type MatrizEan } from "@/components/ficha-ean-matriz"
import { FichaResumenCostos } from "@/components/ficha-resumen-costos"
import { fetchAll } from "@/lib/supabase/fetch-all"

/**
 * La ficha técnica de la etapa 1 (Pre orden).
 *
 * Reproduce la ficha del sistema anterior: los datos generales, los dos
 * cuadros de tallas, los dos de materiales, la foto de la prenda, y el
 * botón de imprimir que genera el mismo PDF.
 *
 * NADA SE GUARDA SOLO:
 *   Todo lo que se teclea vive en memoria hasta que alguien presiona
 *   Guardar (pedido de operación, 15-sep-2026). Antes, cada campo
 *   escribía a la base al salir del foco: ocho caminos distintos, y no
 *   había forma de arrepentirse.
 *
 *   Las filas nuevas llevan id negativo mientras viven en memoria; al
 *   guardar, id < 0 significa insertar y id > 0 actualizar.
 *
 *   La excepción es la foto: el archivo ya subió a Storage y no se puede
 *   deshacer descartando.
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

/** El costo fijo de la empresa. Editable, pero este es el de partida. */
const COSTO_FIJO_DEFAULT = 9.5

/**
 * Id temporal para una fila que todavia no existe en la base.
 *
 * Negativo a proposito: al guardar, un id < 0 significa "esta es nueva,
 * hay que insertarla"; uno positivo, "ya existe, hay que actualizarla".
 */
let siguienteIdTemporal = -1
function idTemporal(): number {
  return siguienteIdTemporal--
}

/**
 * Fecha en formato local: 24/07/2026.
 *
 * Se parte la cadena en vez de usar Date: `new Date("2026-07-24")` se
 * interpreta como UTC y en México mostraría el día anterior.
 */
function fmtFechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${a}`
}

/** Importe corto para las explicaciones de la franja de costeo. */
function fmt(v: number | null | undefined): string {
  return v == null ? "$0.00" : `$${Number(v).toFixed(2)}`
}

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
  /** Los catálogos de Inventarios, para los buscadores por clave. */
  const [catalogoTelas, setCatalogoTelas] = useState<VwInventarioArticulo[]>([])
  const [catalogoHab, setCatalogoHab] = useState<VwInventarioArticulo[]>([])
  /** Los maquileros del catálogo, para asignar quién produce la orden. */
  const [maquileros, setMaquileros] = useState<{ id: number; nombre: string }[]>([])
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
  /**
   * Una copia de lo que se cargó de la base, para comparar contra lo que
   * hay en pantalla y saber si quedaron cambios sin guardar.
   *
   * La ficha es informacion sensible: nada se escribe hasta que alguien
   * presiona Guardar (pedido de operacion, 15-sep-2026). Todo lo que se
   * teclea vive aqui en memoria mientras tanto.
   */
  const [original, setOriginal] = useState<string>("")
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  /** Filas que ya existen en la base y se borrarán al guardar. */
  const [borradosTallas, setBorradosTallas] = useState<number[]>([])
  /** La matriz de codigos EAN, una fila por color. */
  const [eanes, setEanes] = useState<FichaEan[]>([])
  const [borradosMateriales, setBorradosMateriales] = useState<number[]>([])
  const readOnlyGlobal = useReadOnly()
  const { user } = useAuth()

  /**
   * Los dos permisos de la ficha.
   *
   * `readOnly` sustituye al de solo lectura global: aqui bloquea tanto
   * quien no puede escribir en NADA como quien no tiene permiso de
   * editar esta pantalla. Se calcula una vez y se pasa a los hijos, que
   * ya lo reciben; asi no hay que tocar cada campo.
   *
   * OJO: esto es un guardarrail de pantalla. Sin RLS (script 015) la
   * anon key del navegador sigue pudiendo leer y escribir la tabla.
   */
  const verCostos = puedeVerCostos(user)
  const readOnly = readOnlyGlobal || !puedeEditarFicha(user)

  /** Los encabezados de talla salen de lo capturado; si no hay, los default. */
  const columnasTalla = useMemo(() => {
    const vistas = new Set<string>()
    // Primero las de la proporcion: son las que definio quien captura.
    for (const t of Object.keys(proporciones.tallas)) vistas.add(t)
    for (const t of tallas) for (const k of Object.keys(t.cantidades ?? {})) vistas.add(k)
    return vistas.size > 0 ? [...vistas] : TALLAS_DEFAULT
  }, [tallas, proporciones])

  /**
   * Los codigos EAN como matriz {color: {talla: codigo}}.
   *
   * Se deriva de `eanes` igual que `matrizCorte` de `tallas`: el estado
   * guarda filas —que es lo que la base recibe— y la pantalla necesita
   * la matriz.
   */
  const matrizEan = useMemo(() => {
    const m: MatrizEan = {}
    for (const fila of eanes) m[fila.color] = { ...(fila.codigos ?? {}) }
    return m
  }, [eanes])

  /**
   * El reparto planeado, como matriz color × talla. Define la forma del
   * cuadro de resultado de corte: mismas filas, mismas columnas.
   */
  const matrizPlan = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const fila of tallas.filter((t) => t.bloque === "Especificacion")) {
      m[fila.color] = { ...(fila.cantidades ?? {}) } as Record<string, number>
    }
    return m
  }, [tallas])

  /**
   * Lo capturado del corte. Una celda ausente es "sin capturar", que NO
   * es lo mismo que un cero: el cero dice "no salió ninguna", el hueco
   * dice "todavía no lo sé".
   */
  const matrizCorte = useMemo(() => {
    const m: Record<string, Record<string, number | null>> = {}
    for (const fila of tallas.filter((t) => t.bloque === "Cortadas")) {
      m[fila.color] = { ...(fila.cantidades ?? {}) } as Record<string, number | null>
    }
    return m
  }, [tallas])

  /**
   * Captura una celda del corte. Si el color todavía no tiene renglón, se
   * crea copiando la estructura del plan: quien captura no debería tener
   * que dar de alta nada.
   *
   * Solo en memoria: se escribe al presionar Guardar.
   */
  function capturarCorte(color: string, talla: string, valor: number | null) {
    if (!folio) return
    setTallas((prev) => {
      const fila = prev.find((t) => t.bloque === "Cortadas" && t.color === color)
      if (fila) {
        const cantidades = { ...(fila.cantidades ?? {}) } as Record<string, number>
        if (valor == null) delete cantidades[talla]
        else cantidades[talla] = valor
        return prev.map((t) => (t.id === fila.id ? { ...t, cantidades } : t))
      }
      // Sin renglón todavía: nace con esta sola casilla, no con el plan.
      if (valor == null) return prev
      const delPlan = prev.find(
        (t) => t.bloque === "Especificacion" && t.color === color,
      )
      return [
        ...prev,
        {
          id: idTemporal(),
          idempresa: IDEMPRESA,
          folio,
          bloque: "Cortadas" as const,
          color,
          orden: prev.filter((t) => t.bloque === "Cortadas").length + 1,
          cantidades: { [talla]: valor },
          proporciones: delPlan?.proporciones ?? {},
          proporcion: delPlan?.proporcion ?? null,
          created_at: new Date().toISOString(),
        },
      ]
    })
  }

  /**
   * Captura un código EAN. Igual que el corte: si el color todavía no
   * tiene renglón se crea, y todo vive en memoria hasta Guardar.
   *
   * La casilla vaciada BORRA la talla del objeto en vez de guardar "":
   * "el cliente no dio este código" y "lo dio vacío" son lo mismo, y
   * guardar la cadena vacía llenaría el jsonb de ruido.
   */
  function capturarEan(color: string, talla: string, codigo: string) {
    if (!folio) return
    setEanes((prev) => {
      const fila = prev.find((x) => x.color === color)
      if (fila) {
        const codigos = { ...(fila.codigos ?? {}) }
        if (codigo === "") delete codigos[talla]
        else codigos[talla] = codigo
        return prev.map((x) => (x.id === fila.id ? { ...x, codigos } : x))
      }
      if (codigo === "") return prev
      return [
        ...prev,
        {
          id: idTemporal(),
          idempresa: IDEMPRESA,
          folio,
          color,
          orden: prev.length + 1,
          codigos: { [talla]: codigo },
          created_at: new Date().toISOString(),
        },
      ]
    })
  }

  const cargar = useCallback(async () => {
    if (!folio) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)

    const [f, t, m, e] = await Promise.all([
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
      supabase
        .from("ficha_ean")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", folio)
        .order("orden"),
    ])

    setLoading(false)

    if (f.error) {
      toast.error("No se pudo cargar la ficha", { description: f.error.message })
      return
    }
    const filasTalla = (t.data as FichaTalla[]) ?? []
    // 9.50 por omisión: es el costo fijo de la empresa y venía en blanco
    // en las fichas anteriores al script 066.
    const datos = f.data as VwFichaTecnica | null
    setFicha(
      datos
        ? { ...datos, costo_fijo: datos.costo_fijo ?? COSTO_FIJO_DEFAULT }
        : null,
    )
    setTallas(filasTalla)
    setMateriales((m.data as FichaMaterial[]) ?? [])
    setEanes((e.data as FichaEan[]) ?? [])

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

    // La huella de lo recién cargado. Compararla contra el estado actual
    // dice si hay cambios sin guardar, sin tener que rastrear cada campo.
    setOriginal(
      JSON.stringify({
        f: datos,
        t: filasTalla,
        m: (m.data as FichaMaterial[]) ?? [],
        e: (e.data as FichaEan[]) ?? [],
      }),
    )

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
      const [tel, hab] = await Promise.all([
        fetchAll<VwInventarioArticulo>(() =>
          supabase
            .from("vw_inventario_articulos")
            .select("*")
            .eq("idempresa", IDEMPRESA)
            .eq("tipo", "Tela")
            .eq("activo", true)
            .order("clave"),
        ),
        fetchAll<VwInventarioArticulo>(() =>
          supabase
            .from("vw_inventario_articulos")
            .select("*")
            .eq("idempresa", IDEMPRESA)
            .eq("tipo", "Habilitación")
            .eq("activo", true)
            .order("clave"),
        ),
      ])
      setCatalogoTelas(tel.data)
      setCatalogoHab(hab.data)

      const { data: maq } = await supabase
        .from("maquileros")
        .select("id, nombre")
        .eq("idempresa", IDEMPRESA)
        .order("nombre")
      setMaquileros(maq ?? [])
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
        // El EAN general ya NO se edita aquí —ahora hay una matriz por
        // color y talla, que es como se identifica un SKU— pero se
        // reescribe tal cual para no borrar el que traigan las fichas
        // capturadas antes del cambio.
        codigo_ean: ficha.codigo_ean?.trim() || null,
        descripcion_completa: ficha.descripcion_completa,
        costo_fijo: ficha.costo_fijo,
        precio_venta: ficha.precio_venta,
        precio_publico: ficha.precio_publico,
        fecha_confirmacion: ficha.fecha_confirmacion,
        piezas_ficha: proporciones.total,
        // Los costos del proceso y el maquilero: son el MISMO dato que usa
        // Pago Maquilas, no una copia. La ficha sirve para asignarlos
        // cuando la orden todavía no los trae.
        costo_maquila: ficha.costo_maquila,
        costo_lavanderia: ficha.costo_lavanderia,
        costo_estampado: ficha.costo_estampado,
        costo_bordado: ficha.costo_bordado,
        costo_corte_externo: ficha.costo_corte_externo,
        costo_otro: ficha.costo_otro,
        idmaquilero_lavanderia: ficha.idmaquilero_lavanderia,
        idmaquilero_estampado: ficha.idmaquilero_estampado,
        idmaquilero_bordado: ficha.idmaquilero_bordado,
        idmaquilero_corte_externo: ficha.idmaquilero_corte_externo,
        idmaquilero_otro: ficha.idmaquilero_otro,
        idmaquilero: ficha.idmaquilero,
        maquilero: ficha.maquilero,
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

    // ── Las tallas y los materiales, que se editaron en memoria ──
    //
    // Se guardan DESPUES de la orden: si algo falla aqui, al menos los
    // campos simples quedaron. El orden inverso dejaria tallas huerfanas
    // de una ficha que no se guardo.
    for (const id of borradosTallas) {
      await supabase.from("ficha_tallas").delete().eq("id", id)
    }
    for (const id of borradosMateriales) {
      await supabase.from("ficha_materiales").delete().eq("id", id)
    }

    // Id negativo = fila nueva; positivo = ya existe.
    const nuevasT = tallas.filter((t) => t.id < 0)
    const previasT = tallas.filter((t) => t.id > 0)
    if (nuevasT.length > 0) {
      const { error: e } = await supabase.from("ficha_tallas").insert(
        nuevasT.map(({ id, created_at, ...resto }) => resto),
      )
      if (e) {
        setGuardando(false)
        toast.error("No se pudieron guardar las tallas", { description: e.message })
        return
      }
    }
    for (const t of previasT) {
      await supabase
        .from("ficha_tallas")
        .update({
          color: t.color,
          orden: t.orden,
          cantidades: t.cantidades,
          proporciones: t.proporciones,
          proporcion: t.proporcion,
        })
        .eq("id", t.id)
    }

    const nuevasM = materiales.filter((m) => m.id < 0)
    const previasM = materiales.filter((m) => m.id > 0)
    if (nuevasM.length > 0) {
      const { error: e } = await supabase.from("ficha_materiales").insert(
        nuevasM.map(({ id, created_at, ...resto }) => resto),
      )
      if (e) {
        setGuardando(false)
        toast.error("No se pudieron guardar los materiales", { description: e.message })
        return
      }
    }
    for (const m of previasM) {
      await supabase
        .from("ficha_materiales")
        .update({
          clave: m.clave,
          descripcion: m.descripcion,
          cantidad: m.cantidad,
          costo: m.costo,
          idarticulo: m.idarticulo,
          uso: m.uso,
          orden: m.orden,
        })
        .eq("id", m.id)
    }

    // ── Los codigos EAN ──
    //
    // Se borra la fila entera cuando su color se queda sin un solo
    // codigo: dejarla vacia seria guardar un color que no aporta nada,
    // y al recargar la matriz la reconstruye del reparto igual.
    const conCodigos = eanes.filter((x) =>
      Object.values(x.codigos ?? {}).some((c) => String(c ?? "") !== ""),
    )
    const vaciasPrevias = eanes.filter(
      (x) =>
        x.id > 0 &&
        !Object.values(x.codigos ?? {}).some((c) => String(c ?? "") !== ""),
    )
    for (const x of vaciasPrevias) {
      await supabase.from("ficha_ean").delete().eq("id", x.id)
    }

    const nuevasE = conCodigos.filter((x) => x.id < 0)
    const previasE = conCodigos.filter((x) => x.id > 0)
    if (nuevasE.length > 0) {
      const { error: e } = await supabase.from("ficha_ean").insert(
        nuevasE.map(({ id, created_at, ...resto }) => resto),
      )
      if (e) {
        setGuardando(false)
        toast.error("No se pudieron guardar los códigos EAN", {
          description: e.message,
        })
        return
      }
    }
    for (const x of previasE) {
      await supabase
        .from("ficha_ean")
        .update({ color: x.color, orden: x.orden, codigos: x.codigos })
        .eq("id", x.id)
    }

    setBorradosTallas([])
    setBorradosMateriales([])
    setGuardando(false)
    toast.success("Ficha técnica guardada")
    await cargar()
    onSaved?.()
  }

  /**
   * Si hay algo tecleado que aun no se guardo.
   *
   * Se compara la huella de lo cargado contra el estado actual, en vez de
   * rastrear campo por campo: un campo nuevo se cubre solo.
   */
  const hayCambios =
    original !== "" &&
    (original !== JSON.stringify({ f: ficha, t: tallas, m: materiales, e: eanes }) ||
      borradosTallas.length > 0 ||
      borradosMateriales.length > 0)

  /** Volver al módulo. Si quedan cambios, primero pregunta. */
  function intentarSalir() {
    if (hayCambios) {
      setConfirmarSalida(true)
      return
    }
    onOpenChange(false)
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

    // La UNICA escritura que no pasa por Guardar, a proposito: el archivo
    // ya subio a Storage, asi que "descartar" no podria deshacerlo.
    // Asociarlo de inmediato evita que quede un archivo huerfano.
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
  function aplicarReparto(reparto: Record<string, Record<string, number>>) {
    if (!folio) return
    const sumaC = Object.values(proporciones.colores).reduce(
      (a, b) => a + (Number(b) || 0), 0)

    // Solo en memoria: se escribe al presionar Guardar.
    setTallas((prev) => {
      const otros = prev.filter((t) => t.bloque !== "Especificacion")
      const previos = prev.filter((t) => t.bloque === "Especificacion")
      let orden = 0
      const nuevos = Object.entries(reparto).map(([color, fila]) => {
        orden++
        const previo = previos.find((t) => t.color === color)
        return {
          ...(previo ?? {
            id: idTemporal(),
            idempresa: IDEMPRESA,
            folio,
            bloque: "Especificacion" as const,
            color,
            created_at: new Date().toISOString(),
          }),
          orden,
          cantidades: fila,
          proporciones: proporciones.tallas,
          proporcion: sumaC > 0 ? proporciones.colores[color] ?? 1 : null,
        } as FichaTalla
      })
      return [...otros, ...nuevos]
    })
    toast.success("Reparto aplicado — presiona Guardar para conservarlo")
  }


  /** Solo en memoria: se escribe al presionar Guardar. */
  function guardarTalla(fila: FichaTalla, talla: string, valor: number) {
    const cantidades = { ...(fila.cantidades ?? {}), [talla]: valor }
    setTallas((prev) => prev.map((t) => (t.id === fila.id ? { ...t, cantidades } : t)))
  }

  /**
   * La proporcion del tendido se guarda en el PRIMER renglon del bloque:
   * es una sola por bloque, no una por color, y asi el PDF la encuentra
   * donde la espera.
   */

  // ── Materiales ────────────────────────────────────────────────────────────

  function agregarMaterial(tipo: TipoMaterialFicha) {
    if (!folio) return
    // Solo en memoria, con id temporal: se inserta al presionar Guardar.
    setMateriales((prev) => [
      ...prev,
      {
        id: idTemporal(),
        idempresa: IDEMPRESA,
        folio,
        tipo,
        orden: prev.filter((m) => m.tipo === tipo).length + 1,
        clave: null,
        descripcion: "",
        color: null,
        cantidad: 0,
        costo: 0,
        idarticulo: null,
        uso: null,
        created_at: new Date().toISOString(),
      },
    ])
  }


  /** Solo en memoria: se escribe al presionar Guardar. */
  function guardarMaterial(fila: FichaMaterial, cambios: Partial<FichaMaterial>) {
    setMateriales((prev) => prev.map((m) => (m.id === fila.id ? { ...m, ...cambios } : m)))
  }

  /** Solo en memoria: el borrado se aplica al presionar Guardar. */
  function borrarMaterial(id: number) {
    setMateriales((prev) => prev.filter((m) => m.id !== id))
    if (id > 0) setBorradosMateriales((prev) => [...prev, id])
  }

  if (!open) return null

  /**
   * Los materiales se suman desde `materiales`, el estado en memoria, y
   * NO desde `ficha.costo_tela` / `costo_habilitacion`.
   *
   * Esas dos vienen de la vista, que solo conoce lo GUARDADO: desde el
   * guardado explícito, una línea recién capturada todavía no está ahí y
   * la tabla mostraba $0.00 hasta presionar Guardar. El Costo Neto salía
   * incompleto por lo mismo.
   */
  const costoTela = materiales
    .filter((m) => m.tipo === "Tela")
    .reduce((s, m) => s + Number(m.cantidad || 0) * Number(m.costo || 0), 0)
  const costoHabilitacion = materiales
    .filter((m) => m.tipo === "Habilitacion")
    .reduce((s, m) => s + Number(m.cantidad || 0) * Number(m.costo || 0), 0)
  /**
   * Costo Neto = costo fijo + materiales + maquila + lavandería.
   *
   * Regla de operación (17-sep-2026). Los servicios externos quedan
   * fuera: se contratan por fuera y no todos los folios los llevan.
   * Ellos suman al costo TOTAL, que es otra cuenta.
   */
  const costoNeto =
    Math.round(
      (Number(ficha?.costo_fijo ?? 0) +
        costoTela +
        costoHabilitacion +
        Number(ficha?.costo_maquila ?? 0) +
        Number(ficha?.costo_lavanderia ?? 0)) *
        100,
    ) / 100

  /** Margen sobre el precio de venta, con el neto de la pantalla. */
  const margenPct =
    ficha?.precio_venta != null && Number(ficha.precio_venta) > 0
      ? Math.round(
          ((100 * (Number(ficha.precio_venta) - costoNeto)) /
            Number(ficha.precio_venta)) *
            100,
        ) / 100
      : null

  /**
   * Los costos del proceso se calculan aquí y no se leen de la vista:
   * así el total refleja lo que se acaba de teclear, antes de guardar.
   * La vista trae el mismo número una vez guardado.
   */
  const costoServicios =
    Number(ficha?.costo_estampado ?? 0) +
    Number(ficha?.costo_bordado ?? 0) +
    Number(ficha?.costo_corte_externo ?? 0) +
    Number(ficha?.costo_otro ?? 0)
  // El neto ya trae maquila y lavandería: aquí solo faltan los servicios.
  const costoTotalPieza = Math.round((costoNeto + costoServicios) * 100) / 100

  /**
   * Las piezas que realmente salieron del corte. La utilidad del pedido
   * se calcula sobre estas y no sobre las planeadas: se produce —y se
   * cobra— lo que salió, no lo que se pensaba cortar.
   */
  const piezasCortadas = tallas
    .filter((t) => t.bloque === "Cortadas")
    .reduce(
      (s, t) =>
        s + Object.values(t.cantidades ?? {}).reduce((a, b) => a + Number(b || 0), 0),
      0,
    )

  /**
   * Las piezas sobre las que se muestra el total de cada proceso.
   *
   * Se prefiere lo CORTADO cuando ya se capturó: es lo que de verdad se
   * va a mandar a maquila. Mientras el corte no exista se usa el plan,
   * que es la mejor estimación disponible.
   */
  const piezasProceso =
    piezasCortadas > 0
      ? piezasCortadas
      : (proporciones.total ?? ficha?.piezas_totales ?? null)

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
        // El papel viaja: lo que se esconde en pantalla tampoco se
        // imprime, o esconderlo no habría servido de nada.
        verCostos={verCostos}
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
              onClick={intentarSalir}
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
            {hayCambios && (
              <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                Cambios sin guardar
              </span>
            )}
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
              {/*
                Se dice por qué la ficha se ve recortada o bloqueada. Sin
                el aviso, quien no tiene el permiso piensa que la pantalla
                está rota o que los costos se perdieron, y acaba
                preguntando.

                Los dos casos van en un solo renglón: son la misma
                explicación y dos franjas seguidas harían más ruido que
                los avisos en sí.

                El bloqueo solo se menciona cuando viene del permiso de
                la ficha: quien es de solo lectura en TODO el sistema ya
                lo ve en el banner de arriba, y repetirlo aquí sería
                decirle dos veces lo mismo.
              */}
              {(!verCostos || (readOnly && !readOnlyGlobal)) && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
                  <p className="text-xs text-sky-900">
                    {!verCostos && readOnly && !readOnlyGlobal
                      ? "Ves la ficha en modo consulta y sin la información de costos."
                      : !verCostos
                        ? "Ves la ficha sin la información de costos."
                        : "Ves la ficha en modo consulta: no puedes modificar sus campos."}{" "}
                    <span className="text-sky-700">
                      Es por tus permisos; pídeselos a un administrador si
                      los necesitas.
                    </span>
                  </p>
                </div>
              )}

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
                  {/*
                    Se rotula "Cliente" aunque la columna siga siendo
                    `marca`: es como lo llaman en la operación. Renombrar
                    la columna obligaría a tocar la vista y la ficha
                    impresa sin ganar nada.

                    OJO: no es el cliente del catálogo —ese es
                    `idcliente` y se elige al crear el pedido—; aquí se
                    escribe la marca bajo la que se vende la prenda.
                  */}
                  <Campo label="Cliente" value={ficha.marca} readOnly={readOnly}
                    onChange={(v) => campo("marca", v)} />
                  <Campo label="Compradora" value={ficha.compradora} readOnly={readOnly}
                    onChange={(v) => campo("compradora", v)} />
                  <Campo label="Núm. Pedido" value={ficha.num_pedido} readOnly={readOnly}
                    onChange={(v) => campo("num_pedido", v)} />
                  <Campo label="Modelo Interno" value={ficha.modelo} readOnly disabled
                    onChange={() => {}} />
                  <Campo label="Modelo Cliente" value={ficha.modelo_cliente} readOnly={readOnly}
                    onChange={(v) => campo("modelo_cliente", v)} />

                  {/*
                    Las dos fechas del pedido, juntas y arriba. Antes la de
                    confirmacion estaba al final de la franja de costeo, donde
                    quedaba fuera de la vista en pantallas angostas y separada
                    de su pareja natural. En el PDF siempre fueron juntas.
                  */}
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
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Fecha cancelación
                    </label>
                    <div className="mt-1 flex h-8 items-center rounded-md border border-border bg-muted/50 px-3 text-sm">
                      {ficha.fecha_cancelacion
                        ? fmtFechaCorta(ficha.fecha_cancelacion)
                        : "—"}
                    </div>
                  </div>
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

              {/*
                La Especificacion de Talla ya no se captura: sale del
                reparto de arriba, que escribe ese bloque. Mostrar el
                mismo dato dos veces, uno editable y otro calculado,
                invitaba a que se contradijeran.

                Piezas Cortadas si se queda: es el RESULTADO real del
                corte. Nace en blanco con los mismos colores y tallas del
                plan, y se llena mas adelante desde Corte.
              */}
              {/*
                Espejo del reparto: mismas filas y columnas, celdas en
                blanco. Las filas no se capturan aqui —salen del plan— para
                que cada casilla caiga en la misma posicion que su
                contraparte planeada.
              */}
              <FichaResultadoCorte
                plan={matrizPlan}
                real={matrizCorte}
                columnas={columnasTalla}
                readOnly={readOnly}
                onCambiar={capturarCorte}
              />

              {/*
                Toda la franja de costeo cuelga del permiso: sin el,
                la ficha se queda en la version simplificada —proceso,
                tallas y materiales— que es justo lo que se pidio.

                Se ESCONDE en vez de mostrarse bloqueada: un campo
                deshabilitado sigue enseñando el numero, que es
                precisamente lo que no debe verse.
              */}
              {verCostos && (
                <>
                {/* ── Costos ── */}
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Costos y precios</h3>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <CampoNum label="Costo Fijo" value={ficha.costo_fijo} readOnly={readOnly}
                      onChange={(v) => campo("costo_fijo", v)} />
                    <Derivado label="Costo Neto" value={costoNeto} />
                    <CampoNum label="Precio Venta" value={ficha.precio_venta} readOnly={readOnly}
                      onChange={(v) => campo("precio_venta", v)} />
                    <Derivado label="Margen %" value={margenPct} sufijo="%" />
                    <CampoNum label="Precio Público" value={ficha.precio_publico} readOnly={readOnly}
                      onChange={(v) => campo("precio_publico", v)} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium">Costo Neto</span> y{" "}
                    <span className="font-medium">Margen</span> se calculan solos; los
                    demás se capturan aquí. El desglose completo está al final, ya
                    con las telas y habilitaciones capturadas.
                  </p>

                  {/*
                    Los costos del proceso, en su propia franja y despues del
                    desglose. Maquila y lavanderia SI entran al Costo Neto
                    —decision de operacion, script 069—; los cuatro servicios
                    externos no. Por eso van juntos pero separados dentro de
                    la tabla: es la misma clase de dato, con distinto efecto
                    en el costeo.

                    Es el mismo dato que usa Pago Maquilas, no una copia:
                    lo que se capture aqui es lo que ahi se paga.
                  */}
                  <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold">Costos del proceso</p>
                      <p className="text-[11px] text-muted-foreground">
                        Es el mismo dato de Pago Maquilas
                      </p>
                    </div>
                    {/*
                      El maquilero ya NO se elige aqui: la fila "Maquila"
                      de la tabla de abajo tiene su propio selector y
                      escribe el mismo `idmaquilero`. Tener los dos era
                      capturar el mismo dato dos veces en una pantalla.

                      El aviso del Excel SI se queda: 219 ordenes traen un
                      nombre de maquilero pero solo 167 estan ligadas al
                      catalogo. Sin el aviso, esas 52 parecerian no tener
                      maquilero cuando si lo traen escrito.
                    */}
                    {ficha.idmaquilero == null && ficha.maquilero && (
                      <p className="mb-2 text-[11px] text-amber-700">
                        Maquilero del Excel:{" "}
                        <span className="font-medium">{ficha.maquilero}</span>
                        {" — no está en el catálogo, eligelo abajo"}
                      </p>
                    )}

                    {/*
                      Los cinco procesos, en lista hacia abajo como la
                      composicion de tela: proceso, quien lo hace y cuanto
                      cuesta, uno debajo de otro. En rejilla habia que saltar
                      entre tarjetas para comparar dos costos.

                      Maquila y lavanderia entran al Costo Neto; los cuatro de
                      abajo son servicios externos y van aparte: se contratan
                      por fuera y no todos los folios los llevan. Hoy esos
                      cuatro estan vacios en las 637 ordenes, el Excel nunca
                      los trajo y esta es la primera captura.
                    */}
                    <div className="overflow-hidden rounded-lg border border-border bg-background">
                      <table className="w-full">
                        <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Proceso</th>
                            <th className="px-1 py-1.5 font-medium">
                              ¿Quién lo hace?
                            </th>
                            <th className="px-1 py-1.5 text-right font-medium">
                              Costo por pieza
                            </th>
                            <th className="px-3 py-1.5 text-right font-medium">
                              Total del pedido
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <FilaProceso
                            label="Maquila"
                            costo={ficha.costo_maquila ?? null}
                            idmaquilero={ficha.idmaquilero ?? null}
                            maquileros={maquileros}
                            piezas={piezasProceso}
                            readOnly={readOnly}
                            onCosto={(v) => campo("costo_maquila", v)}
                            onMaquilero={(v) =>
                              setFicha((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      idmaquilero: v,
                                      maquilero:
                                        maquileros.find((m) => m.id === v)?.nombre ??
                                        (v == null ? null : prev.maquilero),
                                    }
                                  : prev,
                              )
                            }
                          />
                          <FilaProceso
                            label="Lavandería"
                            costo={ficha.costo_lavanderia ?? null}
                            idmaquilero={ficha.idmaquilero_lavanderia ?? null}
                            maquileros={maquileros}
                            piezas={piezasProceso}
                            readOnly={readOnly}
                            onCosto={(v) => campo("costo_lavanderia", v)}
                            onMaquilero={(v) => campo("idmaquilero_lavanderia", v)}
                          />
                          {/* Los servicios externos, bajo su propio encabezado */}
                          <tr className="border-t border-border bg-muted/40">
                            <td
                              className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                              colSpan={4}
                            >
                              Servicios externos — no entran al Costo Neto
                            </td>
                          </tr>
                          <FilaProceso
                            label="Estampado"
                            costo={ficha.costo_estampado ?? null}
                            idmaquilero={ficha.idmaquilero_estampado ?? null}
                            maquileros={maquileros}
                            piezas={piezasProceso}
                            readOnly={readOnly}
                            onCosto={(v) => campo("costo_estampado", v)}
                            onMaquilero={(v) => campo("idmaquilero_estampado", v)}
                          />
                          <FilaProceso
                            label="Bordado"
                            costo={ficha.costo_bordado ?? null}
                            idmaquilero={ficha.idmaquilero_bordado ?? null}
                            maquileros={maquileros}
                            piezas={piezasProceso}
                            readOnly={readOnly}
                            onCosto={(v) => campo("costo_bordado", v)}
                            onMaquilero={(v) => campo("idmaquilero_bordado", v)}
                          />
                          <FilaProceso
                            label="Corte externo"
                            costo={ficha.costo_corte_externo ?? null}
                            idmaquilero={ficha.idmaquilero_corte_externo ?? null}
                            maquileros={maquileros}
                            piezas={piezasProceso}
                            readOnly={readOnly}
                            onCosto={(v) => campo("costo_corte_externo", v)}
                            onMaquilero={(v) => campo("idmaquilero_corte_externo", v)}
                          />
                          <FilaProceso
                            label="Otros"
                            costo={ficha.costo_otro ?? null}
                            idmaquilero={ficha.idmaquilero_otro ?? null}
                            maquileros={maquileros}
                            piezas={piezasProceso}
                            readOnly={readOnly}
                            onCosto={(v) => campo("costo_otro", v)}
                            onMaquilero={(v) => campo("idmaquilero_otro", v)}
                          />
                        </tbody>
                      </table>
                    </div>
                    {/*
                      El maquilero principal SI se usa: Pago Maquilas agrupa
                      por el. Los de cada servicio todavia no —el calculo del
                      pago los toma todos del principal—, y decirlo evita que
                      alguien espere ver ahi un pago separado.
                    */}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      El total del pedido usa{" "}
                      {piezasCortadas > 0 ? "las piezas cortadas" : "las piezas del plan"}.
                      El responsable de cada servicio es informativo por ahora; más
                      adelante servirá para pagarle a cada quien lo suyo.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Derivado label="Costo total por pieza" value={costoTotalPieza} />
                      {ficha.precio_venta != null && Number(ficha.precio_venta) > 0 && (
                        <Derivado
                          label="Utilidad unitaria"
                          value={Number(ficha.precio_venta) - costoTotalPieza}
                        />
                      )}
                    </div>
                  </div>
                </section>
                </>
              )}

              {/* ── Materiales ── */}
              <CuadroMateriales
                titulo="Composición de Tela"
                filas={telas}
                readOnly={readOnly}
                verCostos={verCostos}
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
                verCostos={verCostos}
                catalogoTelas={catalogoHab}
                onAgregar={() => agregarMaterial("Habilitacion")}
                onCambiar={guardarMaterial}
                onBorrar={borrarMaterial}
              />

              {/*
                El costeo va al FINAL, no arriba con los precios: ahi el
                desglose mostraba tela $0.00 y habilitacion $0.00 porque
                esos cuadros todavia no se habian capturado, y quien leia
                no entendia de donde salia el Costo Neto.
              */}
              {verCostos && (
                <FichaResumenCostos
                  ficha={ficha}
                  costoTela={costoTela}
                  costoHabilitacion={costoHabilitacion}
                  costoNeto={costoNeto}
                  costoServicios={costoServicios}
                  costoTotalPieza={costoTotalPieza}
                  piezasCortadas={piezasCortadas}
                  piezasPlan={proporciones.total ?? ficha.piezas_totales ?? null}
                />
              )}

              {/*
                Los codigos EAN, al final de la ficha.

                Un EAN identifica un SKU —color y talla—, no un folio
                entero, asi que va como matriz. Las filas y columnas
                salen del reparto, igual que el resultado de corte, para
                que cada codigo caiga en la posicion de su prenda.

                Va de ultimo a proposito: es dato del cliente que se
                copia de un listado, no se decide aqui. Lo que se
                captura pensando —tallas, corte, materiales, costos— va
                primero; esto se teclea al cerrar.
              */}
              <FichaEanMatriz
                colores={Object.keys(matrizPlan)}
                columnas={columnasTalla}
                valores={matrizEan}
                readOnly={readOnly}
                onCambiar={capturarEan}
              />
            </div>
          </div>
        )}
      </div>

      {/*
        Salir con cambios sin guardar. Tres salidas, como pidio operacion:
        guardar y salir, descartar y salir, o seguir editando.

        Descartar no borra nada de la base: lo tecleado solo vivia en
        memoria, asi que basta con cerrar.
      */}
      {confirmarSalida && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="text-base font-semibold">Hay cambios sin guardar</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Si sales sin guardar, la ficha queda como estaba antes de tus
              cambios.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button
                disabled={guardando}
                onClick={async () => {
                  await guardar()
                  setConfirmarSalida(false)
                  onOpenChange(false)
                }}
              >
                {guardando && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Guardar cambios y salir
              </Button>
              <Button
                variant="outline"
                disabled={guardando}
                onClick={() => {
                  setConfirmarSalida(false)
                  onOpenChange(false)
                }}
              >
                Descartar cambios y salir
              </Button>
              <Button
                variant="ghost"
                disabled={guardando}
                onClick={() => setConfirmarSalida(false)}
              >
                Seguir editando
              </Button>
            </div>
          </div>
        </div>
      )}
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
        className="mt-1 h-8 text-sm sin-flechas"
      />
    </div>
  )
}


/**
 * Un proceso del folio: cuánto cuesta por pieza y quién lo hace.
 *
 * Los dos juntos porque son el mismo hecho —"a fulano le pagamos X por
 * pieza de estampado"— y separarlos obligaría a cruzar dos listas para
 * leerlo. Hoy el responsable es informativo; más adelante cada uno
 * cobrará lo suyo.
 */
/**
 * Un proceso del folio, como renglon de tabla.
 *
 * EN LISTA Y NO EN TARJETAS:
 *   Antes eran cinco tarjetas en rejilla. En lista se leen en columna
 *   —proceso, quien lo hace, cuanto cuesta— igual que la composicion de
 *   tela, y comparar los costos entre si es inmediato.
 *
 * LOS CINCO SON FIJOS, A PROPOSITO:
 *   Pago Maquilas los tiene por nombre y sobre ellos calcula piezas
 *   enviadas, recibidas, merma y lo que se paga. Una lista libre donde
 *   se agregaran procesos nuevos no encajaria ahi sin reescribir el
 *   calculo del dinero. Decision de operacion (22-sep-2026): por ahora
 *   solo cambia como se ven.
 */
function FilaProceso({
  label,
  costo,
  idmaquilero,
  maquileros,
  piezas,
  readOnly,
  onCosto,
  onMaquilero,
}: {
  label: string
  costo: number | null
  idmaquilero: number | null
  maquileros: { id: number; nombre: string }[]
  /** Piezas del pedido, para mostrar lo que suma el proceso completo. */
  piezas: number | null
  readOnly: boolean
  onCosto: (v: number | null) => void
  onMaquilero: (v: number | null) => void
}) {
  const total =
    costo != null && piezas != null && piezas > 0 ? costo * piezas : null
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1.5 text-sm font-medium">{label}</td>
      <td className="px-1 py-1">
        <select
          disabled={readOnly}
          value={idmaquilero ?? ""}
          onChange={(e) =>
            onMaquilero(e.target.value === "" ? null : Number(e.target.value))
          }
          className="h-7 w-full rounded-md border border-input bg-transparent px-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Sin asignar</option>
          {maquileros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1 py-1">
        <Input
          type="number"
          min="0"
          step="0.01"
          disabled={readOnly}
          value={costo ?? ""}
          onChange={(e) => onCosto(e.target.value === "" ? null : Number(e.target.value))}
          placeholder="0.00"
          className="sin-flechas h-7 w-full text-right text-sm tabular-nums"
        />
      </td>
      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
        {total != null ? `$${total.toFixed(2)}` : "—"}
      </td>
    </tr>
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

function CuadroMateriales({
  titulo, filas, readOnly, verCostos, esTela, catalogoTelas, usosSugeridos,
  onAgregar, onCambiar, onBorrar,
}: {
  titulo: string
  filas: FichaMaterial[]
  readOnly: boolean
  /**
   * Sin permiso de costos se ocultan las columnas de costo y total, y
   * el pie con la suma. La cantidad SI se ve: es dato de produccion
   * —cuanta tela lleva la prenda— y no dice lo que vale.
   */
  verCostos: boolean
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
  /**
   * Las columnas de la tabla, que cambian con el permiso y con el tipo.
   * Se cuentan aqui porque los `colSpan` del pie y de los renglones
   * vacios tienen que cuadrar con ellas: un colSpan corto parte la
   * tabla en dos visualmente.
   */
  const columnas = 4 + (esTela ? 1 : 0) + (verCostos ? 2 : 0)
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
              {/* Ancho fijo para que el encabezado caiga sobre su campo */}
              <th className="w-[110px] px-2 py-1.5 text-right font-medium">Cantidad</th>
              {verCostos && (
                <th className="w-[110px] px-2 py-1.5 text-right font-medium">Costo</th>
              )}
              {verCostos && (
                <th className="w-[100px] px-2 py-1.5 text-right font-medium">Total</th>
              )}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
                <tr key={f.id} className="border-t border-border">
                  <td className="px-1 py-1">
                    {/*
                      Buscador en los dos cuadros: telas (756) y
                      habilitaciones (927). Si el catalogo no cargo, cae a
                      texto libre para no bloquear la captura.
                    */}
                    {(catalogoTelas?.length ?? 0) > 0 ? (
                      <BuscadorTela
                        valor={f.clave}
                        telas={catalogoTelas ?? []}
                        disabled={readOnly}
                        onSelect={(art, claveManual) =>
                          // Al elegir del catálogo se traen también nombre y
                          // costo: son el dato bueno, y retecleárlos solo
                          // introduce diferencias con Inventarios.
                          //
                          // Los campos de la fila usan `value` y no
                          // `defaultValue` justamente por esto: con
                          // defaultValue el costo cambiaba en memoria pero el
                          // input seguía mostrando el viejo.
                          onCambiar(f, {
                            clave: claveManual || null,
                            idarticulo: art?.id ?? null,
                            descripcion: art?.nombre ?? f.descripcion,
                            costo: art?.costo_unitario ?? f.costo,
                          })
                        }
                      />
                    ) : (
                      <Input disabled={readOnly} value={f.clave ?? ""}
                        onChange={(e) => onCambiar(f, { clave: e.target.value })}
                        className="h-7 min-w-[130px] text-xs" />
                    )}
                  </td>
                  {esTela && (
                    <td className="px-1 py-1">
                      <Input
                        disabled={readOnly}
                        value={f.uso ?? ""}
                        onChange={(e) =>
                          onCambiar(f, { uso: e.target.value.toUpperCase() || null })
                        }
                        placeholder="Forro, entretela…"
                        list="usos-tela"
                        className="h-7 min-w-[110px] text-xs"
                      />
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <Input disabled={readOnly} value={f.descripcion ?? ""}
                      onChange={(e) => onCambiar(f, { descripcion: e.target.value })}
                      className="h-7 min-w-[220px] text-xs" />
                  </td>
                  <td className="px-1 py-1">
                    <Input type="number" step="0.0001" min="0" disabled={readOnly}
                      value={f.cantidad ?? 0}
                      onChange={(e) => onCambiar(f, { cantidad: Number(e.target.value) || 0 })}
                      className="h-7 w-full text-right text-xs tabular-nums sin-flechas" />
                  </td>
                  {verCostos && (
                    <td className="px-1 py-1">
                      <Input type="number" step="0.0001" min="0" disabled={readOnly}
                        value={f.costo ?? 0}
                        onChange={(e) => onCambiar(f, { costo: Number(e.target.value) || 0 })}
                        className="h-7 w-full text-right text-xs tabular-nums sin-flechas" />
                    </td>
                  )}
                  {verCostos && (
                    <td className="px-2 py-1 text-right text-xs tabular-nums">
                      ${(Number(f.cantidad || 0) * Number(f.costo || 0)).toFixed(2)}
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <Button size="sm" variant="ghost" className="size-7 p-0"
                      disabled={readOnly} onClick={() => onBorrar(f.id)}>
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            {/*
              Hasta completar 7 renglones. Son visuales: no se escriben
              filas vacias en la base, que dejarian basura si nadie las
              llena. Al hacer clic se da de alta la linea de verdad.
            */}
            {Array.from({ length: Math.max(0, 7 - filas.length) }).map((_, i) => (
              <tr
                key={`vacia-${i}`}
                className="border-t border-border"
                onClick={() => !readOnly && onAgregar()}
              >
                <td
                  colSpan={columnas}
                  className="cursor-text px-3 py-2 text-xs text-muted-foreground/40 hover:bg-muted/30"
                >
                  {i === 0 && filas.length === 0
                    ? "Haz clic para capturar la primera línea"
                    : " "}
                </td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && verCostos && (
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

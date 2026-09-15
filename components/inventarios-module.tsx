"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Boxes,
  Check,
  Loader2,
  Package,
  Pencil,
  Plus,
  QrCode,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  Truck,
  X as XIcon,
} from "lucide-react"
import { format } from "date-fns"
import * as XLSX from "xlsx"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { fmtCurrency } from "@/lib/format"
import { parseLocalDate } from "@/lib/risk"
import { cn } from "@/lib/utils"
import {
  ACABADOS_TELA,
  type Articulo,
  type Proveedor,
  type TipoArticulo,
  type VwInventarioArticulo,
  type VwInventarioMovimiento,
  type VwInventarioRollo,
} from "@/lib/types"

import { KpiCard } from "@/components/kpi-card"
import { EtiquetasRollosDialog } from "@/components/etiquetas-rollos-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: unknown) => Number(v ?? 0)
const hoyISO = () => format(new Date(), "yyyy-MM-dd")

function fmtFecha(iso: string | null | undefined) {
  const d = parseLocalDate(iso)
  return d ? format(d, "dd/MMM/yyyy") : "—"
}

/** Cantidades con hasta 3 decimales, sin ceros de relleno. */
function fmtCant(n: number): string {
  return Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 })
}

const UNIDADES = ["Metros", "Piezas", "Kilos", "Rollos", "Conos", "Cajas", "Juegos"]

// ─── Módulo ──────────────────────────────────────────────────────────────────

/**
 * Inventarios de habilitaciones (insumos) y telas.
 *
 * La existencia NO se guarda: se deriva de ingresos menos salidas, en las
 * vistas. Un total almacenado se desincroniza en cuanto alguien corrige un
 * ingreso, y nadie se entera hasta el conteo físico.
 *
 * Las telas se manejan por ROLLO: una recepción de 100 m se reparte en
 * rollos con su código, y cada uno lleva su propio saldo.
 */
export function InventariosModule({ configMissing }: { configMissing: boolean }) {
  const [articulos, setArticulos] = useState<VwInventarioArticulo[]>([])
  const [rollos, setRollos] = useState<VwInventarioRollo[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [movimientos, setMovimientos] = useState<VwInventarioMovimiento[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTodo = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)

    const [art, rol, prov, mov] = await Promise.all([
      fetchAll<VwInventarioArticulo>(() =>
        supabase
          .from("vw_inventario_articulos")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("tipo")
          .order("clave"),
      ),
      fetchAll<VwInventarioRollo>(() =>
        supabase
          .from("vw_inventario_rollos")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("codigo"),
      ),
      fetchAll<Proveedor>(() =>
        supabase
          .from("proveedores")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("nombre"),
      ),
      fetchAll<VwInventarioMovimiento>(() =>
        supabase
          .from("vw_inventario_movimientos")
          .select("*")
          .eq("idempresa", IDEMPRESA)
          .order("fecha", { ascending: false })
          .order("created_at", { ascending: false }),
      ),
    ])

    setLoading(false)
    if (art.error) {
      setError(art.error.message)
      return
    }
    setArticulos(art.data)
    setRollos(rol.data)
    setProveedores(prov.data)
    setMovimientos(mov.data)
  }, [configMissing])

  useEffect(() => {
    fetchTodo()
  }, [fetchTodo])

  return (
    <section className="glass rounded-2xl border border-border/60 p-6 shadow-xl shadow-black/5">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-teal-100 ring-1 ring-teal-200">
          <Boxes className="size-4 text-teal-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Inventarios</h2>
          <p className="text-xs text-muted-foreground">
            Habilitaciones y telas · la existencia se deriva de los movimientos
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTodo}
          disabled={loading}
          className="ml-auto h-9 gap-1.5"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Tabs defaultValue="saldos" className="w-full">
        <TabsList>
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="habilitaciones">Habilitaciones</TabsTrigger>
          <TabsTrigger value="telas">Telas</TabsTrigger>
          <TabsTrigger value="rollos">Rollos</TabsTrigger>
          <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="proveedores">Proveedores</TabsTrigger>
        </TabsList>

        <TabsContent value="saldos" className="mt-5">
          <SaldosTab articulos={articulos} loading={loading} />
        </TabsContent>

        <TabsContent value="habilitaciones" className="mt-5">
          <ArticulosTab
            tipo="Habilitación"
            articulos={articulos.filter((a) => a.tipo === "Habilitación")}
            proveedores={proveedores}
            loading={loading}
            onRefresh={fetchTodo}
          />
        </TabsContent>

        <TabsContent value="telas" className="mt-5">
          <ArticulosTab
            tipo="Tela"
            articulos={articulos.filter((a) => a.tipo === "Tela")}
            proveedores={proveedores}
            loading={loading}
            onRefresh={fetchTodo}
          />
        </TabsContent>

        <TabsContent value="rollos" className="mt-5">
          <RollosTab rollos={rollos} loading={loading} onRefresh={fetchTodo} />
        </TabsContent>

        <TabsContent value="ingresos" className="mt-5">
          <IngresosTab
            articulos={articulos}
            proveedores={proveedores}
            loading={loading}
            onRefresh={fetchTodo}
          />
        </TabsContent>

        <TabsContent value="movimientos" className="mt-5">
          <MovimientosTab movimientos={movimientos} loading={loading} />
        </TabsContent>

        <TabsContent value="proveedores" className="mt-5">
          <ProveedoresTab
            proveedores={proveedores}
            articulos={articulos}
            onRefresh={fetchTodo}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ─── Artículos ───────────────────────────────────────────────────────────────

function ArticulosTab({
  tipo,
  articulos,
  proveedores,
  loading,
  onRefresh,
}: {
  tipo: TipoArticulo
  articulos: VwInventarioArticulo[]
  proveedores: Proveedor[]
  loading: boolean
  onRefresh: () => void
}) {
  const readOnly = useReadOnly()
  const [search, setSearch] = useState("")
  const [soloBajos, setSoloBajos] = useState(false)
  const [editando, setEditando] = useState<Articulo | null>(null)
  const [creando, setCreando] = useState(false)

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return articulos.filter((a) => {
      if (soloBajos && !a.bajo_minimo) return false
      if (
        q &&
        !`${a.clave} ${a.nombre} ${a.proveedor ?? ""} ${a.tela_familia ?? ""} ${
          a.categoria ?? ""
        } ${a.color ?? a.tela_color ?? ""} ${a.material ?? ""} ${a.descripcion ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false
      return true
    })
  }, [articulos, search, soloBajos])

  const kpis = useMemo(() => {
    let valor = 0
    let bajos = 0
    for (const a of filtrados) {
      valor += num(a.existencia) * num(a.costo_promedio ?? a.costo_unitario)
      if (a.bajo_minimo) bajos++
    }
    return { valor, bajos, total: filtrados.length }
  }, [filtrados])

  const esTela = tipo === "Tela"

  // Las familias/categorias ya usadas, para sugerirlas en el formulario en
  // vez de teclearlas de nuevo y acabar con "BOTON" y "BOTON" como dos tipos.
  const categorias = useMemo(() => {
    const vistas = new Set<string>()
    for (const a of articulos) {
      const v = esTela ? a.tela_familia : a.categoria
      if (v) vistas.add(v)
    }
    return [...vistas].sort()
  }, [articulos, esTela])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label={esTela ? "Telas" : "Habilitaciones"}
          value={kpis.total}
          icon={esTela ? <Scissors className="size-3.5" /> : <Package className="size-3.5" />}
          iconBg="bg-teal-100 ring-teal-200"
          iconColor="text-teal-600"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Valor del inventario"
          value={kpis.valor}
          format={fmtCurrency}
          icon={<Boxes className="size-3.5" />}
          iconBg="bg-sky-100 ring-sky-200"
          iconColor="text-sky-600"
          valueColor="text-sky-700"
          hint="Al costo real de compra"
        />
        <KpiCard
          label="Bajo mínimo"
          value={kpis.bajos}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={kpis.bajos > 0 ? "text-amber-600" : "text-foreground"}
          hint="Hay que reponer"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Clave, nombre o proveedor…"
            className="h-9 w-64 pl-8"
          />
        </div>
        <Button
          size="sm"
          variant={soloBajos ? "default" : "outline"}
          onClick={() => setSoloBajos(!soloBajos)}
          className="h-9"
        >
          {soloBajos ? "Solo bajo mínimo" : "Todos"}
        </Button>
        {!readOnly && (
          <Button size="sm" onClick={() => setCreando(true)} className="ml-auto h-9 gap-1.5">
            <Plus className="size-3.5" />
            Nuevo artículo
          </Button>
        )}
      </div>

      {/*
        Alto fijo con scroll y encabezado pegajoso: con 1,683 articulos
        cargados la tabla crecia hasta empujar el pie de pagina fuera de
        la vista. `overflow-auto` en el hijo y no en el padre para que el
        sticky del encabezado tenga contra que pegarse.
      */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead className="font-semibold">Clave</TableHead>
              <TableHead className="font-semibold">Nombre</TableHead>
              <TableHead className="font-semibold">
                {esTela ? "Familia / Acabado" : "Categoría"}
              </TableHead>
              <TableHead className="font-semibold">Unidad</TableHead>
              <TableHead className="font-semibold">Proveedor</TableHead>
              <TableHead className="text-right font-semibold">Costo unitario</TableHead>
              <TableHead className="text-right font-semibold">Existencia</TableHead>
              {esTela && <TableHead className="text-right font-semibold">Rollos</TableHead>}
              <TableHead className="text-right font-semibold">Valor</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: esTela ? 10 : 9 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={esTela ? 10 : 9}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {articulos.length === 0
                    ? `Todavía no hay ${esTela ? "telas" : "habilitaciones"} registradas.`
                    : "Sin resultados para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((a) => {
                const costo = num(a.costo_promedio ?? a.costo_unitario)
                return (
                  <TableRow key={a.id} className={cn("hover:bg-muted/30", !a.activo && "opacity-50")}>
                    <TableCell className="font-mono text-xs font-semibold">{a.clave}</TableCell>
                    <TableCell className="text-sm">{a.nombre}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {esTela ? (
                        a.tela_familia ? (
                          <>
                            {a.tela_familia}
                            {a.tela_acabado && (
                              <span className="ml-1 opacity-70">· {a.tela_acabado}</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )
                      ) : (
                        a.categoria ?? "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.unidad_medida}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.proveedor ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {costo > 0 ? fmtCurrency(costo) : <span className="text-amber-600">Sin costo</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <span className={cn("font-semibold", a.bajo_minimo && "text-amber-600")}>
                        {fmtCant(num(a.existencia))}
                      </span>
                      {a.stock_minimo != null && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          / mín {fmtCant(num(a.stock_minimo))}
                        </span>
                      )}
                    </TableCell>
                    {esTela && (
                      <TableCell className="text-right text-sm tabular-nums">
                        {a.rollos > 0 ? (
                          <span title={`${a.rollos_disponibles} con tela disponible`}>
                            {a.rollos_disponibles} / {a.rollos}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {fmtCurrency(num(a.existencia) * costo)}
                    </TableCell>
                    <TableCell>
                      {!readOnly && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setEditando(a)}
                          title="Editar artículo"
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
          {filtrados.length > 0 && (
            <TableFooter>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={esTela ? 8 : 7} className="text-sm font-semibold">
                  Total · {filtrados.length} artículos
                </TableCell>
                <TableCell className="text-right text-sm font-bold tabular-nums">
                  {fmtCurrency(kpis.valor)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      </div>

      {(creando || editando) && (
        <ArticuloDialog
          tipo={tipo}
          articulo={editando}
          proveedores={proveedores}
          categorias={categorias}
          onClose={() => {
            setCreando(false)
            setEditando(null)
          }}
          onSaved={() => {
            setCreando(false)
            setEditando(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

// ─── Alta y edición de artículo ──────────────────────────────────────────────

/**
 * Alta y edición de un artículo del maestro.
 *
 * Edita TODOS los campos del catálogo, no solo los básicos: las cargas
 * oficiales (scripts 058 y 059) trajeron familia, acabado, composición,
 * categoría, material y medida, y sin esto no habría forma de corregir
 * un dato mal capturado en el archivo de origen.
 *
 * El formulario cambia según el tipo, porque una tela y un botón no
 * describen lo mismo: la tela tiene composición y acabado; la
 * habilitación, categoría y material.
 *
 * Los atributos propios de cada habilitación (#Hoyos, Talla,
 * Departamento) se editan como pares clave-valor: son ~60 distintos
 * repartidos en 38 categorías, así que un formulario fijo no los
 * cubriría. Las claves que empiezan con "_" las puso la carga para
 * rastrear de dónde salió un precio y se muestran aparte, en solo
 * lectura: son procedencia del dato, no atributos del producto.
 */
function ArticuloDialog({
  tipo,
  articulo,
  proveedores,
  categorias,
  onClose,
  onSaved,
}: {
  tipo: TipoArticulo
  articulo: Articulo | null
  proveedores: Proveedor[]
  /** Las categorías ya usadas, para sugerir en vez de teclear de nuevo. */
  categorias: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const esTela = tipo === "Tela"

  // Comunes
  const [clave, setClave] = useState(articulo?.clave ?? "")
  const [nombre, setNombre] = useState(articulo?.nombre ?? "")
  const [unidad, setUnidad] = useState(
    articulo?.unidad_medida ?? (esTela ? "Metros" : "Piezas"),
  )
  const [costo, setCosto] = useState(articulo?.costo_unitario?.toString() ?? "")
  const [idproveedor, setIdproveedor] = useState(
    articulo?.idproveedor ? String(articulo.idproveedor) : "__none__",
  )
  const [minimo, setMinimo] = useState(articulo?.stock_minimo?.toString() ?? "")
  const [descripcion, setDescripcion] = useState(articulo?.descripcion ?? "")
  const [claveProv, setClaveProv] = useState(articulo?.clave_proveedor ?? "")
  const [activo, setActivo] = useState(articulo?.activo ?? true)

  // Telas
  const [telaFamilia, setTelaFamilia] = useState(articulo?.tela_familia ?? "")
  const [telaAcabado, setTelaAcabado] = useState<string>(articulo?.tela_acabado ?? "__none__")
  const [telaNombre, setTelaNombre] = useState(articulo?.tela_nombre ?? "")
  const [telaColor, setTelaColor] = useState(articulo?.tela_color ?? "")
  const [telaComposicion, setTelaComposicion] = useState(articulo?.tela_composicion ?? "")

  // Habilitaciones
  const [categoria, setCategoria] = useState(articulo?.categoria ?? "")
  const [material, setMaterial] = useState(articulo?.material ?? "")
  const [color, setColor] = useState(articulo?.color ?? "")
  const [medida, setMedida] = useState(articulo?.medida ?? "")

  // Los atributos propios, como lista editable de pares.
  const [atributos, setAtributos] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(articulo?.atributos ?? {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => ({ k, v: String(v) })),
  )
  /** Procedencia del precio que puso la carga. Se conserva, no se edita. */
  const metadatos = Object.entries(articulo?.atributos ?? {}).filter(([k]) =>
    k.startsWith("_"),
  )

  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (!clave.trim() || !nombre.trim()) {
      toast.error("La clave y el nombre son obligatorios")
      return
    }
    if (costo.trim() !== "" && Number(costo) < 0) {
      toast.error("El costo no puede ser negativo")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)

    // Los atributos con clave vacía se descartan; los metadatos de
    // procedencia se conservan tal como estaban.
    const attrs: Record<string, string | number> = {}
    for (const [k, v] of metadatos) attrs[k] = v as string | number
    for (const { k, v } of atributos) {
      const limpia = k.trim()
      if (!limpia || limpia.startsWith("_")) continue
      const n = Number(v)
      attrs[limpia] = v.trim() !== "" && !Number.isNaN(n) ? n : v
    }

    const payload: Record<string, unknown> = {
      idempresa: IDEMPRESA,
      tipo,
      clave: clave.trim().toUpperCase(),
      nombre: nombre.trim(),
      unidad_medida: unidad,
      costo_unitario: costo.trim() === "" ? null : Number(costo),
      idproveedor: idproveedor === "__none__" ? null : Number(idproveedor),
      stock_minimo: minimo.trim() === "" ? null : Number(minimo),
      descripcion: descripcion.trim() || null,
      clave_proveedor: claveProv.trim() || null,
      activo,
      // El tipo contrario se limpia: si un artículo se reclasifica de tela
      // a habilitación, dejar los campos del otro tipo lo haría aparecer
      // en búsquedas donde ya no pertenece.
      ...(esTela
        ? {
            tela_familia: telaFamilia.trim().toUpperCase() || null,
            tela_acabado: telaAcabado === "__none__" ? null : telaAcabado,
            tela_nombre: telaNombre.trim().toUpperCase() || null,
            tela_color: telaColor.trim().toUpperCase() || null,
            tela_composicion: telaComposicion.trim() || null,
            categoria: null,
            material: null,
            color: null,
            medida: null,
            atributos: {},
          }
        : {
            categoria: categoria.trim().toUpperCase() || null,
            material: material.trim().toUpperCase() || null,
            color: color.trim().toUpperCase() || null,
            medida: medida.trim() || null,
            atributos: attrs,
            tela_familia: null,
            tela_acabado: null,
            tela_nombre: null,
            tela_color: null,
            tela_composicion: null,
          }),
    }

    const { error } = articulo
      ? await supabase.from("articulos").update(payload).eq("id", articulo.id)
      : await supabase.from("articulos").insert(payload)
    setGuardando(false)
    if (error) {
      toast.error("No se pudo guardar", {
        description: error.message.includes("ux_articulos")
          ? "Ya existe un artículo con esa clave."
          : error.message,
      })
      return
    }
    toast.success(articulo ? "Artículo actualizado" : "Artículo creado")
    onSaved()
  }

  return (
    <FormOverlay
      titulo={articulo ? `Editar ${articulo.clave}` : `Nueva ${tipo.toLowerCase()}`}
      onClose={onClose}
      onGuardar={guardar}
      guardando={guardando}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Clave (código)">
          <Input
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder={esTela ? "MEZ-RIG-PRA-NEG-DUG-004" : "BOTCUECAF216-001"}
            className="h-9 font-mono text-xs"
          />
        </Campo>
        <Campo label="Unidad de medida">
          <Select value={unidad} onValueChange={setUnidad}>
            <SelectTrigger className="h-9 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>

      <Campo label="Nombre">
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder={esTela ? "MEZCLILLA PRADA NEGRO" : "BOTON CUERNO CAFE 16 mm"}
          className="h-9"
        />
      </Campo>

      {/* ── Lo propio de cada tipo ── */}
      {esTela ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">
            Datos de la tela
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Familia">
              <Input
                value={telaFamilia}
                onChange={(e) => setTelaFamilia(e.target.value)}
                placeholder="MEZCLILLA"
                className="h-9"
                list="familias-tela"
              />
              <datalist id="familias-tela">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Campo>
            <Campo label="Acabado">
              <Select value={telaAcabado} onValueChange={setTelaAcabado}>
                <SelectTrigger className="h-9 bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin especificar</SelectItem>
                  {ACABADOS_TELA.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Nombre comercial">
              <Input
                value={telaNombre}
                onChange={(e) => setTelaNombre(e.target.value)}
                placeholder="PRADA"
                className="h-9"
              />
            </Campo>
            <Campo label="Color">
              <Input
                value={telaColor}
                onChange={(e) => setTelaColor(e.target.value)}
                placeholder="INDIGO"
                className="h-9"
              />
            </Campo>
          </div>
          <div className="mt-3">
            <Campo label="Composición">
              <Input
                value={telaComposicion}
                onChange={(e) => setTelaComposicion(e.target.value)}
                placeholder="100% ALGODON"
                className="h-9"
              />
            </Campo>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">
            Datos de la habilitación
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Categoría">
              <Input
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="BOTON"
                className="h-9"
                list="categorias-hab"
              />
              <datalist id="categorias-hab">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Campo>
            <Campo label="Material">
              <Input
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="METAL"
                className="h-9"
              />
            </Campo>
            <Campo label="Color">
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="NIQUEL"
                className="h-9"
              />
            </Campo>
            <Campo label="Medida">
              <Input
                value={medida}
                onChange={(e) => setMedida(e.target.value)}
                placeholder="16 mm"
                className="h-9"
              />
            </Campo>
          </div>

          {/* Atributos propios de la categoría */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">
                Atributos propios
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => setAtributos((a) => [...a, { k: "", v: "" }])}
              >
                <Plus className="size-3" />
                Agregar
              </Button>
            </div>
            {atributos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin atributos. Aquí van los datos que solo aplican a esta categoría:
                hoyos en botones, talla en talleros, departamento en etiquetas.
              </p>
            ) : (
              <div className="space-y-2">
                {atributos.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={a.k}
                      onChange={(e) =>
                        setAtributos((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)),
                        )
                      }
                      placeholder="atributo"
                      className="h-8 flex-1 text-xs"
                    />
                    <Input
                      value={a.v}
                      onChange={(e) =>
                        setAtributos((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)),
                        )
                      }
                      placeholder="valor"
                      className="h-8 flex-1 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-8 shrink-0 p-0"
                      onClick={() =>
                        setAtributos((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {metadatos.length > 0 && (
              <div className="mt-3 rounded border border-border bg-background px-2.5 py-2">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  Procedencia del precio (de la carga inicial)
                </p>
                {metadatos.map(([k, v]) => (
                  <p key={k} className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{k.replace(/^_/, "")}</span>: {String(v)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Costos y proveedor ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label={esTela ? "Costo por metro" : "Costo unitario"}>
          <Input
            type="number"
            min="0"
            step="0.0001"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            placeholder="0.00"
            className="h-9 text-right"
          />
        </Campo>
        <Campo label="Stock mínimo">
          <Input
            type="number"
            min="0"
            step="0.001"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            placeholder="Sin alerta"
            className="h-9 text-right"
          />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Proveedor">
          <Select value={idproveedor} onValueChange={setIdproveedor}>
            <SelectTrigger className="h-9 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin asignar</SelectItem>
              {proveedores.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Clave del proveedor">
          <Input
            value={claveProv}
            onChange={(e) => setClaveProv(e.target.value)}
            placeholder="La que usa el proveedor"
            className="h-9 font-mono text-xs"
          />
        </Campo>
      </div>

      <Campo label="Descripción">
        <Input
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción larga, la que lee quien compra"
          className="h-9"
        />
      </Campo>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
          className="size-4"
        />
        Activo
        <span className="text-xs text-muted-foreground">
          — al desactivarlo deja de ofrecerse, pero su historial se conserva
        </span>
      </label>

      <p className="text-xs text-muted-foreground">
        El costo unitario es una referencia para cotizar. El que valoriza el inventario es
        el precio de cada compra, que se captura al registrar el ingreso.
      </p>
    </FormOverlay>
  )
}

// ─── Rollos ──────────────────────────────────────────────────────────────────

function RollosTab({
  rollos,
  loading,
  onRefresh,
}: {
  rollos: VwInventarioRollo[]
  loading: boolean
  onRefresh: () => void
}) {
  const readOnly = useReadOnly()
  const [search, setSearch] = useState("")
  const [soloDisponibles, setSoloDisponibles] = useState(true)
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [etiquetas, setEtiquetas] = useState<VwInventarioRollo[] | null>(null)
  const [descontando, setDescontando] = useState<VwInventarioRollo | null>(null)

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rollos.filter((r) => {
      if (soloDisponibles && r.agotado) return false
      if (
        q &&
        !`${r.codigo} ${r.articulo_clave} ${r.articulo_nombre} ${r.folios ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false
      return true
    })
  }, [rollos, search, soloDisponibles])

  const kpis = useMemo(() => {
    let disponibles = 0
    let metros = 0
    for (const r of filtrados) {
      if (!r.agotado) disponibles++
      metros += num(r.metros_disponibles)
    }
    return { disponibles, metros, total: filtrados.length }
  }, [filtrados])

  const alternar = (id: number) => {
    setSeleccion((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label="Rollos"
          value={kpis.total}
          icon={<Scissors className="size-3.5" />}
          iconBg="bg-teal-100 ring-teal-200"
          iconColor="text-teal-600"
          valueColor="text-foreground"
          hint={`${kpis.disponibles} con tela`}
        />
        <KpiCard
          label="Metros disponibles"
          value={kpis.metros}
          format={(n) => `${fmtCant(n)} m`}
          icon={<Boxes className="size-3.5" />}
          iconBg="bg-sky-100 ring-sky-200"
          iconColor="text-sky-600"
          valueColor="text-sky-700"
        />
        <KpiCard
          label="Agotados"
          value={kpis.total - kpis.disponibles}
          icon={<Package className="size-3.5" />}
          iconBg="bg-slate-100 ring-slate-200"
          iconColor="text-slate-600"
          valueColor="text-muted-foreground"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Código, tela o folio…"
            className="h-9 w-64 pl-8"
          />
        </div>
        <Button
          size="sm"
          variant={soloDisponibles ? "default" : "outline"}
          onClick={() => setSoloDisponibles(!soloDisponibles)}
          className="h-9"
        >
          {soloDisponibles ? "Solo con tela" : "Todos"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={seleccion.size === 0}
          onClick={() => setEtiquetas(filtrados.filter((r) => seleccion.has(r.id)))}
          className="ml-auto h-9 gap-1.5"
        >
          <QrCode className="size-3.5" />
          Imprimir etiquetas{seleccion.size > 0 && ` (${seleccion.size})`}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10" />
              <TableHead className="font-semibold">Código</TableHead>
              <TableHead className="font-semibold">Tela</TableHead>
              <TableHead className="text-right font-semibold">Inicial</TableHead>
              <TableHead className="text-right font-semibold">Usado</TableHead>
              <TableHead className="text-right font-semibold">Disponible</TableHead>
              <TableHead className="font-semibold">Folios</TableHead>
              <TableHead className="font-semibold">Ubicación</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">
                  {rollos.length === 0
                    ? "Todavía no hay rollos. Se crean al registrar un ingreso de tela."
                    : "Sin rollos para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((r) => (
                <TableRow key={r.id} className={cn("hover:bg-muted/30", r.agotado && "opacity-60")}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={seleccion.has(r.id)}
                      onChange={() => alternar(r.id)}
                      className="size-4 rounded border-border"
                      aria-label={`Seleccionar ${r.codigo}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{r.codigo}</TableCell>
                  <TableCell className="text-sm">
                    {r.articulo_nombre}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {r.articulo_clave}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {fmtCant(num(r.metros_inicial))}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {num(r.metros_usados) > 0 ? fmtCant(num(r.metros_usados)) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    <span className={cn(r.agotado ? "text-muted-foreground" : "text-emerald-700")}>
                      {fmtCant(num(r.metros_disponibles))}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                    {r.folios ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.ubicacion ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!readOnly && !r.agotado && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => setDescontando(r)}
                      >
                        <Scissors className="size-3.5" />
                        Descontar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Cada rollo lleva su propio saldo: se le van descontando los metros que se cortan
        hasta agotarse. El QR de la etiqueta codifica el código del rollo, para localizarlo
        y descontar desde el celular.
      </p>

      {etiquetas && (
        <EtiquetasRollosDialog rollos={etiquetas} onClose={() => setEtiquetas(null)} />
      )}

      {descontando && (
        <DescontarRolloDialog
          rollo={descontando}
          onClose={() => setDescontando(null)}
          onSaved={() => {
            setDescontando(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

// ─── Descuento de tela ───────────────────────────────────────────────────────

function DescontarRolloDialog({
  rollo,
  onClose,
  onSaved,
}: {
  rollo: VwInventarioRollo
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const [metros, setMetros] = useState("")
  const [folio, setFolio] = useState("")
  const [fecha, setFecha] = useState(hoyISO())
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)

  const disponible = num(rollo.metros_disponibles)
  const m = Number(metros)
  const valido = Number.isFinite(m) && m > 0
  const excede = valido && m > disponible + 0.0005

  const guardar = async () => {
    if (!valido) {
      toast.error("Indica cuántos metros se descuentan")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)
    const { error } = await supabase.from("inventario_salidas").insert({
      idempresa: IDEMPRESA,
      idarticulo: rollo.idarticulo,
      idrollo: rollo.id,
      folio: folio.trim() || null,
      fecha,
      cantidad: m,
      motivo: motivo.trim() || null,
      capturado_por: user?.username ?? null,
    })
    setGuardando(false)
    if (error) {
      // El trigger del script 054 impide dejar el rollo en negativo
      toast.error("No se pudo descontar", { description: error.message })
      return
    }
    toast.success(`${fmtCant(m)} m descontados de ${rollo.codigo}`)
    onSaved()
  }

  return (
    <FormOverlay
      titulo={`Descontar de ${rollo.codigo}`}
      onClose={onClose}
      onGuardar={guardar}
      guardando={guardando}
      deshabilitado={!valido || excede}
    >
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <p className="font-medium">{rollo.articulo_nombre}</p>
        <p className="mt-1 text-muted-foreground">
          Disponible:{" "}
          <span className="font-semibold tabular-nums text-emerald-700">
            {fmtCant(disponible)} m
          </span>{" "}
          de {fmtCant(num(rollo.metros_inicial))} m
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Metros a descontar">
          <Input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={metros}
            onChange={(e) => setMetros(e.target.value)}
            placeholder="0.00"
            className="h-9 text-right"
          />
        </Campo>
        <Campo label="Fecha">
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-9"
          />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Folio de producción">
          <Input
            value={folio}
            onChange={(e) => setFolio(e.target.value)}
            placeholder="2315"
            className="h-9"
          />
        </Campo>
        <Campo label="Motivo (opcional)">
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Corte, muestra, merma…"
            className="h-9"
          />
        </Campo>
      </div>

      {excede && (
        <p className="text-xs font-medium text-rose-600">
          El rollo solo tiene {fmtCant(disponible)} m. La base rechaza el movimiento.
        </p>
      )}
      {!folio.trim() && valido && (
        <p className="text-xs text-amber-600">
          Sin folio no se puede costear el consumo de ese pedido.
        </p>
      )}
    </FormOverlay>
  )
}

// ─── Ingresos ────────────────────────────────────────────────────────────────

type RenglonIngreso = {
  idarticulo: string
  cantidad: string
  costo: string
  /** Solo telas: en cuántos rollos se reparte. */
  rollos: string
}

const RENGLON_VACIO: RenglonIngreso = { idarticulo: "", cantidad: "", costo: "", rollos: "" }

function IngresosTab({
  articulos,
  proveedores,
  loading,
  onRefresh,
}: {
  articulos: VwInventarioArticulo[]
  proveedores: Proveedor[]
  loading: boolean
  onRefresh: () => void
}) {
  const readOnly = useReadOnly()
  const { user } = useAuth()
  const [folioCompra, setFolioCompra] = useState("")
  const [fecha, setFecha] = useState(hoyISO())
  const [idproveedor, setIdproveedor] = useState("__none__")
  const [comentarios, setComentarios] = useState("")
  const [renglones, setRenglones] = useState<RenglonIngreso[]>([{ ...RENGLON_VACIO }])
  const [guardando, setGuardando] = useState(false)

  const porId = useMemo(
    () => Object.fromEntries(articulos.map((a) => [String(a.id), a])),
    [articulos],
  )

  const total = useMemo(
    () =>
      renglones.reduce(
        (s, r) => s + (Number(r.cantidad) || 0) * (Number(r.costo) || 0),
        0,
      ),
    [renglones],
  )

  const actualizar = (i: number, campo: keyof RenglonIngreso, valor: string) => {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)))
  }

  const validos = renglones.filter(
    (r) => r.idarticulo && Number(r.cantidad) > 0 && r.costo !== "",
  )

  const guardar = async () => {
    if (validos.length === 0) {
      toast.error("Agrega al menos un artículo con cantidad y precio")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)

    // 1. La cabecera del ingreso
    const { data: cab, error: e1 } = await supabase
      .from("inventario_ingresos")
      .insert({
        idempresa: IDEMPRESA,
        folio_compra: folioCompra.trim() || null,
        fecha,
        idproveedor: idproveedor === "__none__" ? null : Number(idproveedor),
        comentarios: comentarios.trim() || null,
        capturado_por: user?.username ?? null,
      })
      .select("id")
      .single()

    if (e1 || !cab) {
      setGuardando(false)
      toast.error("No se pudo registrar el ingreso", { description: e1?.message })
      return
    }
    const idingreso = (cab as { id: number }).id

    // 2. El detalle
    const { data: det, error: e2 } = await supabase
      .from("inventario_ingreso_detalle")
      .insert(
        validos.map((r) => ({
          idempresa: IDEMPRESA,
          idingreso,
          idarticulo: Number(r.idarticulo),
          cantidad: Number(r.cantidad),
          costo_unitario: Number(r.costo),
        })),
      )
      .select("id, idarticulo, cantidad")

    if (e2) {
      // Sin detalle la cabecera no significa nada: se retira para no dejar
      // un ingreso vacío que después nadie sabe interpretar.
      await supabase.from("inventario_ingresos").delete().eq("id", idingreso)
      setGuardando(false)
      toast.error("No se pudo guardar el detalle", { description: e2.message })
      return
    }

    // 3. Los rollos de las telas que pidieron repartirse
    const detalles = (det ?? []) as { id: number; idarticulo: number; cantidad: number }[]
    const nuevosRollos: Record<string, unknown>[] = []
    const sello = format(new Date(), "yyMMddHHmmss")

    validos.forEach((r, i) => {
      const art = porId[r.idarticulo]
      const cuantos = Number(r.rollos) || 0
      if (!art || art.tipo !== "Tela" || cuantos < 1) return
      const d = detalles.find((x) => x.idarticulo === Number(r.idarticulo))
      const metrosTotal = Number(r.cantidad)
      // El último rollo absorbe el redondeo para que la suma sea exacta
      const base = Math.floor((metrosTotal / cuantos) * 1000) / 1000
      for (let k = 0; k < cuantos; k++) {
        const metros =
          k === cuantos - 1
            ? Math.round((metrosTotal - base * (cuantos - 1)) * 1000) / 1000
            : base
        nuevosRollos.push({
          idempresa: IDEMPRESA,
          idarticulo: Number(r.idarticulo),
          iddetalle: d?.id ?? null,
          codigo: `${art.clave}-${sello}-${String(i + 1)}${String(k + 1).padStart(2, "0")}`,
          metros_inicial: metros,
          capturado_por: user?.username ?? null,
        })
      }
    })

    if (nuevosRollos.length > 0) {
      const { error: e3 } = await supabase.from("tela_rollos").insert(nuevosRollos)
      if (e3) {
        setGuardando(false)
        toast.error("El ingreso se guardó, pero fallaron los rollos", {
          description: e3.message,
        })
        onRefresh()
        return
      }
    }

    setGuardando(false)
    toast.success(
      nuevosRollos.length > 0
        ? `Ingreso registrado · ${nuevosRollos.length} rollos creados`
        : "Ingreso registrado",
      { description: `${validos.length} artículos · ${fmtCurrency(total)}` },
    )
    setFolioCompra("")
    setComentarios("")
    setRenglones([{ ...RENGLON_VACIO }])
    onRefresh()
  }

  if (readOnly) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Tu usuario es de solo lectura.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold">Orden de compra</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Folio de compra">
            <Input
              value={folioCompra}
              onChange={(e) => setFolioCompra(e.target.value)}
              placeholder="OC-1024"
              className="h-9"
            />
          </Campo>
          <Campo label="Fecha">
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="h-9"
            />
          </Campo>
          <Campo label="Proveedor">
            <Select value={idproveedor} onValueChange={setIdproveedor}>
              <SelectTrigger className="h-9 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin asignar</SelectItem>
                {proveedores.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Comentarios">
            <Input
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              placeholder="Opcional"
              className="h-9"
            />
          </Campo>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Artículo</TableHead>
              <TableHead className="w-32 text-right font-semibold">Cantidad</TableHead>
              <TableHead className="w-32 text-right font-semibold">Precio unitario</TableHead>
              <TableHead className="w-28 text-right font-semibold">Rollos</TableHead>
              <TableHead className="w-32 text-right font-semibold">Importe</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {renglones.map((r, i) => {
              const art = porId[r.idarticulo]
              const esTela = art?.tipo === "Tela"
              const importe = (Number(r.cantidad) || 0) * (Number(r.costo) || 0)
              return (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell>
                    <Select
                      value={r.idarticulo}
                      onValueChange={(v) => {
                        actualizar(i, "idarticulo", v)
                        // El costo de referencia prellena, pero se puede cambiar:
                        // manda lo que se pagó en esta compra.
                        const a = porId[v]
                        if (a?.costo_unitario != null && !r.costo) {
                          actualizar(i, "costo", String(a.costo_unitario))
                        }
                      }}
                      disabled={loading}
                    >
                      <SelectTrigger className="h-9 bg-transparent">
                        <SelectValue placeholder="Selecciona…" />
                      </SelectTrigger>
                      <SelectContent>
                        {articulos.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            <span className="font-mono text-xs">{a.clave}</span> · {a.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={r.cantidad}
                      onChange={(e) => actualizar(i, "cantidad", e.target.value)}
                      placeholder="0"
                      className="h-9 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.costo}
                      onChange={(e) => actualizar(i, "costo", e.target.value)}
                      placeholder="0.00"
                      className="h-9 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    {esTela ? (
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={r.rollos}
                        onChange={(e) => actualizar(i, "rollos", e.target.value)}
                        placeholder="0"
                        title="En cuántos rollos se reparte esta tela"
                        className="h-9 text-right"
                      />
                    ) : (
                      <span className="block text-right text-xs text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {fmtCurrency(importe)}
                  </TableCell>
                  <TableCell>
                    {renglones.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive/50 hover:text-destructive"
                        onClick={() => setRenglones((p) => p.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={4} className="text-sm font-semibold">
                Total de la compra
              </TableCell>
              <TableCell className="text-right text-sm font-bold tabular-nums">
                {fmtCurrency(total)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRenglones((p) => [...p, { ...RENGLON_VACIO }])}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          Agregar artículo
        </Button>
        <Button
          onClick={guardar}
          disabled={guardando || validos.length === 0}
          className="ml-auto gap-1.5 bg-teal-600 text-white hover:bg-teal-700"
        >
          {guardando ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
          Registrar ingreso
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        El precio unitario es el de <strong>esta compra</strong> y es el que valoriza el
        inventario; el del artículo queda como referencia. En las telas, la columna
        &quot;Rollos&quot; reparte la cantidad recibida en rollos con su código y su QR.
      </p>
    </div>
  )
}

// ─── Proveedores ─────────────────────────────────────────────────────────────

function ProveedoresTab({
  proveedores,
  articulos,
  onRefresh,
}: {
  proveedores: Proveedor[]
  articulos: VwInventarioArticulo[]
  onRefresh: () => void
}) {
  const readOnly = useReadOnly()
  const [edit, setEdit] = useState<{ id: number; nombre: string; contacto: string; telefono: string } | null>(null)
  const [nuevo, setNuevo] = useState<{ nombre: string; contacto: string; telefono: string } | null>(null)
  const [guardando, setGuardando] = useState(false)

  const conteo = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of articulos) {
      if (a.idproveedor != null) m.set(a.idproveedor, (m.get(a.idproveedor) ?? 0) + 1)
    }
    return m
  }, [articulos])

  const guardar = async () => {
    const datos = edit ?? nuevo
    if (!datos?.nombre.trim()) {
      toast.error("El nombre es obligatorio")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)
    const payload = {
      nombre: datos.nombre.trim(),
      contacto: datos.contacto.trim() || null,
      telefono: datos.telefono.trim() || null,
    }
    const { error } = edit
      ? await supabase.from("proveedores").update(payload).eq("id", edit.id)
      : await supabase.from("proveedores").insert({ idempresa: IDEMPRESA, ...payload })
    setGuardando(false)
    if (error) {
      toast.error("No se pudo guardar", {
        description: error.message.includes("ux_proveedores")
          ? "Ya existe un proveedor con ese nombre."
          : error.message,
      })
      return
    }
    setEdit(null)
    setNuevo(null)
    onRefresh()
    toast.success(edit ? "Proveedor actualizado" : "Proveedor agregado")
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Proveedor</TableHead>
              <TableHead className="font-semibold">Contacto</TableHead>
              <TableHead className="font-semibold">Teléfono</TableHead>
              <TableHead className="text-right font-semibold">Artículos</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proveedores.length === 0 && !nuevo ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  Todavía no hay proveedores.
                </TableCell>
              </TableRow>
            ) : (
              proveedores.map((p) =>
                edit?.id === p.id ? (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Input
                        value={edit.nombre}
                        onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={edit.contacto}
                        onChange={(e) => setEdit({ ...edit, contacto: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={edit.telefono}
                        onChange={(e) => setEdit({ ...edit, telefono: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </TableCell>
                    <TableCell />
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={guardar}
                          disabled={guardando}
                        >
                          <Check className="size-3.5 text-emerald-600" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setEdit(null)}
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-medium">{p.nombre}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.contacto ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.telefono ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {conteo.get(p.id) ?? 0}
                    </TableCell>
                    <TableCell>
                      {!readOnly && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() =>
                            setEdit({
                              id: p.id,
                              nombre: p.nombre,
                              contacto: p.contacto ?? "",
                              telefono: p.telefono ?? "",
                            })
                          }
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              )
            )}

            {nuevo && (
              <TableRow>
                <TableCell>
                  <Input
                    autoFocus
                    placeholder="Nombre"
                    value={nuevo.nombre}
                    onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                    className="h-8 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    placeholder="Contacto"
                    value={nuevo.contacto}
                    onChange={(e) => setNuevo({ ...nuevo, contacto: e.target.value })}
                    className="h-8 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    placeholder="Teléfono"
                    value={nuevo.telefono}
                    onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })}
                    className="h-8 text-sm"
                  />
                </TableCell>
                <TableCell />
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={guardar}
                      disabled={guardando}
                    >
                      <Check className="size-3.5 text-emerald-600" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => setNuevo(null)}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!readOnly && !nuevo && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setNuevo({ nombre: "", contacto: "", telefono: "" })}
        >
          <Plus className="size-3.5" /> Agregar proveedor
        </Button>
      )}
    </div>
  )
}

// ─── Piezas compartidas ──────────────────────────────────────────────────────

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Formulario centrado sobre la pantalla, con guardar y cancelar. */
function FormOverlay({
  titulo,
  children,
  onClose,
  onGuardar,
  guardando,
  deshabilitado,
}: {
  titulo: string
  children: React.ReactNode
  onClose: () => void
  onGuardar: () => void
  guardando: boolean
  deshabilitado?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">{titulo}</h3>
          <Button size="icon" variant="ghost" className="size-8" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="space-y-3">{children}</div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            onClick={onGuardar}
            disabled={guardando || deshabilitado}
            className="gap-1.5 bg-teal-600 text-white hover:bg-teal-700"
          >
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Guardar
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Saldos ──────────────────────────────────────────────────────────────────

/**
 * El inventario completo en un solo lugar: habilitaciones y telas juntas,
 * con su cantidad actual y cuánto vale.
 *
 * La valoración usa el costo PROMEDIO de compra, no el de referencia del
 * artículo: es lo que realmente se pagó. Si nunca se ha comprado, cae al de
 * referencia para no reportar en cero un inventario que sí existe.
 */
function SaldosTab({
  articulos,
  loading,
}: {
  articulos: VwInventarioArticulo[]
  loading: boolean
}) {
  const [search, setSearch] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("__all__")
  const [soloConSaldo, setSoloConSaldo] = useState(false)

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return articulos.filter((a) => {
      if (filtroTipo !== "__all__" && a.tipo !== filtroTipo) return false
      if (soloConSaldo && num(a.existencia) <= 0) return false
      if (q && !`${a.clave} ${a.nombre} ${a.proveedor ?? ""}`.toLowerCase().includes(q))
        return false
      return true
    })
  }, [articulos, search, filtroTipo, soloConSaldo])

  /** El costo con que se valoriza: el real de compra, o el de referencia. */
  const costoDe = (a: VwInventarioArticulo) => num(a.costo_promedio ?? a.costo_unitario)

  const totales = useMemo(() => {
    let valor = 0
    let habilitaciones = 0
    let telas = 0
    let bajos = 0
    let sinCosto = 0
    for (const a of filtrados) {
      const c = num(a.costo_promedio ?? a.costo_unitario)
      const v = num(a.existencia) * c
      valor += v
      if (a.tipo === "Tela") telas += v
      else habilitaciones += v
      if (a.bajo_minimo) bajos++
      if (c === 0) sinCosto++
    }
    return { valor, habilitaciones, telas, bajos, sinCosto }
  }, [filtrados])

  const exportar = () => {
    if (filtrados.length === 0) {
      toast.warning("Nada que exportar con los filtros aplicados.")
      return
    }
    const filas = filtrados.map((a) => ({
      Tipo: a.tipo,
      Clave: a.clave,
      "Artículo": a.nombre,
      Unidad: a.unidad_medida,
      Proveedor: a.proveedor ?? "",
      Ingresado: num(a.total_ingresado),
      Salidas: num(a.total_salidas),
      Existencia: num(a.existencia),
      "Costo unitario": costoDe(a),
      "Valorización": num(a.existencia) * costoDe(a),
      "Stock mínimo": a.stock_minimo ?? "",
      "Bajo mínimo": a.bajo_minimo ? "Sí" : "No",
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Saldos")
    XLSX.writeFile(wb, `saldos_inventario_${hoyISO()}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Valor del inventario"
          value={totales.valor}
          format={fmtCurrency}
          icon={<Boxes className="size-3.5" />}
          iconBg="bg-teal-100 ring-teal-200"
          iconColor="text-teal-600"
          valueColor="text-teal-700"
          hint={`${filtrados.length} artículos`}
        />
        <KpiCard
          label="En habilitaciones"
          value={totales.habilitaciones}
          format={fmtCurrency}
          icon={<Package className="size-3.5" />}
          iconBg="bg-sky-100 ring-sky-200"
          iconColor="text-sky-600"
          valueColor="text-sky-700"
        />
        <KpiCard
          label="En telas"
          value={totales.telas}
          format={fmtCurrency}
          icon={<Scissors className="size-3.5" />}
          iconBg="bg-violet-100 ring-violet-200"
          iconColor="text-violet-600"
          valueColor="text-violet-700"
        />
        <KpiCard
          label="Bajo mínimo"
          value={totales.bajos}
          icon={<AlertTriangle className="size-3.5" />}
          iconBg="bg-amber-100 ring-amber-200"
          iconColor="text-amber-600"
          valueColor={totales.bajos > 0 ? "text-amber-600" : "text-foreground"}
          hint={totales.sinCosto > 0 ? `${totales.sinCosto} sin costo` : "Hay que reponer"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Clave, artículo o proveedor…"
            className="h-9 w-64 pl-8"
          />
        </div>
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="h-9 w-48 bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los tipos</SelectItem>
            <SelectItem value="Habilitación">Habilitaciones</SelectItem>
            <SelectItem value="Tela">Telas</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={soloConSaldo ? "default" : "outline"}
          onClick={() => setSoloConSaldo(!soloConSaldo)}
          className="h-9"
        >
          {soloConSaldo ? "Solo con existencia" : "Todos"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportar}
          disabled={filtrados.length === 0}
          className="ml-auto h-9 gap-1.5"
        >
          <Download className="size-3.5" />
          Exportar
        </Button>
      </div>

      {/*
        Alto fijo con scroll y encabezado pegajoso: con 1,683 articulos
        cargados la tabla crecia hasta empujar el pie de pagina fuera de
        la vista. `overflow-auto` en el hijo y no en el padre para que el
        sticky del encabezado tenga contra que pegarse.
      */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead className="font-semibold">Tipo</TableHead>
              <TableHead className="font-semibold">Clave</TableHead>
              <TableHead className="font-semibold">Artículo</TableHead>
              <TableHead className="font-semibold">Unidad</TableHead>
              <TableHead className="text-right font-semibold">Ingresado</TableHead>
              <TableHead className="text-right font-semibold">Salidas</TableHead>
              <TableHead className="text-right font-semibold">Existencia</TableHead>
              <TableHead className="text-right font-semibold">Costo unitario</TableHead>
              <TableHead className="text-right font-semibold">Valorización</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">
                  {articulos.length === 0
                    ? "Todavía no hay artículos registrados."
                    : "Sin resultados para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((a) => {
                const costo = costoDe(a)
                return (
                  <TableRow key={a.id} className="hover:bg-muted/30">
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          a.tipo === "Tela"
                            ? "bg-violet-100 text-violet-700 ring-violet-200"
                            : "bg-sky-100 text-sky-700 ring-sky-200",
                        )}
                      >
                        {a.tipo}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{a.clave}</TableCell>
                    <TableCell className="text-sm">{a.nombre}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.unidad_medida}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {fmtCant(num(a.total_ingresado))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {num(a.total_salidas) > 0 ? fmtCant(num(a.total_salidas)) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <span className={cn("font-semibold", a.bajo_minimo && "text-amber-600")}>
                        {fmtCant(num(a.existencia))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {costo > 0 ? (
                        fmtCurrency(costo)
                      ) : (
                        <span className="text-amber-600">Sin costo</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {fmtCurrency(num(a.existencia) * costo)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
          {filtrados.length > 0 && (
            <TableFooter>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={8} className="text-sm font-semibold">
                  Total · {filtrados.length} artículos
                </TableCell>
                <TableCell className="text-right text-sm font-bold tabular-nums">
                  {fmtCurrency(totales.valor)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        La existencia sale de <strong>ingresos menos salidas</strong>: no hay un total
        guardado que pueda desincronizarse. La valorización usa el costo promedio de lo
        que se compró; si el artículo nunca se ha comprado, el de referencia.
      </p>
    </div>
  )
}

// ─── Movimientos ─────────────────────────────────────────────────────────────

/**
 * Cada entrada y cada salida, de habilitaciones y telas, en una sola línea
 * de tiempo. Es la respuesta a "por qué este artículo tiene esta cantidad".
 */
function MovimientosTab({
  movimientos,
  loading,
}: {
  movimientos: VwInventarioMovimiento[]
  loading: boolean
}) {
  const [search, setSearch] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("__all__")
  const [filtroMov, setFiltroMov] = useState("__all__")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return movimientos.filter((m) => {
      if (filtroTipo !== "__all__" && m.tipo !== filtroTipo) return false
      if (filtroMov !== "__all__" && m.movimiento !== filtroMov) return false
      if (desde && m.fecha < desde) return false
      if (hasta && m.fecha > hasta) return false
      if (
        q &&
        !`${m.articulo_clave} ${m.articulo_nombre} ${m.folio ?? ""} ${m.rollo ?? ""} ${m.referencia ?? ""} ${m.proveedor ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false
      return true
    })
  }, [movimientos, search, filtroTipo, filtroMov, desde, hasta])

  const totales = useMemo(() => {
    let entradas = 0
    let salidas = 0
    let nEntradas = 0
    let nSalidas = 0
    for (const m of filtrados) {
      if (m.movimiento === "Entrada") {
        entradas += num(m.importe)
        nEntradas++
      } else {
        salidas += num(m.importe)
        nSalidas++
      }
    }
    return { entradas, salidas, nEntradas, nSalidas }
  }, [filtrados])

  const exportar = () => {
    if (filtrados.length === 0) {
      toast.warning("Nada que exportar con los filtros aplicados.")
      return
    }
    const filas = filtrados.map((m) => ({
      Fecha: m.fecha,
      Movimiento: m.movimiento,
      Tipo: m.tipo,
      Clave: m.articulo_clave,
      "Artículo": m.articulo_nombre,
      Unidad: m.unidad_medida,
      Cantidad: num(m.cantidad) * m.signo,
      "Costo unitario": m.costo_unitario ?? "",
      Importe: num(m.importe),
      Proveedor: m.proveedor ?? "",
      "Folio compra": m.referencia ?? "",
      "Folio producción": m.folio ?? "",
      Rollo: m.rollo ?? "",
      Motivo: m.motivo ?? "",
      "Capturó": m.capturado_por ?? "",
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Movimientos")
    XLSX.writeFile(wb, `movimientos_inventario_${hoyISO()}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label="Entradas"
          value={totales.entradas}
          format={fmtCurrency}
          icon={<ArrowDownLeft className="size-3.5" />}
          iconBg="bg-emerald-100 ring-emerald-200"
          iconColor="text-emerald-600"
          valueColor="text-emerald-700"
          hint={`${totales.nEntradas} movimientos`}
        />
        <KpiCard
          label="Salidas"
          value={totales.salidas}
          format={fmtCurrency}
          icon={<ArrowUpRight className="size-3.5" />}
          iconBg="bg-rose-100 ring-rose-200"
          iconColor="text-rose-600"
          valueColor="text-rose-700"
          hint={`${totales.nSalidas} movimientos`}
        />
        <KpiCard
          label="Movimiento neto"
          value={totales.entradas - totales.salidas}
          format={fmtCurrency}
          icon={<Boxes className="size-3.5" />}
          iconBg="bg-teal-100 ring-teal-200"
          iconColor="text-teal-600"
          valueColor="text-teal-700"
          hint="Entradas menos salidas"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Artículo, folio o rollo…"
            className="h-9 w-56 pl-8"
          />
        </div>
        <Select value={filtroMov} onValueChange={setFiltroMov}>
          <SelectTrigger className="h-9 w-44 bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Entradas y salidas</SelectItem>
            <SelectItem value="Entrada">Solo entradas</SelectItem>
            <SelectItem value="Salida">Solo salidas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="h-9 w-44 bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los tipos</SelectItem>
            <SelectItem value="Habilitación">Habilitaciones</SelectItem>
            <SelectItem value="Tela">Telas</SelectItem>
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <label className="block text-[11px] text-muted-foreground">Desde</label>
          <Input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="h-9 w-36"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] text-muted-foreground">Hasta</label>
          <Input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="h-9 w-36"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={exportar}
          disabled={filtrados.length === 0}
          className="ml-auto h-9 gap-1.5"
        >
          <Download className="size-3.5" />
          Exportar
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Fecha</TableHead>
              <TableHead className="font-semibold">Movimiento</TableHead>
              <TableHead className="font-semibold">Artículo</TableHead>
              <TableHead className="text-right font-semibold">Cantidad</TableHead>
              <TableHead className="text-right font-semibold">Costo unitario</TableHead>
              <TableHead className="text-right font-semibold">Importe</TableHead>
              <TableHead className="font-semibold">Origen / destino</TableHead>
              <TableHead className="font-semibold">Capturó</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                  {movimientos.length === 0
                    ? "Todavía no hay movimientos de inventario."
                    : "Sin movimientos para los filtros aplicados."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((m) => {
                const esEntrada = m.movimiento === "Entrada"
                return (
                  <TableRow key={m.clave} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {fmtFecha(m.fecha)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          esEntrada
                            ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                            : "bg-rose-100 text-rose-700 ring-rose-200",
                        )}
                      >
                        {esEntrada ? (
                          <ArrowDownLeft className="size-3" />
                        ) : (
                          <ArrowUpRight className="size-3" />
                        )}
                        {m.movimiento}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {m.articulo_nombre}
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {m.articulo_clave}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      <span className={esEntrada ? "text-emerald-700" : "text-rose-600"}>
                        {esEntrada ? "+" : "−"}
                        {fmtCant(num(m.cantidad))}
                      </span>
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {m.unidad_medida}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {m.costo_unitario != null ? fmtCurrency(num(m.costo_unitario)) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {fmtCurrency(num(m.importe))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {esEntrada ? (
                        <>
                          {m.proveedor ?? "Sin proveedor"}
                          {m.referencia && (
                            <span className="ml-1.5 font-mono">{m.referencia}</span>
                          )}
                        </>
                      ) : (
                        <>
                          {m.folio ? (
                            <span className="font-mono font-medium text-foreground">
                              {m.folio}
                            </span>
                          ) : (
                            <span className="text-amber-600">Sin folio</span>
                          )}
                          {m.rollo && <span className="ml-1.5 font-mono">{m.rollo}</span>}
                          {m.motivo && <span className="ml-1.5">· {m.motivo}</span>}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.capturado_por ?? "—"}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
          {filtrados.length > 0 && (
            <TableFooter>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={5} className="text-sm font-semibold">
                  {filtrados.length} movimientos · {totales.nEntradas} entradas,{" "}
                  {totales.nSalidas} salidas
                </TableCell>
                <TableCell className="text-right text-sm font-bold tabular-nums">
                  {fmtCurrency(totales.entradas - totales.salidas)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Las entradas valen lo que se pagó en esa compra; las salidas, el{" "}
        <strong>costo promedio</strong> del artículo: si entraron 100 m a un precio y 100 m
        a otro, los metros que salen no son unos ni otros.
      </p>
    </div>
  )
}

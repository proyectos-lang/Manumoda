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
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  Truck,
  X as XIcon,
} from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"

import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { fmtCurrency } from "@/lib/format"
import { parseLocalDate } from "@/lib/risk"
import { cn } from "@/lib/utils"
import {
  TIPOS_ARTICULO,
  type Articulo,
  type Proveedor,
  type TipoArticulo,
  type VwInventarioArticulo,
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTodo = useCallback(async () => {
    if (configMissing) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    setError(null)

    const [art, rol, prov] = await Promise.all([
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
    ])

    setLoading(false)
    if (art.error) {
      setError(art.error.message)
      return
    }
    setArticulos(art.data)
    setRollos(rol.data)
    setProveedores(prov.data)
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

      <Tabs defaultValue="habilitaciones" className="w-full">
        <TabsList>
          <TabsTrigger value="habilitaciones">Habilitaciones</TabsTrigger>
          <TabsTrigger value="telas">Telas</TabsTrigger>
          <TabsTrigger value="rollos">Rollos</TabsTrigger>
          <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
          <TabsTrigger value="proveedores">Proveedores</TabsTrigger>
        </TabsList>

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
      if (q && !`${a.clave} ${a.nombre} ${a.proveedor ?? ""}`.toLowerCase().includes(q))
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Clave</TableHead>
              <TableHead className="font-semibold">Nombre</TableHead>
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
                  {Array.from({ length: esTela ? 9 : 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={esTela ? 9 : 8}
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
                <TableCell colSpan={esTela ? 7 : 6} className="text-sm font-semibold">
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

      {(creando || editando) && (
        <ArticuloDialog
          tipo={tipo}
          articulo={editando}
          proveedores={proveedores}
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

function ArticuloDialog({
  tipo,
  articulo,
  proveedores,
  onClose,
  onSaved,
}: {
  tipo: TipoArticulo
  articulo: Articulo | null
  proveedores: Proveedor[]
  onClose: () => void
  onSaved: () => void
}) {
  const [clave, setClave] = useState(articulo?.clave ?? "")
  const [nombre, setNombre] = useState(articulo?.nombre ?? "")
  const [unidad, setUnidad] = useState(
    articulo?.unidad_medida ?? (tipo === "Tela" ? "Metros" : "Piezas"),
  )
  const [costo, setCosto] = useState(articulo?.costo_unitario?.toString() ?? "")
  const [idproveedor, setIdproveedor] = useState(
    articulo?.idproveedor ? String(articulo.idproveedor) : "__none__",
  )
  const [minimo, setMinimo] = useState(articulo?.stock_minimo?.toString() ?? "")
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (!clave.trim() || !nombre.trim()) {
      toast.error("La clave y el nombre son obligatorios")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(true)
    const payload = {
      idempresa: IDEMPRESA,
      tipo,
      clave: clave.trim().toUpperCase(),
      nombre: nombre.trim(),
      unidad_medida: unidad,
      costo_unitario: costo.trim() === "" ? null : Number(costo),
      idproveedor: idproveedor === "__none__" ? null : Number(idproveedor),
      stock_minimo: minimo.trim() === "" ? null : Number(minimo),
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
            placeholder="TEL-001"
            className="h-9 font-mono"
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
          placeholder={tipo === "Tela" ? "Mezclilla 12 oz" : "Botón metálico 15 mm"}
          className="h-9"
        />
      </Campo>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Costo unitario (referencia)">
          <Input
            type="number"
            min="0"
            step="0.01"
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

"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { useReadOnly } from "@/lib/auth-context"
import type { Cliente } from "@/lib/types"

/**
 * Crear una orden desde cero, sin pasar por el Excel.
 *
 * EL FOLIO NO SE TECLEA:
 *   Lo entrega la base con su propia serie —M-0001, M-0002…— separada de
 *   la numeración del Excel. Los 637 folios actuales son numéricos, así
 *   que el prefijo garantiza que las dos series no choquen por más que
 *   el Excel siga creciendo.
 *
 *   Y se pide dentro de la misma transacción que lo escribe: entre
 *   pedirlo y usarlo desde el navegador cabe que otra sesión tome el
 *   mismo número.
 *
 * EL CLIENTE Y LA FAMILIA SE ELIGEN, NO SE TECLEAN:
 *   Antes eran texto libre, y así nació SERVICIOS SHASA / SERVICIOS
 *   SHASA SR DE CV: la misma empresa partida en dos por una diferencia
 *   de captura. Ahora salen del catálogo.
 *
 *   La familia sale de `cat_familias_corte`, el mismo catálogo con el
 *   que Corte calcula las horas. Si aquí se pudiera escribir una
 *   familia que Corte no conoce, esa orden no tendría con qué
 *   programarse.
 *
 * SOLO LO MÍNIMO:
 *   Se capturan cliente, modelo, piezas y fechas. Todo lo demás —tallas,
 *   materiales, costos— vive en la ficha técnica, que se abre enseguida.
 *   Pedirlo todo aquí duplicaría esa pantalla.
 */

/** Lo que el desplegable necesita de una familia. */
type Familia = { id: number; nombre: string; grupo: string | null }

export function CrearOrdenDialog({
  open,
  onOpenChange,
  onCreada,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Recibe el folio nuevo, para abrir su ficha. */
  onCreada: (folio: string) => void
}) {
  const [idcliente, setIdcliente] = useState<number | null>(null)
  const [modelo, setModelo] = useState("")
  const [familia, setFamilia] = useState("")
  const [piezas, setPiezas] = useState("")
  const [fechaPedido, setFechaPedido] = useState(
    () => new Date().toISOString().slice(0, 10),
  )
  const [fechaCancelacion, setFechaCancelacion] = useState("")
  const [numPedido, setNumPedido] = useState("")
  const [creando, setCreando] = useState(false)

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [familias, setFamilias] = useState<Familia[]>([])
  const [cargandoCatalogos, setCargandoCatalogos] = useState(false)

  const readOnly = useReadOnly()

  /**
   * Los catálogos se cargan al ABRIR, no al montar: el diálogo vive
   * montado en el Panel General y así no se piden dos listas en cada
   * carga de la pantalla.
   */
  const cargarCatalogos = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setCargandoCatalogos(true)
    const [cli, fam] = await Promise.all([
      supabase
        .from("clientes")
        .select("id, idempresa, nombre, documento, correo, telefono, activo, notas, created_at")
        .eq("idempresa", IDEMPRESA)
        // Solo los activos: un cliente inactivo es justamente uno al
        // que ya no se le abren pedidos.
        .eq("activo", true)
        .order("nombre"),
      supabase
        .from("cat_familias_corte")
        .select("id, nombre, grupo")
        .eq("idempresa", IDEMPRESA)
        .order("nombre"),
    ])
    if (cli.error) {
      toast.error("No se pudieron cargar los clientes", {
        description: cli.error.message,
      })
    } else {
      setClientes((cli.data ?? []) as Cliente[])
    }
    if (fam.error) {
      toast.error("No se pudieron cargar las familias", {
        description: fam.error.message,
      })
    } else {
      setFamilias((fam.data ?? []) as Familia[])
    }
    setCargandoCatalogos(false)
  }, [])

  useEffect(() => {
    if (open) void cargarCatalogos()
  }, [open, cargarCatalogos])

  function limpiar() {
    setIdcliente(null)
    setModelo("")
    setFamilia("")
    setPiezas("")
    setFechaPedido(new Date().toISOString().slice(0, 10))
    setFechaCancelacion("")
    setNumPedido("")
  }

  async function crear() {
    if (idcliente == null) {
      toast.error("Elige el cliente")
      return
    }
    const supabase = getSupabase()
    if (!supabase) return
    setCreando(true)

    // La base genera el folio y crea la orden en una sola operación.
    // El nombre del cliente lo resuelve ella desde el catálogo: aquí no
    // se manda, para que las dos columnas no puedan contradecirse.
    const { data, error } = await supabase.rpc("fn_crear_orden", {
      p_idempresa: IDEMPRESA,
      p_cliente: null,
      p_idcliente: idcliente,
      p_modelo: modelo.trim().toUpperCase() || null,
      p_familia: familia || null,
      p_categoria: null,
      p_piezas: piezas.trim() === "" ? null : Number(piezas),
      p_fecha_pedido: fechaPedido || null,
      p_fecha_cancelacion: fechaCancelacion || null,
      p_tipo_pedido: null,
      p_num_pedido: numPedido.trim() || null,
    })

    setCreando(false)
    if (error) {
      toast.error("No se pudo crear la orden", { description: error.message })
      return
    }

    const folio = String(data)
    toast.success(`Orden ${folio} creada`, {
      description: "Captura su ficha técnica para completar los datos.",
    })
    limpiar()
    onOpenChange(false)
    onCreada(folio)
  }

  if (!open) return null

  const sinClientes = !cargandoCatalogos && clientes.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">Nueva orden</h2>
            <p className="text-xs text-muted-foreground">
              El folio lo asigna el sistema
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Cliente <span className="text-destructive">*</span>
            </label>
            <select
              autoFocus
              value={idcliente ?? ""}
              onChange={(e) =>
                setIdcliente(e.target.value === "" ? null : Number(e.target.value))
              }
              disabled={readOnly || cargandoCatalogos || sinClientes}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {cargandoCatalogos ? "Cargando…" : "Elige un cliente"}
              </option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {/*
              Sin clientes no se puede crear una orden, y decirlo aquí
              evita que alguien piense que el desplegable está roto.
            */}
            {sinClientes && (
              <p className="mt-1 text-[11px] text-amber-700">
                No hay clientes activos. Crea uno en el módulo de Clientes.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Modelo
              </label>
              <Input
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                placeholder="Se usa el folio si se deja vacío"
                disabled={readOnly}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Familia
              </label>
              <select
                value={familia}
                onChange={(e) => setFamilia(e.target.value)}
                disabled={readOnly || cargandoCatalogos}
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {cargandoCatalogos ? "Cargando…" : "Sin familia"}
                </option>
                {familias.map((f) => (
                  <option key={f.id} value={f.nombre}>
                    {f.nombre}
                    {f.grupo ? ` · grupo ${f.grupo}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Piezas
              </label>
              <Input
                type="number"
                min="0"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
                placeholder="0"
                disabled={readOnly}
                className="sin-flechas mt-1 h-9 text-right tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Núm. de pedido
              </label>
              <Input
                value={numPedido}
                onChange={(e) => setNumPedido(e.target.value)}
                placeholder="Del cliente"
                disabled={readOnly}
                className="mt-1 h-9"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Fecha del pedido
              </label>
              <Input
                type="date"
                value={fechaPedido}
                onChange={(e) => setFechaPedido(e.target.value)}
                disabled={readOnly}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Límite de entrega
              </label>
              <Input
                type="date"
                value={fechaCancelacion}
                onChange={(e) => setFechaCancelacion(e.target.value)}
                disabled={readOnly}
                className="mt-1 h-9"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Las tallas, materiales y costos se capturan en la ficha técnica, que
            se abre al crear la orden.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creando}>
            Cancelar
          </Button>
          <Button
            onClick={crear}
            disabled={readOnly || creando || idcliente == null}
          >
            {creando ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 size-4" />
            )}
            Crear orden
          </Button>
        </div>
      </div>
    </div>
  )
}

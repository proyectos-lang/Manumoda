"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Ban,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  PlayCircle,
} from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { getSupabase, IDEMPRESA } from "@/lib/supabase/client"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { useAuth, useReadOnly } from "@/lib/auth-context"
import { cn } from "@/lib/utils"
import { ESTADOS_ETAPA, type EstadoEtapa, type VwOrdenEtapa } from "@/lib/types"
import { FichaTecnicaDialog } from "@/components/ficha-tecnica-dialog"

/**
 * Las nueve etapas de un folio, con su estado y su captura.
 *
 * POR QUÉ UNA HOJA Y NO BOTONES EN LA FILA:
 *   Panel General ya tiene diez columnas y dos botones de etapa. Meter
 *   nueve botones más en la misma fila la desbordaría en cualquier
 *   pantalla. La fila muestra el avance; el detalle vive aquí.
 *
 * LAS TRES QUE YA EXISTEN NO SE CAPTURAN AQUÍ:
 *   Diseño, Corte y Entrega S1 se gestionan en sus propios módulos y su
 *   estado se LEE de ahí. Esta hoja las muestra para que se vean las
 *   nueve juntas, pero su botón lleva al módulo que manda: si se
 *   pudieran editar en los dos lados, tarde o temprano dirían cosas
 *   distintas.
 */

const ICONO_ESTADO: Record<EstadoEtapa, typeof Circle> = {
  Pendiente: Circle,
  "En proceso": PlayCircle,
  Completada: CheckCircle2,
  "No aplica": Ban,
}

const ESTILO_ESTADO: Record<EstadoEtapa, string> = {
  Pendiente: "text-muted-foreground",
  "En proceso": "text-amber-600",
  Completada: "text-emerald-600",
  "No aplica": "text-muted-foreground opacity-60",
}

const BADGE_ESTADO: Record<EstadoEtapa, string> = {
  Pendiente: "bg-muted text-muted-foreground",
  "En proceso": "bg-amber-100 text-amber-800",
  Completada: "bg-emerald-100 text-emerald-800",
  "No aplica": "bg-muted text-muted-foreground line-through",
}

function hoy(): string {
  return format(new Date(), "yyyy-MM-dd")
}

export function EtapasOrdenSheet({
  folio,
  open,
  onOpenChange,
  onSaved,
}: {
  folio: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Se llama tras guardar, para que la tabla refresque el avance. */
  onSaved?: () => void
}) {
  const [etapas, setEtapas] = useState<VwOrdenEtapa[]>([])
  const [loading, setLoading] = useState(false)
  const [guardando, setGuardando] = useState<number | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)
  /** La etapa 1 se captura en la ficha técnica, no en el formulario genérico. */
  const [fichaOpen, setFichaOpen] = useState(false)
  const readOnly = useReadOnly()
  const { user } = useAuth()

  const cargar = useCallback(async () => {
    if (!folio) return
    const supabase = getSupabase()
    if (!supabase) return
    setLoading(true)
    const { data, error } = await fetchAll<VwOrdenEtapa>(() =>
      supabase
        .from("vw_orden_etapas")
        .select("*")
        .eq("idempresa", IDEMPRESA)
        .eq("folio", folio)
        .order("numero"),
    )
    setLoading(false)
    if (error) {
      toast.error("No se pudieron cargar las etapas", { description: error.message })
      return
    }
    setEtapas(data)
  }, [folio])

  useEffect(() => {
    if (open && folio) void cargar()
  }, [open, folio, cargar])

  const avance = useMemo(() => {
    const cuentan = etapas.filter((e) => e.estado !== "No aplica")
    if (cuentan.length === 0) return 0
    const hechas = cuentan.filter((e) => e.estado === "Completada").length
    return Math.round((100 * hechas) / cuentan.length)
  }, [etapas])

  async function guardar(
    etapa: VwOrdenEtapa,
    cambios: { estado?: EstadoEtapa; notas?: string; responsable?: string },
  ) {
    if (!folio) return
    const supabase = getSupabase()
    if (!supabase) return
    setGuardando(etapa.idetapa)

    const estado = cambios.estado ?? etapa.estado
    const fila = {
      idempresa: IDEMPRESA,
      folio,
      idetapa: etapa.idetapa,
      estado,
      notas: cambios.notas ?? etapa.notas,
      responsable: cambios.responsable ?? etapa.responsable,
      // La fecha de inicio se pone sola la primera vez que la etapa arranca:
      // si se deja a mano, casi nunca se captura.
      fecha_inicio:
        etapa.fecha_inicio ?? (estado === "En proceso" ? hoy() : null),
      // Se completa hoy; si se revierte el estado, la fecha se limpia para
      // que no quede una fecha de término en una etapa sin terminar.
      fecha_completada:
        estado === "Completada" ? etapa.fecha_completada ?? hoy() : null,
      capturado_por: user?.username ?? null,
    }

    const { error } = await supabase
      .from("orden_etapas")
      .upsert(fila, { onConflict: "idempresa,folio,idetapa" })

    setGuardando(null)
    if (error) {
      toast.error("No se pudo guardar la etapa", { description: error.message })
      return
    }
    toast.success(`${etapa.etapa}: ${estado.toLowerCase()}`)
    await cargar()
    onSaved?.()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Etapas del folio {folio}</SheetTitle>
          <SheetDescription>
            {loading
              ? "Cargando…"
              : `${avance}% del proceso · ${etapas.filter((e) => e.estado === "Completada").length} de ${
                  etapas.filter((e) => e.estado !== "No aplica").length
                } etapas que aplican`}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Cargando etapas…
          </div>
        ) : (
          /*
           * Bloque simple con space-y, NO flex-col con altura fija: en un
           * contenedor flex de altura acotada los hijos heredan
           * flex-shrink 1 y las tarjetas se aplastan, aunque haya
           * overflow-y-auto.
           */
          <div className="mt-6 space-y-3">
            {etapas.map((e) => {
              const Icono = ICONO_ESTADO[e.estado]
              const expandida = abierta === e.idetapa
              return (
                <div
                  key={e.idetapa}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    expandida && "border-primary/40 bg-muted/30",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Icono className={cn("mt-0.5 size-5 shrink-0", ESTILO_ESTADO[e.estado])} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                          {e.numero}
                        </span>
                        <span className="font-medium">{e.etapa}</span>
                        <Badge className={cn("font-normal", BADGE_ESTADO[e.estado])}>
                          {e.estado}
                        </Badge>
                        {e.gestion_externa && (
                          <Badge variant="outline" className="gap-1 font-normal">
                            <ExternalLink className="size-3" />
                            {e.modulo}
                          </Badge>
                        )}
                      </div>

                      {e.fecha_completada && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Completada el {e.fecha_completada}
                          {e.capturado_por ? ` · ${e.capturado_por}` : ""}
                        </p>
                      )}
                      {e.notas && !expandida && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {e.notas}
                        </p>
                      )}

                      {e.gestion_externa ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Esta etapa se gestiona en el módulo de{" "}
                          <span className="font-medium">{e.modulo}</span>; aquí solo
                          se consulta.
                        </p>
                      ) : e.clave === "pre_orden" ? (
                        /*
                         * La etapa 1 no usa el formulario genérico: su captura
                         * es la ficha técnica completa, con tallas, materiales
                         * y foto, y se imprime como PDF.
                         */
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={readOnly}
                            onClick={() => setFichaOpen(true)}
                          >
                            Abrir ficha técnica
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-2">
                          {!expandida ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={readOnly}
                              onClick={() => setAbierta(e.idetapa)}
                            >
                              Gestionar
                            </Button>
                          ) : (
                            <EditorEtapa
                              etapa={e}
                              guardando={guardando === e.idetapa}
                              onCancelar={() => setAbierta(null)}
                              onGuardar={async (cambios) => {
                                await guardar(e, cambios)
                                setAbierta(null)
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SheetContent>

      <FichaTecnicaDialog
        folio={folio}
        open={fichaOpen}
        onOpenChange={setFichaOpen}
        onSaved={() => {
          void cargar()
          onSaved?.()
        }}
      />
    </Sheet>
  )
}

/**
 * El formulario genérico de una etapa: estado, responsable y notas.
 *
 * Los campos propios de cada etapa —la ficha técnica de Pre orden, el plan
 * de corte de Graduación— van en `orden_etapas.datos` (jsonb) y se
 * agregarán aquí cuando operación entregue el esquema. Que sea jsonb es lo
 * que permite que ese día no haya migración.
 */
function EditorEtapa({
  etapa,
  guardando,
  onGuardar,
  onCancelar,
}: {
  etapa: VwOrdenEtapa
  guardando: boolean
  onGuardar: (c: { estado: EstadoEtapa; notas: string; responsable: string }) => void
  onCancelar: () => void
}) {
  const [estado, setEstado] = useState<EstadoEtapa>(etapa.estado)
  const [notas, setNotas] = useState(etapa.notas ?? "")
  const [responsable, setResponsable] = useState(etapa.responsable ?? "")

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {ESTADOS_ETAPA.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={estado === s ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setEstado(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      <Input
        placeholder="Responsable (opcional)"
        value={responsable}
        onChange={(ev) => setResponsable(ev.target.value)}
        className="h-8 text-sm"
      />

      <Textarea
        placeholder="Notas (opcional)"
        value={notas}
        onChange={(ev) => setNotas(ev.target.value)}
        rows={2}
        className="text-sm"
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={guardando}
          onClick={() => onGuardar({ estado, notas, responsable })}
        >
          {guardando && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Guardar
        </Button>
        <Button size="sm" variant="ghost" disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/**
 * El avance de un folio, para la fila de la tabla.
 *
 * Nueve puntos, uno por etapa, en el orden del proceso. Es un resumen
 * denso: se lee de un vistazo en qué punto está parada la orden sin
 * abrir nada, y cabe en una celda.
 */
export function AvanceEtapas({
  etapas,
  onClick,
  disabled,
}: {
  etapas: { numero: number; etapa: string; estado: EstadoEtapa }[]
  onClick: () => void
  disabled?: boolean
}) {
  if (etapas.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  const cuentan = etapas.filter((e) => e.estado !== "No aplica")
  const hechas = cuentan.filter((e) => e.estado === "Completada").length
  const pct = cuentan.length > 0 ? Math.round((100 * hechas) / cuentan.length) : 0

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={etapas.map((e) => `${e.numero}. ${e.etapa}: ${e.estado}`).join("\n")}
      className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted disabled:cursor-default"
    >
      <span className="flex gap-0.5">
        {etapas.map((e) => (
          <span
            key={e.numero}
            className={cn(
              "size-2 rounded-full",
              e.estado === "Completada" && "bg-emerald-500",
              e.estado === "En proceso" && "bg-amber-500",
              e.estado === "Pendiente" && "bg-muted-foreground/25",
              e.estado === "No aplica" && "bg-muted-foreground/10",
            )}
          />
        ))}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </button>
  )
}

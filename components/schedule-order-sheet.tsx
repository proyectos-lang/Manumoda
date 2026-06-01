"use client"

import { useEffect, useState } from "react"
import { CalendarIcon, Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { getSupabase, getSupabaseConfigStatus, IDEMPRESA } from "@/lib/supabase/client"

type Catalog = { id: number | string; nombre: string }

type OrdenContext = {
  folio: string | null
  modelo: string | null
  piezas: number | null
  cliente: string | null
  idmaquilero: number | null
  maquilero_nombre: string | null
  idcompradora: number | null
  compradora_nombre: string | null
}

type Props = {
  ordenId: number | string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onScheduled?: () => void
}

export function ScheduleOrderSheet({ ordenId, open, onOpenChange, onScheduled }: Props) {
  const cfg = getSupabaseConfigStatus()
  const configMissing = !cfg.hasUrl || !cfg.hasKey

  const [loadingCatalogs, setLoadingCatalogs] = useState(false)
  const [loadingOrden, setLoadingOrden] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [maquileros, setMaquileros] = useState<Catalog[]>([])
  const [compradores, setCompradores] = useState<Catalog[]>([])
  const [submaquileros, setSubmaquileros] = useState<Catalog[]>([])

  const [orden, setOrden] = useState<OrdenContext | null>(null)

  const [conSubmaquilador, setConSubmaquilador] = useState(false)
  const [idsubmaquilador, setIdsubmaquilador] = useState<string>("")
  const [fechaEntrega, setFechaEntrega] = useState<Date | undefined>(undefined)

  // Reset when closed or order changes
  useEffect(() => {
    if (!open) {
      setConSubmaquilador(false)
      setIdsubmaquilador("")
      setFechaEntrega(undefined)
      setOrden(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || ordenId == null || configMissing) return

    const supabase = getSupabase()
    if (!supabase) return

    let cancelled = false

    const loadCatalogs = async () => {
      setLoadingCatalogs(true)
      try {
        const [maqRes, compRes, subRes] = await Promise.all([
          supabase
            .from("maquileros")
            .select("id, nombre")
            .eq("idempresa", IDEMPRESA)
            .order("nombre", { ascending: true }),
          supabase
            .from("compradores")
            .select("id, nombre")
            .eq("idempresa", IDEMPRESA)
            .order("nombre", { ascending: true }),
          supabase
            .from("submaquileros")
            .select("id, nombre")
            .eq("idempresa", IDEMPRESA)
            .order("nombre", { ascending: true }),
        ])

        if (cancelled) return

        if (maqRes.error) {
          console.error("[v0] maquileros error:", maqRes.error)
          toast.error("Error al cargar maquileros", { description: maqRes.error.message })
        } else {
          setMaquileros((maqRes.data ?? []) as Catalog[])
        }

        if (compRes.error) {
          console.error("[v0] compradores error:", compRes.error)
          toast.error("Error al cargar compradores", { description: compRes.error.message })
        } else {
          setCompradores((compRes.data ?? []) as Catalog[])
        }

        if (subRes.error) {
          console.error("[v0] submaquileros error:", subRes.error)
          toast.error("Error al cargar submaquileros", { description: subRes.error.message })
        } else {
          setSubmaquileros((subRes.data ?? []) as Catalog[])
        }
      } finally {
        if (!cancelled) setLoadingCatalogs(false)
      }
    }

    const loadOrden = async () => {
      setLoadingOrden(true)
      const { data, error } = await supabase
        .from("ordenes_produccion")
        .select("folio, modelo, piezas, cliente, idmaquilero, idcompradora")
        .eq("idempresa", IDEMPRESA)
        .eq("id", ordenId)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        console.error("[v0] orden error:", error)
        toast.error("Error al cargar la orden", { description: error.message })
        setOrden(null)
      } else if (data) {
        const d = data as {
          folio: string | null
          modelo: string | null
          piezas: number | null
          cliente: string | null
          idmaquilero: number | null
          idcompradora: number | null
        }
        setOrden({
          folio: d.folio,
          modelo: d.modelo,
          piezas: d.piezas,
          cliente: d.cliente,
          idmaquilero: d.idmaquilero ?? null,
          maquilero_nombre: null,
          idcompradora: d.idcompradora ?? null,
          compradora_nombre: null,
        })
      } else {
        setOrden(null)
      }
      setLoadingOrden(false)
    }

    loadCatalogs()
    loadOrden()

    return () => {
      cancelled = true
    }
  }, [open, ordenId, configMissing])

  // Resolve maquilero & compradora names once both order and catalogs are available
  useEffect(() => {
    if (!orden) return

    let maqName = orden.maquilero_nombre
    let compName = orden.compradora_nombre

    if (!maqName && orden.idmaquilero != null && maquileros.length) {
      const found = maquileros.find((m) => Number(m.id) === Number(orden.idmaquilero))
      if (found) maqName = found.nombre
    }

    if (!compName && orden.idcompradora != null && compradores.length) {
      const found = compradores.find((c) => Number(c.id) === Number(orden.idcompradora))
      if (found) compName = found.nombre
    }

    if (maqName !== orden.maquilero_nombre || compName !== orden.compradora_nombre) {
      setOrden((prev) =>
        prev ? { ...prev, maquilero_nombre: maqName, compradora_nombre: compName } : prev,
      )
    }
  }, [orden, maquileros, compradores])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (configMissing || ordenId == null) return

    if (!fechaEntrega) {
      toast.error("Falta la fecha de entrega", {
        description: "Fecha de Entrega es obligatoria.",
      })
      return
    }
    if (conSubmaquilador && !idsubmaquilador) {
      toast.error("Selecciona un submaquilador", {
        description: "Marcaste que requiere submaquilador.",
      })
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setSubmitting(true)
    try {
      const payload = {
        con_submaquilador: conSubmaquilador,
        idsubmaquilador: conSubmaquilador ? Number(idsubmaquilador) : null,
        fecha_estimacion_entrega: format(fechaEntrega, "yyyy-MM-dd"),
        fase_actual: "Programada",
      }

      const { error } = await supabase
        .from("ordenes_produccion")
        .update(payload)
        .eq("id", ordenId)
        .eq("idempresa", IDEMPRESA)

      if (error) {
        console.error("[v0] update error:", error)
        toast.error("No se pudo programar la orden", { description: error.message })
      } else {
        toast.success("Orden programada", {
          description: `Folio ${orden?.folio ?? ordenId} movida a 'Programada'.`,
        })
        onOpenChange(false)
        onScheduled?.()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border bg-muted/30 p-6">
          <SheetTitle className="text-lg">
            Programar Órden:{" "}
            <span className="font-mono text-base">
              {loadingOrden ? "..." : orden?.folio ?? ordenId ?? "-"}
            </span>
          </SheetTitle>
          <SheetDescription>
            Asigna compradora, maquilero y fecha de entrega para mover la orden a la fase
            'Programada'.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {configMissing ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Conexión a Supabase no configurada</AlertTitle>
              <AlertDescription>
                Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o
                NEXT_PUBLIC_SUPABASE_ANON_KEY.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {/* Read-only summary */}
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Resumen de la orden
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Modelo</p>
                    <p className="font-medium">
                      {loadingOrden ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        orden?.modelo ?? "-"
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Piezas</p>
                    <p className="font-medium tabular-nums">
                      {loadingOrden ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        orden?.piezas?.toLocaleString("es-MX") ?? "-"
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Compradora (read-only, sourced from upload CLIENTE column) */}
              <div className="grid gap-2">
                <Label htmlFor="compradora-display">Compradora</Label>
                <div
                  id="compradora-display"
                  className="flex h-10 items-center justify-between rounded-md border border-border bg-muted/40 px-3 text-sm"
                >
                  {loadingOrden || loadingCatalogs ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Cargando...
                    </span>
                  ) : orden?.compradora_nombre ? (
                    <span className="font-medium">{orden.compradora_nombre}</span>
                  ) : orden?.idcompradora != null ? (
                    <span className="text-muted-foreground">
                      ID {orden.idcompradora} (no encontrado en catálogo)
                    </span>
                  ) : orden?.cliente ? (
                    <span className="text-muted-foreground">
                      &quot;{orden.cliente}&quot; sin coincidencia en catálogo
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Sin comprador asignado en el archivo de carga
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Asignado automáticamente desde la columna{" "}
                  <code className="font-mono">CLIENTE</code> del archivo de carga.
                </p>
              </div>

              {/* Maquilero (read-only, sourced from upload) */}
              <div className="grid gap-2">
                <Label htmlFor="maquilero-display">Maquilero</Label>
                <div
                  id="maquilero-display"
                  className="flex h-10 items-center justify-between rounded-md border border-border bg-muted/40 px-3 text-sm"
                >
                  {loadingOrden || loadingCatalogs ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Cargando...
                    </span>
                  ) : orden?.maquilero_nombre ? (
                    <span className="font-medium">{orden.maquilero_nombre}</span>
                  ) : orden?.idmaquilero != null ? (
                    <span className="text-muted-foreground">
                      ID {orden.idmaquilero} (no encontrado en catálogo)
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Sin maquilero asignado en el archivo de carga
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Asignado automáticamente desde la columna{" "}
                  <code className="font-mono">MAQUILERO</code> del archivo de carga.
                </p>
              </div>

              {/* Submaquilador switch */}
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="con-sub" className="text-sm font-medium">
                    Requiere Submaquilador
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Activa si la producción se subcontrata.
                  </p>
                </div>
                <Switch
                  id="con-sub"
                  checked={conSubmaquilador}
                  onCheckedChange={(v) => {
                    setConSubmaquilador(v)
                    if (!v) setIdsubmaquilador("")
                  }}
                />
              </div>

              {/* Submaquilador */}
              {conSubmaquilador && (
                <div className="grid gap-2">
                  <Label htmlFor="submaquilador">
                    Submaquilador <span className="text-destructive">*</span>
                  </Label>
                  <Select value={idsubmaquilador} onValueChange={setIdsubmaquilador}>
                    <SelectTrigger id="submaquilador" disabled={loadingCatalogs}>
                      {loadingCatalogs ? (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Cargando...
                        </span>
                      ) : (
                        <SelectValue placeholder="Selecciona un submaquilador" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {submaquileros.map((s) => (
                        <SelectItem key={String(s.id)} value={String(s.id)}>
                          {s.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Fecha entrega */}
              <div className="grid gap-2">
                <Label>
                  Fecha Estimación Entrega <span className="text-destructive">*</span>
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !fechaEntrega && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="size-4" />
                      {fechaEntrega
                        ? format(fechaEntrega, "PPP", { locale: es })
                        : "Selecciona una fecha"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fechaEntrega}
                      onSelect={setFechaEntrega}
                      initialFocus
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </form>
          )}
        </div>

        <SheetFooter className="border-t border-border bg-muted/30 p-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={configMissing || submitting || loadingOrden}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Programando...
              </>
            ) : (
              "Programar Órden"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

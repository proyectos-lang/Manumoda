"use client"

import { cn } from "@/lib/utils"

/**
 * El cronograma de un día: qué entrega cae en cada hora.
 *
 * PARA QUÉ:
 *   Saber que un martes hay ocho entregas no dice si el día es
 *   manejable. Puestas en su hora se ve lo que importa: si están
 *   repartidas o si seis caen entre las 9 y las 10.
 *
 * CADA ENTREGA OCUPA UNA HORA:
 *   Es una estimación —nadie mide cuánto tarda recibir un folio— pero
 *   sirve para ver la ocupación. Si se midiera de verdad, aquí es
 *   donde entraría ese dato.
 *
 * LAS ENTREGAS SIN HORA VAN APARTE:
 *   Un apartado sin hora es un compromiso de día, no de franja.
 *   Ponerlas a las 00:00 o repartirlas inventaría una programación que
 *   nadie acordó, y quien lea el cronograma la tomaría por cierta. Se
 *   listan arriba, sin franja, y se dice cuántas son.
 *
 * SOLAPES:
 *   Dos entregas a la misma hora se muestran una junto a otra, como en
 *   una agenda. Más de tres en la misma franja es señal de que el día
 *   está mal repartido, y por eso la franja se marca.
 */

export type EntregaDia = {
  folio: string
  cliente: string | null
  modelo: string | null
  piezas: number | null
  maquilero: string | null
  fase_actual: string | null
  /** "HH:MM" o "HH:MM:SS". Sin ella, la entrega no tiene franja. */
  hora: string | null
}

/**
 * La jornada que se dibuja. Fuera de este rango no se recibe, pero si
 * alguien capturó una hora rara se amplía para no esconderla.
 */
const HORA_INICIO = 7
const HORA_FIN = 19

/** Los minutos desde medianoche de "HH:MM". */
function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

function fmtHora(hora: string): string {
  return hora.slice(0, 5)
}

export function CronogramaDia({ entregas }: { entregas: EntregaDia[] }) {
  const conHora = entregas.filter((e) => e.hora)
  const sinHora = entregas.filter((e) => !e.hora)

  // Si hay horas fuera de la jornada, se amplía el rango para que no
  // queden invisibles: es mejor un cronograma largo que una entrega
  // que no aparece.
  const horasCapturadas = conHora.map((e) => Math.floor(minutos(e.hora!) / 60))
  const inicio = Math.min(HORA_INICIO, ...horasCapturadas)
  const fin = Math.max(HORA_FIN, ...horasCapturadas.map((h) => h + 1))

  const franjas: number[] = []
  for (let h = inicio; h < fin; h++) franjas.push(h)

  /** Las entregas que empiezan en cada franja. */
  const porFranja = new Map<number, EntregaDia[]>()
  for (const e of conHora) {
    const h = Math.floor(minutos(e.hora!) / 60)
    porFranja.set(h, [...(porFranja.get(h) ?? []), e])
  }

  return (
    <div className="space-y-3">
      {/*
        Las que no tienen hora, primero y sin franja. Van arriba porque
        son las que hay que acordar: el resto del dia ya esta resuelto.
      */}
      {sinHora.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-2.5">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {sinHora.length}{" "}
            {sinHora.length === 1
              ? "entrega sin hora acordada"
              : "entregas sin hora acordada"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sinHora.map((e) => (
              <span
                key={e.folio}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-0.5 text-xs"
                title={`${e.cliente ?? ""} · ${Number(e.piezas ?? 0).toLocaleString("es-MX")} piezas`}
              >
                <span className="font-medium tabular-nums">{e.folio}</span>
                <span className="text-muted-foreground">
                  {Number(e.piezas ?? 0).toLocaleString("es-MX")} pzs
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {conHora.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Ninguna entrega de este día tiene hora acordada. Se captura en
          Seguimiento Maquila, junto a la fecha apartada.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {franjas.map((h) => {
            const enEsta = porFranja.get(h) ?? []
            const saturada = enEsta.length > 3
            return (
              <div
                key={h}
                className={cn(
                  "flex border-b border-border last:border-b-0",
                  // Las horas de comida se marcan flojo: no es que no se
                  // pueda recibir, pero conviene verlo al programar.
                  (h === 14 || h === 15) && "bg-muted/20",
                  saturada && "bg-amber-50",
                )}
              >
                <div className="w-16 shrink-0 border-r border-border px-2 py-1.5 text-right">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {String(h).padStart(2, "0")}:00
                  </span>
                </div>

                <div className="flex min-h-[38px] flex-1 flex-wrap gap-1 p-1">
                  {enEsta.map((e) => (
                    <div
                      key={e.folio}
                      className={cn(
                        "min-w-[150px] flex-1 rounded border px-2 py-1",
                        saturada
                          ? "border-amber-300 bg-amber-100"
                          : "border-emerald-200 bg-emerald-50",
                      )}
                      title={`${e.folio} · ${e.cliente ?? "sin cliente"} · ${e.maquilero ?? "sin maquilero"}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold tabular-nums">
                          {e.folio}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {fmtHora(e.hora!)}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {e.cliente ?? "—"} ·{" "}
                        {Number(e.piezas ?? 0).toLocaleString("es-MX")} pzs
                      </p>
                    </div>
                  ))}

                  {enEsta.length === 0 && (
                    <span className="self-center px-1 text-[10px] text-muted-foreground/40">
                      libre
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/*
        El aviso de saturacion sale del mismo umbral que pinta las
        franjas en ambar, para que el color y el texto no se
        contradigan.
      */}
      {[...porFranja.values()].some((v) => v.length > 3) && (
        <p className="text-xs text-amber-700">
          Hay franjas con más de tres entregas a la misma hora. Conviene
          repartirlas si almacén no da abasto.
        </p>
      )}
    </div>
  )
}

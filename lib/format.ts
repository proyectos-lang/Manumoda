/**
 * Formato de moneda, en un solo lugar.
 *
 * Vivía duplicado en tres módulos con distinta cantidad de decimales.
 * Se conservan las dos variantes que ya existían en vez de unificarlas,
 * porque cambiar los decimales alteraría cómo se ven hoy los bonos:
 *
 * · `fmtCurrency`      — 2 decimales. Importes exactos (pagos a maquileros).
 * · `fmtCurrencyRedondo` — sin decimales. Bonos y sueldos, donde el centavo
 *   no aporta nada.
 */

const MXN = { style: "currency", currency: "MXN" } as const

const conCentavos = new Intl.NumberFormat("es-MX", MXN)

const sinCentavos = new Intl.NumberFormat("es-MX", {
  ...MXN,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Importe con centavos. Devuelve "—" si no hay valor. */
export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—"
  return conCentavos.format(n)
}

/** Importe redondeado a pesos. Devuelve "—" si no hay valor. */
export function fmtCurrencyRedondo(n: number | null | undefined): string {
  if (n == null) return "—"
  return sinCentavos.format(n)
}

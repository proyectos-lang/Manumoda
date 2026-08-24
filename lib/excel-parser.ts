import * as XLSX from "xlsx"
import type { ParsedRow } from "./types"

function normalizeKey(k: string): string {
  return k
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[ÁÀÂÄ]/g, "A")
    .replace(/[ÉÈÊË]/g, "E")
    .replace(/[ÍÌÎÏ]/g, "I")
    .replace(/[ÓÒÔÖ]/g, "O")
    .replace(/[ÚÙÛÜ]/g, "U")
    .replace(/Ñ/g, "N")
}

/**
 * `YYYY-MM-DD` con el día **local** del objeto Date.
 *
 * `toISOString()` convierte a UTC: una fecha a medianoche local en México
 * (UTC-6) se serializa como el día anterior a las 18:00, así que recortar
 * los primeros 10 caracteres devolvía un día menos.
 */
function toLocalISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function excelDateToISO(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    const mm = String(parsed.m).padStart(2, "0")
    const dd = String(parsed.d).padStart(2, "0")
    return `${parsed.y}-${mm}-${dd}`
  }
  if (value instanceof Date) {
    return toLocalISODate(value)
  }
  const str = String(value).trim()
  // Try ISO first
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (dmy) {
    let [, d, m, y] = dmy
    if (y.length === 2) y = `20${y}`
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  const dt = new Date(str)
  if (!isNaN(dt.getTime())) return toLocalISODate(dt)
  return null
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : parseInt(String(value).replace(/[^\d-]/g, ""), 10)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * Número con decimales, para columnas de dinero.
 *
 * NO reutilizar `toInt` aquí: su `replace(/[^\d-]/g,"")` borra el separador
 * decimal, así que "12.50" se convierte en 1250 y 12.5 se trunca a 12 —
 * errores de 100× que no dejan rastro.
 *
 * Acepta los formatos que suelta Excel: número nativo, "1234.56",
 * "1,234.56" (coma de millares) y "1.234,56" (formato europeo). Se
 * distinguen por cuál separador aparece de último.
 */
function toDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null

  let s = String(value).trim()
  if (s === "") return null

  // Quitar símbolo de moneda y espacios (incluido el no separable)
  s = s.replace(/[$\s ]/g, "")

  const ultimaComa = s.lastIndexOf(",")
  const ultimoPunto = s.lastIndexOf(".")

  if (ultimaComa > -1 && ultimoPunto > -1) {
    // El separador decimal es el que aparece de último
    s = ultimaComa > ultimoPunto
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "")
  } else if (ultimaComa > -1) {
    // Solo comas: decimal si deja 1-2 dígitos detrás ("12,50"); si no, millares
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "")
  }

  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === "" ? null : s
}

/** Aviso de calidad de datos generado durante el parseo. */
export type ParseIssue = {
  /** Fila del archivo (1-based, contando el encabezado como fila 1). */
  fila: number
  folio: string | null
  problema: string
}

export type ParseResult = {
  rows: ParsedRow[]
  issues: ParseIssue[]
  /** Folios que aparecían más de una vez en el archivo (se conservó la última fila). */
  duplicados: string[]
}

/** ¿El valor crudo tenía contenido que el parser descartó? */
function seDescarto(raw: unknown, parsed: unknown): boolean {
  return raw !== null && raw !== undefined && String(raw).trim() !== "" && parsed === null
}

export async function parseExcelFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { rows: [], issues: [], duplicados: [] }
  const sheet = workbook.Sheets[sheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  })

  const issues: ParseIssue[] = []
  const byFolio = new Map<string, ParsedRow>()
  const duplicadosSet = new Set<string>()

  rawRows.forEach((raw, idx) => {
    const fila = idx + 2 // +1 por 0-based, +1 por la fila de encabezado

    const normalized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      normalized[normalizeKey(k)] = v
    }

    const folio = toText(normalized["FOLIO"])
    if (!folio) {
      // Solo avisar si la fila tenía algún otro dato (no filas totalmente vacías)
      const tieneAlgo = Object.values(normalized).some(
        (v) => v !== null && String(v).trim() !== "",
      )
      if (tieneAlgo) issues.push({ fila, folio: null, problema: "Fila sin FOLIO — descartada" })
      return
    }

    const fecha_pedido = excelDateToISO(normalized["FECHA"])
    const fecha_cancelacion = excelDateToISO(normalized["FECHA_CANCEL"])
    const fecha_aprobacion_diseno = excelDateToISO(normalized["FECHA_STATUS2"])
    const piezas = toInt(normalized["PIEZAS"])

    if (seDescarto(normalized["FECHA"], fecha_pedido))
      issues.push({ fila, folio, problema: `FECHA ilegible: "${normalized["FECHA"]}"` })
    if (seDescarto(normalized["FECHA_CANCEL"], fecha_cancelacion))
      issues.push({ fila, folio, problema: `FECHA_CANCEL ilegible: "${normalized["FECHA_CANCEL"]}"` })
    if (seDescarto(normalized["PIEZAS"], piezas))
      issues.push({ fila, folio, problema: `PIEZAS no numérico: "${normalized["PIEZAS"]}"` })

    // Dinero — todo por pieza. Un costo mal leído se propaga a los pagos,
    // así que cada uno avisa si traía contenido y no se pudo interpretar.
    const MONETARIAS = [
      ["COSTO_MAQUILA", "costo_maquila"],
      ["COSTO_LAVANDERIA", "costo_lavanderia"],
      ["COSTO_ESTAMPADO", "costo_estampado"],
      ["COSTO_BORDADO", "costo_bordado"],
      ["COSTO_CORTE_EXTERNO", "costo_corte_externo"],
      ["COSTO_OTRO", "costo_otro"],
      ["PRECIO_VENTA", "precio_venta"],
      ["PRECIO_PUBLICO", "precio_publico"],
    ] as const
    const dinero: Record<string, number | null> = {}
    for (const [col, campo] of MONETARIAS) {
      const v = toDecimal(normalized[col])
      dinero[campo] = v
      if (seDescarto(normalized[col], v))
        issues.push({ fila, folio, problema: `${col} no numérico: "${normalized[col]}"` })
    }

    const row: ParsedRow = {
      idempresa: 1,
      folio,
      num_pedido: toText(normalized["NUMPED"]),
      modelo: toText(normalized["MODELO"]),
      familia: toText(normalized["FAMILIA"]),
      categoria: toText(normalized["CATEGORIA"]),
      cliente: toText(normalized["CLIENTE"]),
      fecha_pedido,
      fecha_cancelacion,
      tipo_pedido: toText(normalized["TIPO_PEDIDO"]),
      piezas,
      corte_origen: toText(normalized["CORTE"]),
      fase_actual: "Por Programar",
      fecha_aprobacion_diseno,
      maquilero_nombre: toText(normalized["MAQUILERO"]),
      costo_maquila: dinero.costo_maquila,
      costo_lavanderia: dinero.costo_lavanderia,
      precio_venta: dinero.precio_venta,
      precio_publico: dinero.precio_publico,
    }

    // Dedupe intra-archivo: se conserva la ÚLTIMA aparición de cada folio
    if (byFolio.has(folio)) duplicadosSet.add(folio)
    byFolio.set(folio, row)
  })

  return {
    rows: Array.from(byFolio.values()),
    issues,
    duplicados: Array.from(duplicadosSet),
  }
}

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
    return value.toISOString().slice(0, 10)
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
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10)
  return null
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : parseInt(String(value).replace(/[^\d-]/g, ""), 10)
  return Number.isFinite(n) ? Math.trunc(n) : null
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

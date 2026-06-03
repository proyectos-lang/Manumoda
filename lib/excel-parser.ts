import * as XLSX from "xlsx"
import type { ParsedRow } from "./types"

const FIELD_MAP: Record<string, keyof ParsedRow> = {
  FOLIO: "folio",
  NUMPED: "num_pedido",
  MODELO: "modelo",
  FAMILIA: "familia",
  CLIENTE: "cliente",
  FECHA: "fecha_pedido",
  FECHA_CANCEL: "fecha_cancelacion",
  TIPO_PEDIDO: "tipo_pedido",
  PIEZAS: "piezas",
  CORTE: "corte_origen",
}

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

export async function parseExcelFile(file: File): Promise<ParsedRow[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  })

  const result: ParsedRow[] = []

  for (const raw of rows) {
    const normalized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      normalized[normalizeKey(k)] = v
    }

    const folio = toText(normalized["FOLIO"])
    if (!folio) continue // skip rows without folio

    const row: ParsedRow = {
      idempresa: 1,
      folio,
      num_pedido: toText(normalized["NUMPED"]),
      modelo: toText(normalized["MODELO"]),
      familia: toText(normalized["FAMILIA"]),
      categoria: toText(normalized["CATEGORIA"]),
      cliente: toText(normalized["CLIENTE"]),
      fecha_pedido: excelDateToISO(normalized["FECHA"]),
      fecha_cancelacion: excelDateToISO(normalized["FECHA_CANCEL"]),
      tipo_pedido: toText(normalized["TIPO_PEDIDO"]),
      piezas: toInt(normalized["PIEZAS"]),
      corte_origen: toText(normalized["CORTE"]),
      fase_actual: "Por Programar",
      fecha_aprobacion_diseno: excelDateToISO(normalized["FECHA_STATUS2"]),
      maquilero_nombre: toText(normalized["MAQUILERO"]),
    }

    result.push(row)
  }

  // Avoid unused FIELD_MAP warning
  void FIELD_MAP

  return result
}

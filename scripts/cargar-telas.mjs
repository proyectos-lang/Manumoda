/**
 * Carga inicial del catálogo de telas.
 *
 * Lee "Registro telas oficial con precio (10-JUN-24).xlsx" y crea los
 * proveedores y las telas en `articulos`.
 *
 * POR QUÉ UN SCRIPT Y NO UN INSERT EN SQL:
 *   Son 913 renglones que hay que limpiar antes de escribir: normalizar
 *   el acabado (el archivo lo escribe de seis formas), resolver 157
 *   claves repetidas y ligar 78 proveedores por nombre. Un INSERT
 *   gigante no puede reportar qué renglón falló ni por qué.
 *
 * ES RE-EJECUTABLE: usa upsert por clave, así que correrlo dos veces
 * deja el mismo resultado en vez de duplicar el catálogo.
 *
 * PREREQUISITO: script 058 ejecutado.
 *
 * Uso:
 *   node scripts/cargar-telas.mjs <ruta-del-xlsx> [--aplicar]
 *
 * Sin --aplicar solo simula y reporta: no escribe nada.
 */

import fs from "fs"
import * as XLSX from "xlsx"

const ARCHIVO = process.argv[2]
const APLICAR = process.argv.includes("--aplicar")
const IDEMPRESA = 1

if (!ARCHIVO) {
  console.error("Uso: node scripts/cargar-telas.mjs <ruta-del-xlsx> [--aplicar]")
  process.exit(1)
}

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Accept-Profile": "manumoda",
  "Content-Profile": "manumoda",
}

const txt = (v) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null)
const up = (v) => txt(v)?.toUpperCase() ?? null

/**
 * El archivo escribe el acabado de seis formas: RIGIDA, RIGIDO, RIG,
 * STRECH, STRCH, ESTRECH. Sin normalizar, filtrar por "rígida" perdería
 * las 296 que dicen "RIGIDO".
 */
function acabado(v) {
  const s = up(v) ?? ""
  if (/^RIG/.test(s)) return "Rigida"
  if (/^(E?STR|STRCH)/.test(s)) return "Stretch"
  if (/CIRC/.test(s)) return "Circular"
  return null
}

// ── 1. Leer y validar ───────────────────────────────────────────────────────

const wb = XLSX.read(fs.readFileSync(ARCHIVO), { type: "buffer" })
const filas = XLSX.utils
  .sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
  // Los encabezados del archivo traen espacios sueltos (" Precio por metro ").
  .map((r) => {
    const o = {}
    for (const [k, v] of Object.entries(r)) o[String(k).trim()] = v
    return o
  })

const validas = []
const rechazadas = []

filas.forEach((r, i) => {
  const linea = i + 2
  const clave = up(r["Clave Interna"])
  const precio = r["Precio por metro"]
  const ac = acabado(r["Tipo de tela (Stretch, rigida, circular)"])

  if (!clave) return rechazadas.push({ linea, motivo: "sin clave interna" })
  if (typeof precio !== "number" || !isFinite(precio) || precio <= 0)
    return rechazadas.push({ linea, clave, motivo: `precio inválido: ${precio}` })
  if (!ac)
    return rechazadas.push({
      linea, clave,
      motivo: `acabado no reconocido: ${r["Tipo de tela (Stretch, rigida, circular)"]}`,
    })

  validas.push({
    linea,
    clave,
    familia: up(r["Tela"]),
    acabado: ac,
    nombre_tela: up(r["Nombre de la tela"]),
    color: up(r["Color"]),
    proveedor: up(r["Proveedor"]),
    composicion: txt(r["Composición de la tela informativo"]),
    descripcion: txt(r["Descripción"]),
    consecutivo: typeof r["Consecutivo"] === "number" ? r["Consecutivo"] : null,
    precio: Math.round(precio * 10000) / 10000,
  })
})

// ── 2. Deduplicar ───────────────────────────────────────────────────────────
//
// 157 claves vienen repetidas. Las idénticas se colapsan sin pérdida.
// Cuando difieren, se conserva EL ÚLTIMO renglón del archivo: la lista se
// fue actualizando hacia abajo, así que lo de abajo es lo vigente.
// Decisión del usuario, 2026-09-14.

const porClave = {}
for (const f of validas) (porClave[f.clave] = porClave[f.clave] ?? []).push(f)

const telas = []
const conflictos = []

for (const [clave, v] of Object.entries(porClave)) {
  if (v.length === 1) {
    telas.push(v[0])
    continue
  }
  const firma = (f) =>
    JSON.stringify([f.familia, f.acabado, f.nombre_tela, f.color, f.proveedor, f.precio])
  const distintas = new Set(v.map(firma))
  // El último renglón del archivo gana.
  const elegida = v[v.length - 1]
  telas.push(elegida)
  if (distintas.size > 1) {
    conflictos.push({
      clave,
      campo: new Set(v.map((f) => f.precio)).size > 1 ? "precio" : "otros datos",
      opciones: v.map((f) => ({ linea: f.linea, precio: f.precio })),
      elegido: { linea: elegida.linea, precio: elegida.precio },
    })
  }
}

const proveedores = [...new Set(telas.map((t) => t.proveedor).filter(Boolean))].sort()

console.log("═".repeat(66))
console.log("  CARGA DE TELAS", APLICAR ? "· APLICANDO" : "· SIMULACIÓN (no escribe)")
console.log("═".repeat(66))
console.log(`  renglones en el archivo : ${filas.length}`)
console.log(`  válidos                 : ${validas.length}`)
console.log(`  rechazados              : ${rechazadas.length}`)
console.log(`  claves únicas a cargar  : ${telas.length}`)
console.log(`  proveedores             : ${proveedores.length}`)
console.log(`  conflictos resueltos    : ${conflictos.length} (gana el último renglón)`)

if (rechazadas.length) {
  console.log("\n  RECHAZADOS:")
  for (const r of rechazadas.slice(0, 20))
    console.log(`    línea ${r.linea} ${r.clave ?? ""} — ${r.motivo}`)
}

if (conflictos.length) {
  console.log("\n  CONFLICTOS (se cargó el último renglón del archivo):")
  for (const c of conflictos)
    console.log(
      `    ${c.clave} [${c.campo}] ${c.opciones.map((o) => `L${o.linea}:$${o.precio}`).join(" vs ")}` +
      ` -> $${c.elegido.precio}`,
    )
}

if (!APLICAR) {
  console.log("\n  Simulación: no se escribió nada. Agrega --aplicar para cargar.")
  process.exit(0)
}

// ── 3. Proveedores ──────────────────────────────────────────────────────────

async function api(path, init) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...init?.headers } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

console.log("\n  Creando proveedores…")
const existentes = await api(`proveedores?select=id,nombre&idempresa=eq.${IDEMPRESA}`)
const idPorNombre = new Map(existentes.map((p) => [String(p.nombre).trim().toUpperCase(), p.id]))

const nuevos = proveedores.filter((p) => !idPorNombre.has(p))
if (nuevos.length) {
  const creados = await api("proveedores", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(nuevos.map((nombre) => ({ idempresa: IDEMPRESA, nombre }))),
  })
  for (const p of creados) idPorNombre.set(String(p.nombre).trim().toUpperCase(), p.id)
}
console.log(`  proveedores: ${nuevos.length} nuevos, ${existentes.length} ya existían`)

// ── 4. Telas ────────────────────────────────────────────────────────────────

const registros = telas.map((t) => ({
  idempresa: IDEMPRESA,
  tipo: "Tela",
  clave: t.clave,
  // El nombre corto es lo que se ve en las listas; la descripción larga
  // del archivo va en su propia columna.
  nombre: [t.familia, t.nombre_tela, t.color].filter(Boolean).join(" ") || t.clave,
  unidad_medida: "Metro",
  costo_unitario: t.precio,
  idproveedor: idPorNombre.get(t.proveedor) ?? null,
  tela_familia: t.familia,
  tela_acabado: t.acabado,
  tela_nombre: t.nombre_tela,
  tela_color: t.color,
  tela_composicion: t.composicion,
  descripcion: t.descripcion,
  consecutivo: t.consecutivo,
  activo: true,
}))

console.log("  Cargando telas…")
// En lotes: un POST con 756 objetos puede exceder el límite del servidor
// y, si falla, no dice cuál renglón lo rompió.
const LOTE = 100
let cargadas = 0
for (let i = 0; i < registros.length; i += LOTE) {
  const lote = registros.slice(i, i + LOTE)
  await api("articulos?on_conflict=idempresa,clave", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(lote),
  })
  cargadas += lote.length
  process.stdout.write(`\r  ${cargadas}/${registros.length}`)
}
console.log()

// ── 5. Verificar contra la base ─────────────────────────────────────────────

const enBase = await api(
  `articulos?select=id&tipo=eq.Tela&idempresa=eq.${IDEMPRESA}&limit=2000`,
)
console.log(`\n  telas en la base: ${enBase.length} (esperado ${telas.length})`)

const sinPrecio = await api(
  `articulos?select=clave&tipo=eq.Tela&idempresa=eq.${IDEMPRESA}&costo_unitario=is.null`,
)
const sinProv = await api(
  `articulos?select=clave&tipo=eq.Tela&idempresa=eq.${IDEMPRESA}&idproveedor=is.null`,
)
console.log(`  sin precio: ${sinPrecio.length}   sin proveedor: ${sinProv.length}`)
console.log(
  enBase.length === telas.length && !sinPrecio.length && !sinProv.length
    ? "\n  ✓ Carga completa y verificada."
    : "\n  ⚠ Revisar: las cifras no cuadran.",
)

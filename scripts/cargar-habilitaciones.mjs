/**
 * Carga inicial del catálogo de habilitaciones.
 *
 * Lee "2026-HIBILITACIONES-REGISTRO DE HABILITACION.xlsx": 33 hojas, una
 * por tipo de producto, cada una con sus propias columnas.
 *
 * LOS DOS PROBLEMAS QUE RESUELVE:
 *
 * 1. CADA HOJA TIENE COLUMNAS DISTINTAS. No hay un juego que sirva para
 *    los 31 tipos. Lo común (clave, color, medida, proveedor, precio)
 *    se mapea a columnas; lo propio de cada tipo (#Hoyos, Talla,
 *    Departamento) se guarda en `atributos jsonb`.
 *
 * 2. EL MISMO CONCEPTO ESTÁ ESCRITO DE MUCHAS FORMAS. "Precio Unitario"
 *    aparece también como "Precio unitario", "Precio/ unitario",
 *    "Precio x unidad" y, en Botón y Gancho, solo como "Precio".
 *    "Descripción" convive con "Descripición". Por eso el mapeo es por
 *    lista de sinónimos sobre el encabezado normalizado, no por nombre
 *    exacto.
 *
 * Además, algunas hojas (Ojillos) traen una fila de "Columna1,
 * Columna3…" antes del encabezado real, así que el encabezado se
 * detecta buscando la fila que contiene CLAVE FORMULA.
 *
 * ES RE-EJECUTABLE: consulta qué claves ya existen y da de alta solo las
 * nuevas, actualizando el resto.
 *
 * PREREQUISITO: script 059 ejecutado.
 *
 * Uso:
 *   node scripts/cargar-habilitaciones.mjs <ruta-del-xlsx> [--aplicar]
 *
 * Sin --aplicar solo simula y reporta.
 */

import fs from "fs"
import * as XLSX from "xlsx"

const ARCHIVO = process.argv[2]
const APLICAR = process.argv.includes("--aplicar")
const IDEMPRESA = 1

if (!ARCHIVO) {
  console.error("Uso: node scripts/cargar-habilitaciones.mjs <ruta-del-xlsx> [--aplicar]")
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

/** Hojas que no son catálogo: el índice y una hoja suelta de pruebas. */
const NO_SON_CATALOGO = new Set(["Categrías", "1"])

const txt = (v) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null)
const up = (v) => txt(v)?.toUpperCase() ?? null

/** Encabezado normalizado: sin acentos, sin espacios, sin puntuación. */
const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "")

/**
 * Un precio puede venir como número, como "$.97" o como "$0.1330".
 * Devuelve null si no se puede interpretar, nunca 0: un 0 silencioso
 * haría que la habilitación pareciera gratis en la ficha técnica.
 */
function numero(v) {
  if (typeof v === "number") return isFinite(v) ? v : null
  const s = txt(v)
  if (!s) return null
  const limpio = s.replace(/[$\s,]/g, "")
  if (!/^-?\d*\.?\d+$/.test(limpio)) return null
  const n = Number(limpio)
  return isFinite(n) ? n : null
}

/**
 * El mismo campo aparece con muchos nombres entre hojas. Se busca por
 * lista de sinónimos, en orden: el primero que exista gana.
 */
const CAMPOS = {
  clave:        ["claveformula", "clave"],
  numero:       ["numero", "no"],
  categoria:    ["habilitacion", "habiltacion", "habiltiacion", "botonjeans"],
  material:     ["material", "tipomaterial", "tipoplasticometaletc", "tipo"],
  color:        ["color", "colorletras"],
  medida:       ["medidatamano", "tamano", "medidatamanomm", "medida", "medidatamano2"],
  unidadMedida: ["mm", "cm", "tipodemedida", "medida2", "medida3"],
  descripcionCorta: ["descripicion", "descripcionsegundocolor"],
  consecutivo:  ["consecutivo"],
  proveedor:    ["proveedor"],
  claveProv:    ["claveproveedor", "clavedeproveedor", "claveprovedor", "clavedelproveedor"],
  // El unitario primero; "precio" a secas queda al final porque en varias
  // hojas ES el unitario, pero en otras es el de mayoreo.
  precioUnit:   ["preciounitario", "preciounitariopormetro", "preciounitariounmetro",
                 "preciounitario2", "preciounitario3", "preciounidad", "preciounitarioxunidad",
                 "precioxunidad", "preciounitario1", "preciounitarioo", "preciounit"],
  precioMayoreo:["preciomayoreo", "preciodemayoreo", "precioporrollo", "precioporlote",
                 "preciodelote"],
  cantidadPaq:  ["cantidadpormayoreo", "cantidaddecierreporbolsa", "cantidadporetiqueta",
                 "cantidaddeproducto", "cantiodaddeproducto", "cantidad", "cantidadpormetros",
                 "cantidadmetros", "cantidadporrollometros", "cantidadpormetro",
                 "cantidaddecinta", "cantidaddebroches", "cantidaddecubrepolvo",
                 "cantidaddeetiqueta", "botonesxbolsa", "cantidaddepiezaporbolsa",
                 "cantidaddebotonporbolsa", "cantidaddeganchoporcaja", "metros"],
  descripcion:  ["descripcion"],
}

/** Campos que ya tienen columna propia: no se repiten dentro de `atributos`. */
const YA_MAPEADOS = new Set(Object.values(CAMPOS).flat())

function localizar(hdr, nombres) {
  for (const n of nombres) {
    const i = hdr.indexOf(n)
    if (i >= 0) return i
  }
  return -1
}

// ── 1. Leer todas las hojas ─────────────────────────────────────────────────

const wb = XLSX.read(fs.readFileSync(ARCHIVO), { type: "buffer" })

const items = []
const rechazadas = []
const porHoja = []

for (const hoja of wb.SheetNames) {
  if (NO_SON_CATALOGO.has(hoja)) continue

  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: null })
  if (filas.length < 2) continue

  // El encabezado no siempre es la primera fila: Ojillos trae una de
  // "Columna1, Columna3…" encima. Se busca la que tiene CLAVE FORMULA.
  let iHdr = filas.findIndex((f) =>
    (f ?? []).some((c) => ["claveformula", "clave"].includes(norm(c))),
  )
  if (iHdr < 0) iHdr = 0

  const hdr = (filas[iHdr] ?? []).map(norm)
  const col = {}
  for (const [k, sinonimos] of Object.entries(CAMPOS)) col[k] = localizar(hdr, sinonimos)

  if (col.clave < 0) {
    rechazadas.push({ hoja, motivo: "no se encontró la columna de clave" })
    continue
  }

  // Las columnas que esta hoja tiene y no están mapeadas: son sus
  // atributos propios (#Hoyos, Talla, Departamento…).
  const propias = hdr
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && !YA_MAPEADOS.has(h) && !/^columna\d*$/.test(h) &&
                       !/^contacto/.test(h) && !/^recuperandodatos/.test(h) &&
                       h !== norm(hoja) && h !== "modelo")

  let enHoja = 0
  for (let i = iHdr + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    const clave = up(f[col.clave])
    if (!clave) continue

    // El unitario es el que multiplica la ficha técnica. Si la hoja no lo
    // trae, se deriva de mayoreo / cantidad, que es de donde salió.
    let precio = col.precioUnit >= 0 ? numero(f[col.precioUnit]) : null
    let precioOrigen = "unitario"
    if (precio == null && col.precioMayoreo >= 0 && col.cantidadPaq >= 0) {
      const may = numero(f[col.precioMayoreo])
      const cant = numero(f[col.cantidadPaq])
      if (may != null && cant != null && cant > 0) {
        precio = Math.round((may / cant) * 1000000) / 1000000
        precioOrigen = "derivado de mayoreo/cantidad"
      }
    }
    // "Precio" a secas: en Botón y Gancho es el unitario.
    if (precio == null) {
      const iP = hdr.indexOf("precio")
      if (iP >= 0) {
        precio = numero(f[iP])
        precioOrigen = "columna Precio"
      }
    }

    if (precio == null || precio <= 0) {
      rechazadas.push({ hoja, fila: i + 1, clave, motivo: "sin precio utilizable" })
      continue
    }

    const atributos = {}
    for (const { h, i: j } of propias) {
      const v = f[j]
      if (v == null || String(v).trim() === "") continue
      atributos[h] = typeof v === "number" ? v : txt(v)
    }
    // Se conserva de dónde salió el precio: si mañana un costo no cuadra,
    // esto dice si vino del archivo o se calculó.
    if (precioOrigen !== "unitario") atributos._precio_origen = precioOrigen
    if (col.precioMayoreo >= 0) {
      const may = numero(f[col.precioMayoreo])
      if (may != null) atributos._precio_mayoreo = may
    }
    if (col.cantidadPaq >= 0) {
      const c = numero(f[col.cantidadPaq])
      if (c != null) atributos._cantidad_paquete = c
    }

    const categoria = up(col.categoria >= 0 ? f[col.categoria] : null) ?? up(hoja)
    const color = up(col.color >= 0 ? f[col.color] : null)
    const medidaVal = col.medida >= 0 ? txt(f[col.medida]) : null
    const medidaUni = col.unidadMedida >= 0 ? txt(f[col.unidadMedida]) : null

    items.push({
      hoja,
      clave,
      categoria,
      material: up(col.material >= 0 ? f[col.material] : null),
      color,
      medida: [medidaVal, medidaUni].filter(Boolean).join(" ") || null,
      descripcion: txt(col.descripcion >= 0 ? f[col.descripcion] : null)
        ?? txt(col.descripcionCorta >= 0 ? f[col.descripcionCorta] : null),
      claveProv: txt(col.claveProv >= 0 ? f[col.claveProv] : null),
      consecutivo: col.consecutivo >= 0 ? numero(f[col.consecutivo]) : null,
      proveedor: up(col.proveedor >= 0 ? f[col.proveedor] : null),
      precio: Math.round(precio * 1000000) / 1000000,
      atributos,
    })
    enHoja++
  }
  porHoja.push({ hoja, filas: enHoja, atributos: propias.map((p) => p.h) })
}

// ── 2. Deduplicar por clave ─────────────────────────────────────────────────
// Mismo criterio que en telas: gana el último renglón del archivo.

const porClave = {}
for (const it of items) (porClave[it.clave] = porClave[it.clave] ?? []).push(it)

const finales = []
let repetidas = 0
for (const [, v] of Object.entries(porClave)) {
  if (v.length > 1) repetidas += v.length - 1
  finales.push(v[v.length - 1])
}

const proveedores = [...new Set(finales.map((t) => t.proveedor).filter(Boolean))].sort()

console.log("═".repeat(70))
console.log("  CARGA DE HABILITACIONES", APLICAR ? "· APLICANDO" : "· SIMULACIÓN (no escribe)")
console.log("═".repeat(70))
console.log(`  hojas procesadas       : ${porHoja.length}`)
console.log(`  renglones leídos       : ${items.length}`)
console.log(`  claves repetidas       : ${repetidas} (gana el último renglón)`)
console.log(`  a cargar               : ${finales.length}`)
console.log(`  proveedores            : ${proveedores.length}`)
console.log(`  rechazados             : ${rechazadas.length}`)

console.log("\n  POR HOJA:")
for (const h of porHoja.sort((a, b) => b.filas - a.filas)) {
  const attrs = h.atributos.length ? `  propios: ${h.atributos.slice(0, 6).join(", ")}` : ""
  console.log(`    ${h.hoja.padEnd(30)} ${String(h.filas).padStart(4)}${attrs}`)
}

if (rechazadas.length) {
  console.log("\n  RECHAZADOS:")
  const porMotivo = {}
  for (const r of rechazadas) {
    const k = `${r.hoja} — ${r.motivo}`
    porMotivo[k] = (porMotivo[k] ?? 0) + 1
  }
  for (const [k, n] of Object.entries(porMotivo)) console.log(`    ${k} (${n})`)
}

if (!APLICAR) {
  console.log("\n  Simulación: no se escribió nada. Agrega --aplicar para cargar.")
  process.exit(0)
}

// ── 3. Escribir ─────────────────────────────────────────────────────────────

async function api(path, init) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...init?.headers } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  const cuerpo = await r.text()
  return cuerpo ? JSON.parse(cuerpo) : null
}

console.log("\n  Creando proveedores…")
const provExistentes = await api(`proveedores?select=id,nombre&idempresa=eq.${IDEMPRESA}&limit=2000`)
const idPorNombre = new Map(provExistentes.map((p) => [String(p.nombre).trim().toUpperCase(), p.id]))
const nuevosProv = proveedores.filter((p) => !idPorNombre.has(p))
if (nuevosProv.length) {
  const creados = await api("proveedores", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(nuevosProv.map((nombre) => ({ idempresa: IDEMPRESA, nombre }))),
  })
  for (const p of creados) idPorNombre.set(String(p.nombre).trim().toUpperCase(), p.id)
}
console.log(`  proveedores: ${nuevosProv.length} nuevos, ${provExistentes.length} ya existían`)

const registros = finales.map((t) => ({
  idempresa: IDEMPRESA,
  tipo: "Habilitacion",
  clave: t.clave,
  nombre: [t.categoria, t.material, t.color, t.medida].filter(Boolean).join(" ") || t.clave,
  unidad_medida: "Pieza",
  costo_unitario: t.precio,
  idproveedor: t.proveedor ? idPorNombre.get(t.proveedor) ?? null : null,
  categoria: t.categoria,
  material: t.material,
  color: t.color,
  medida: t.medida,
  descripcion: t.descripcion,
  clave_proveedor: t.claveProv,
  consecutivo: t.consecutivo,
  atributos: t.atributos,
  activo: true,
}))

console.log("  Cargando habilitaciones…")
// Sin ON CONFLICT: el índice único es sobre upper(trim(clave)), una
// expresión, y PostgREST no puede apuntarle nombrando columnas (42P10).
const yaEnBase = await api(
  `articulos?select=id,clave&tipo=eq.Habilitacion&idempresa=eq.${IDEMPRESA}&limit=5000`,
)
const idPorClave = new Map(yaEnBase.map((a) => [String(a.clave).trim().toUpperCase(), a.id]))

const nuevos = registros.filter((r) => !idPorClave.has(r.clave))
const existentes = registros.filter((r) => idPorClave.has(r.clave))

const LOTE = 100
let n = 0
for (let i = 0; i < nuevos.length; i += LOTE) {
  await api("articulos", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(nuevos.slice(i, i + LOTE)),
  })
  n += Math.min(LOTE, nuevos.length - i)
  process.stdout.write(`\r  altas ${n}/${nuevos.length}`)
}
if (nuevos.length) console.log()

let act = 0
for (const r of existentes) {
  const { clave, idempresa, tipo, ...cambios } = r
  await api(`articulos?id=eq.${idPorClave.get(clave)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(cambios),
  })
  act++
  process.stdout.write(`\r  actualizadas ${act}/${existentes.length}`)
}
if (existentes.length) console.log()

// ── 4. Verificar ────────────────────────────────────────────────────────────

const enBase = await api(
  `articulos?select=id&tipo=eq.Habilitacion&idempresa=eq.${IDEMPRESA}&limit=5000`,
)
const sinPrecio = await api(
  `articulos?select=clave&tipo=eq.Habilitacion&idempresa=eq.${IDEMPRESA}&costo_unitario=is.null`,
)
const telas = await api(`articulos?select=id&tipo=eq.Tela&idempresa=eq.${IDEMPRESA}&limit=5000`)

console.log(`\n  habilitaciones en la base: ${enBase.length} (esperado ${finales.length})`)
console.log(`  sin precio: ${sinPrecio.length}`)
console.log(`  telas intactas: ${telas.length} (deben seguir siendo 756)`)
console.log(
  enBase.length === finales.length && !sinPrecio.length && telas.length === 756
    ? "\n  ✓ Carga completa y verificada."
    : "\n  ⚠ Revisar: las cifras no cuadran.",
)

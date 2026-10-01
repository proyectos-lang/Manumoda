/**
 * Carga un RepProduccion del sistema anterior.
 *
 * QUE HACE:
 *   · Los folios que no existen se INSERTAN.
 *   · Los que ya existen se ACTUALIZAN con lo que traiga el archivo.
 *   · Los folios de la base que el archivo no menciona NO se tocan: el
 *     archivo es un corte del sistema viejo, no la verdad completa.
 *
 * QUE NO TOCA, Y POR QUE:
 *   · `fase_actual` — la calcula el sistema desde el avance real. El
 *     archivo no la trae, y ponerla en "Por Programar" retrocederia
 *     folios que ya van en S3 o S7.
 *   · `idcliente` — el vinculo al catalogo de clientes es de Manumoda.
 *     Se resuelve aparte, por nombre, y solo cuando el archivo trae uno
 *     que coincide.
 *   · Un campo VACIO en el archivo no borra lo que haya en la base. El
 *     sistema viejo deja celdas en blanco por no haberlas capturado,
 *     no para decir "esto no existe".
 *
 * Uso:  node scripts/cargar-repproduccion.mjs <archivo.xlsx> [--aplicar]
 *       Sin --aplicar solo simula y reporta.
 */
import fs from "node:fs"
import path from "node:path"
import XLSX from "xlsx"

// ── Conexion ──
const raiz = path.resolve(import.meta.dirname, "..")
for (const linea of fs.readFileSync(path.join(raiz, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const IDEMPRESA = 1

/**
 * Una llamada a PostgREST, con reintentos.
 *
 * La carga son cientos de peticiones seguidas y un corte de red de un
 * segundo bastaba para abortarla a medias: unos folios escritos y
 * otros no, sin saber cuales. Se reintenta con esperas crecientes y
 * solo se rinde tras varios intentos.
 *
 * Los errores de la BASE (4xx) no se reintentan: un dato mal formado
 * no mejora por insistir.
 */
async function api(ruta, init = {}, intento = 1) {
  const MAX = 4
  let r
  try {
    r = await fetch(`${URL}/rest/v1/${ruta}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Accept-Profile": "manumoda",
      "Content-Profile": "manumoda",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  } catch (e) {
    // Fallo de red: no llego a la base, asi que reintentar es seguro.
    if (intento >= MAX) throw e
    const espera = 1000 * intento
    console.log(`  (red caida, reintento ${intento}/${MAX - 1} en ${espera / 1000}s)`)
    await new Promise((ok) => setTimeout(ok, espera))
    return api(ruta, init, intento + 1)
  }
  const txt = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${ruta}: ${txt.slice(0, 300)}`)
  return txt ? JSON.parse(txt) : null
}

/** PostgREST corta en 1000 filas y no avisa: solo paginar lo vence. */
async function fetchAll(ruta) {
  const out = []
  const paso = 1000
  for (let d = 0; ; d += paso) {
    const p = await api(ruta, {
      headers: { Range: `${d}-${d + paso - 1}`, "Range-Unit": "items" },
    })
    out.push(...p)
    if (p.length < paso) break
  }
  return out
}

// ── Conversiones ──

/** Un entero, o null si la celda viene vacia o no es un numero. */
function entero(v) {
  if (v == null || String(v).trim() === "") return null
  const n = Number(String(v).replace(/[, ]/g, ""))
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Un decimal, o null. Mismo criterio que `entero`. */
function decimal(v) {
  if (v == null || String(v).trim() === "") return null
  const n = Number(String(v).replace(/[$, ]/g, ""))
  return Number.isFinite(n) ? n : null
}

function texto(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === "" ? null : s
}

/**
 * "dd/mm/aaaa" a "aaaa-mm-dd".
 *
 * Se parte la cadena en vez de usar `new Date`: esa lee "29/09/2026"
 * como mes 29 o la interpreta en UTC, y en Mexico la fecha caeria un
 * dia antes. El sistema viejo siempre exporta dd/mm/aaaa.
 *
 * Excel tambien puede entregar un numero de serie si la celda estaba
 * formateada como fecha; se contempla.
 */
function fecha(v) {
  if (v == null || String(v).trim() === "") return null
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mes, a] = m
    return `${a}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  // Serie de Excel: dias desde 1899-12-30.
  const n = Number(s)
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const base = Date.UTC(1899, 11, 30)
    return new Date(base + n * 86400000).toISOString().slice(0, 10)
  }
  return null
}

// ── Lectura ──
const archivo = process.argv[2]
const APLICAR = process.argv.includes("--aplicar")
if (!archivo) {
  console.error("Uso: node scripts/cargar-repproduccion.mjs <archivo.xlsx> [--aplicar]")
  process.exit(1)
}

const wb = XLSX.readFile(archivo)
const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
console.log(`archivo: ${path.basename(archivo)} — ${filas.length} filas`)

// Las filas sin folio son basura del reporte, no pedidos.
const utiles = filas.filter((f) => texto(f.FOLIO) != null)
if (utiles.length < filas.length) {
  console.log(`  ${filas.length - utiles.length} fila(s) sin folio, descartadas`)
}

// Dentro del archivo, el ultimo gana: es lo que hace el cargador del
// Panel General y asi los dos coinciden.
const porFolio = new Map()
for (const f of utiles) porFolio.set(texto(f.FOLIO), f)
if (porFolio.size < utiles.length) {
  console.log(`  ${utiles.length - porFolio.size} folio(s) repetidos, se usa el ultimo`)
}

// ── El mapeo ──
function aOrden(f) {
  return {
    folio: texto(f.FOLIO),
    num_pedido: texto(f.NUMPED),
    modelo: texto(f.MODELO),
    familia: texto(f.FAMILIA),
    categoria: texto(f.CATEGORIA),
    cliente: texto(f.CLIENTE),
    tipo_pedido: texto(f.TIPO_PEDIDO),
    corte_origen: texto(f.CORTE),
    maquilero: texto(f.MAQUILERO),

    fecha_pedido: fecha(f.FECHA),
    fecha_cancelacion: fecha(f.FECHA_CANCEL),
    fecha_s1: fecha(f.FECHA_STATUS1),
    fecha_s2: fecha(f.FECHA_STATUS2),
    fecha_s3: fecha(f.FECHA_STATUS3),
    fecha_s4: fecha(f.FECHA_STATUS4),
    fecha_s5: fecha(f.FECHA_STATUS5),
    fecha_s6: fecha(f.FECHA_STATUS6),
    fecha_s7: fecha(f.FECHA_STATUS7),

    piezas: entero(f.PIEZAS),
    piezas_cortadas: entero(f.PIEZAS_CORTADAS),

    precio_venta: decimal(f.PRECIO_VENTA),
    precio_publico: decimal(f.PRECIO_PUBLICO),
    costo_maquila: decimal(f["Costo Maquila"]),
    costo_lavanderia: decimal(f["Costo Lavanderia"]),
    costo_bordado: decimal(f["Costo Bordado"]),
    costo_estampado: decimal(f["Costo Estampado"]),
    costo_corte_externo: decimal(f["Costo Corte Externo"]),
    costo_otro: decimal(f["Costo Otro"]),
    costo_fijo: decimal(f.COSTO_FIJO),
  }
}

/** Quita los campos nulos: un vacio del archivo no debe borrar la base. */
function soloConValor(o) {
  const out = {}
  for (const [k, v] of Object.entries(o)) if (v != null) out[k] = v
  return out
}

// ── Contra la base ──
const base = await fetchAll(
  `ordenes_produccion?select=id,folio&idempresa=eq.${IDEMPRESA}`,
)
const idPorFolio = new Map(base.map((o) => [String(o.folio).trim(), o.id]))

// El catalogo de clientes, para enlazar los nuevos por nombre.
const clientes = await api(`clientes?select=id,nombre&idempresa=eq.${IDEMPRESA}`)
const idCliente = new Map(
  clientes.map((c) => [String(c.nombre).trim().toUpperCase(), c.id]),
)

const nuevos = []
const cambios = []
const sinCliente = new Set()

for (const f of porFolio.values()) {
  const o = aOrden(f)
  const datos = soloConValor(o)
  // El cliente del catalogo, si el nombre coincide.
  //
  // SHASA se unifico en el script 073: el sistema viejo sigue
  // exportando "SERVICIOS SHASA SR DE CV" y aqui se dobla al nombre
  // oficial, o el folio quedaria sin enlazar y el texto contradiria al
  // catalogo.
  if (o.cliente) {
    const nombre = o.cliente.toUpperCase().startsWith("SERVICIOS SHASA")
      ? "SERVICIOS SHASA"
      : o.cliente
    const id = idCliente.get(nombre.toUpperCase())
    if (id) {
      datos.idcliente = id
      // El texto se alinea al catalogo: las dos columnas no deben
      // contradecirse.
      datos.cliente = nombre
    } else {
      sinCliente.add(o.cliente)
    }
  }

  const existe = idPorFolio.get(o.folio)
  if (existe) {
    cambios.push({ id: existe, datos })
  } else {
    // Un folio nuevo nace sin programar; de ahi en adelante lo mueve el
    // sistema. Si el archivo trae fechas de avance, el estado real se
    // reconstruye desde ellas.
    nuevos.push({ idempresa: IDEMPRESA, fase_actual: "Por Programar", ...datos })
  }
}

console.log(`\n  nuevos a insertar : ${nuevos.length}`)
console.log(`  existentes a actualizar: ${cambios.length}`)
if (sinCliente.size)
  console.log(`  clientes del archivo sin catalogo: ${[...sinCliente].join(", ")}`)

if (!APLICAR) {
  console.log("\n(simulacion — nada se escribio. Agregar --aplicar para ejecutar)")
  process.exit(0)
}

// ── Escritura ──
if (nuevos.length) {
  // PostgREST exige que TODOS los objetos de un lote tengan las mismas
  // claves (PGRST102), y al quitar los nulos cada folio quedaba con un
  // juego distinto. Se completan con null los que falten: aqui null si
  // significa "nace sin ese dato", porque la fila no existia antes.
  const claves = [...new Set(nuevos.flatMap((o) => Object.keys(o)))]
  const parejos = nuevos.map((o) =>
    Object.fromEntries(claves.map((k) => [k, k in o ? o[k] : null])),
  )
  const LOTE = 50
  for (let i = 0; i < parejos.length; i += LOTE) {
    await api("ordenes_produccion", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(parejos.slice(i, i + LOTE)),
    })
  }
  console.log(`\ninsertados: ${nuevos.length}`)
}

let n = 0
for (const c of cambios) {
  await api(`ordenes_produccion?id=eq.${c.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(c.datos),
  })
  n++
  if (n % 100 === 0) console.log(`  actualizados: ${n}/${cambios.length}`)
}
console.log(`actualizados: ${n}`)

const total = await fetchAll(`ordenes_produccion?select=id&idempresa=eq.${IDEMPRESA}`)
console.log(`\nordenes en la base: ${total.length}`)

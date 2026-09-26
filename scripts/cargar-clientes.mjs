/**
 * Carga el catálogo de clientes que entregó operación (26-sep-2026).
 *
 * QUÉ HACE Y QUÉ NO:
 *   Solo INSERTA lo que falta. Los clientes que ya existen se dejan
 *   intactos, con sus órdenes y su historia; el script se puede volver
 *   a correr sin duplicar nada.
 *
 *   No borra: si mañana sobra un cliente de esta lista, se inactiva o
 *   se elimina desde el módulo, que es donde se ve si tiene órdenes.
 *
 * EL NUMCLI SE GUARDA EN `notas`:
 *   La lista trae la numeración del sistema del cliente. Manumoda usa
 *   su propio `id` —los 7 que ya existían tienen otro— así que el
 *   NUMCLI se anota como texto: es la única forma de cruzar después
 *   las dos numeraciones, y no merece una columna propia mientras solo
 *   sirva de referencia.
 *
 * EL COTEJO ES POR NOMBRE NORMALIZADO:
 *   Sin normalizar, "Mystika" y "MYSTIKA " entrarían como dos. La base
 *   tiene un índice único sobre `upper(btrim(nombre))` que lo impediría
 *   con error 23505, pero conviene no llegar ahí: así el script informa
 *   en vez de fallar a medias.
 *
 * Uso:  node scripts/cargar-clientes.mjs
 */
import fs from "node:fs"
import path from "node:path"

// ── Conexión ──
const raiz = path.resolve(import.meta.dirname, "..")
for (const linea of fs.readFileSync(path.join(raiz, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const IDEMPRESA = 1

if (!URL || !KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o la llave en .env.local")
  process.exit(1)
}

async function api(ruta, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
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
  const texto = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${ruta}: ${texto.slice(0, 300)}`)
  // `return=minimal` responde 201 con el cuerpo vacío: parsearlo reventaría.
  return texto ? JSON.parse(texto) : null
}

/** El catálogo tal como lo entregó operación, con su NUMCLI. */
const LISTA = [
  [1, "COMERCIAL IAC"],
  [2, "MILANO OPERADORA"],
  [3, "TIENDAS ALKA"],
  [4, "DISEÑO Y MODA PARAZOY"],
  [5, "GRUPO COMERCIAL DSW"],
  [6, "MYSTIKA"],
  [7, "JAIME YEDID SHEREM"],
  [8, "ZETMARKET"],
  [9, "CORPORACION RNMD"],
  [10, "CAVANNA TEXTIL"],
  [11, "ANUAR JOSE LAYON SOLIS"],
  [12, "ELSA FERNANDA MELIS PAREDES"],
  [13, "EMILIO HERMILO BALCAZAR VERA"],
  [14, "FERNANDO EMILIO BORGES HERNANDEZ"],
  [15, "IRAIS MENDOZA FLORES"],
  [16, "PSIQUE VICTORIA RIVERO MARTINEZ"],
  [17, "ELIZABETH LOPEZ MALDONADO"],
  [18, "KATHRIN DENISE HANDTKE PEREZ PALACIOS"],
  [19, "TOXIC INDUSTRIES"],
  [20, "RICARDO BALTAZAR DELGADILLO DE LA CRUZ"],
  [21, "GURMEX SEGURIDAD PRIVADA"],
  [22, "SERVICIOS SHASA"],
]

const norm = (s) => String(s ?? "").trim().toUpperCase()

const yaEstan = await api(`clientes?select=id,nombre&idempresa=eq.${IDEMPRESA}`)
const existe = new Set(yaEstan.map((c) => norm(c.nombre)))

const aCrear = LISTA.filter(([, nombre]) => !existe.has(norm(nombre))).map(
  ([num, nombre]) => ({
    idempresa: IDEMPRESA,
    nombre: nombre.trim(),
    activo: true,
    notas: `NUMCLI ${num} del sistema del cliente`,
  }),
)

console.log(`En la base: ${yaEstan.length} · en la lista: ${LISTA.length}`)

if (aCrear.length === 0) {
  console.log("Nada que crear: la lista completa ya está dada de alta.")
} else {
  console.log(`Creando ${aCrear.length}…`)
  const creados = await api("clientes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(aCrear),
  })
  for (const c of creados) {
    console.log(`  id=${String(c.id).padStart(2)}  ${c.nombre}`)
  }
}

// ── Comprobación ──
const final = await api(
  `vw_clientes?select=nombre,ordenes&idempresa=eq.${IDEMPRESA}`,
)
const faltan = LISTA.filter(
  ([, n]) => !final.some((c) => norm(c.nombre) === norm(n)),
)
console.log(`\nTotal de clientes: ${final.length}`)
console.log(`Órdenes enlazadas: ${final.reduce((s, c) => s + c.ordenes, 0)}`)
console.log(
  faltan.length === 0
    ? "OK: toda la lista está en la base."
    : "FALTAN: " + faltan.map(([, n]) => n).join(", "),
)

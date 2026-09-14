/**
 * Generador de códigos QR, sin dependencias.
 *
 * Se implementa aquí en vez de instalar un paquete porque el proyecto usa
 * pnpm y agregar la dependencia con npm rompía el árbol de módulos. Un QR
 * es un formato cerrado y bien especificado (ISO/IEC 18004): para el caso
 * de uso —un código corto de rollo, alfanumérico— cabe en 150 líneas y no
 * vuelve a cambiar nunca.
 *
 * Alcance deliberado: versiones 1 a 10, corrección de errores nivel M,
 * modo byte. Cubre hasta 213 caracteres, muy por encima de un código de
 * rollo como "TEL-001-260914120000-101".
 */

// ─── Campo de Galois GF(256), para la corrección de errores ─────────────────

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d // polinomio primitivo
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]

/** Polinomio generador para `grado` bytes de corrección. */
function generador(grado: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < grado; i++) {
    const nuevo = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j++) {
      nuevo[j] ^= poly[j]
      nuevo[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = nuevo
  }
  return poly
}

/** Bytes de corrección de Reed-Solomon para un bloque de datos. */
function correccion(datos: Uint8Array, grado: number): Uint8Array {
  const gen = generador(grado)
  const res = new Uint8Array(datos.length + grado)
  res.set(datos)
  for (let i = 0; i < datos.length; i++) {
    const factor = res[i]
    if (factor === 0) continue
    for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor)
  }
  return res.slice(datos.length)
}

// ─── Tablas de capacidad (nivel M, modo byte) ───────────────────────────────

/** Por versión: [capacidad en bytes, bytes de corrección por bloque, bloques]. */
const VERSIONES: [number, number, number][] = [
  [14, 10, 1],   // v1
  [26, 16, 1],   // v2
  [42, 26, 1],   // v3
  [62, 18, 2],   // v4
  [84, 24, 2],   // v5
  [106, 16, 4],  // v6
  [122, 18, 4],  // v7
  [152, 22, 4],  // v8
  [180, 22, 5],  // v9
  [213, 26, 5],  // v10
]

const ALINEACION: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

/** Información de formato (nivel M + máscara), con su BCH ya calculado. */
const FORMATO = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
]

// ─── Construcción de la matriz ──────────────────────────────────────────────

type Matriz = { size: number; modulos: Uint8Array; reservado: Uint8Array }

function nuevaMatriz(size: number): Matriz {
  return {
    size,
    modulos: new Uint8Array(size * size),
    reservado: new Uint8Array(size * size),
  }
}

function poner(m: Matriz, x: number, y: number, valor: number, reservar = true) {
  m.modulos[y * m.size + x] = valor
  if (reservar) m.reservado[y * m.size + x] = 1
}

/** Los tres cuadros de las esquinas, que orientan al lector. */
function patronesBusqueda(m: Matriz) {
  const esquinas = [
    [0, 0],
    [m.size - 7, 0],
    [0, m.size - 7],
  ]
  for (const [ox, oy] of esquinas) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = ox + x
        const py = oy + y
        if (px < 0 || px >= m.size || py < 0 || py >= m.size) continue
        const borde = x === 0 || x === 6 || y === 0 || y === 6
        const centro = x >= 2 && x <= 4 && y >= 2 && y <= 4
        poner(m, px, py, borde || centro ? 1 : 0)
      }
    }
  }
}

function patronesAlineacion(m: Matriz, version: number) {
  const pos = ALINEACION[version]
  for (const cy of pos) {
    for (const cx of pos) {
      // Las esquinas ya las ocupan los patrones de búsqueda
      if (m.reservado[cy * m.size + cx]) continue
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const borde = Math.abs(x) === 2 || Math.abs(y) === 2
          const centro = x === 0 && y === 0
          poner(m, cx + x, cy + y, borde || centro ? 1 : 0)
        }
      }
    }
  }
}

function patronesTiempo(m: Matriz) {
  for (let i = 8; i < m.size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0
    if (!m.reservado[6 * m.size + i]) poner(m, i, 6, v)
    if (!m.reservado[i * m.size + 6]) poner(m, 6, i, v)
  }
}

function reservarFormato(m: Matriz) {
  for (let i = 0; i < 9; i++) {
    if (!m.reservado[8 * m.size + i]) poner(m, i, 8, 0)
    if (!m.reservado[i * m.size + 8]) poner(m, 8, i, 0)
  }
  for (let i = 0; i < 8; i++) {
    poner(m, m.size - 1 - i, 8, 0)
    poner(m, 8, m.size - 1 - i, 0)
  }
  poner(m, 8, m.size - 8, 1) // módulo siempre oscuro
}

function escribirFormato(m: Matriz, mascara: number) {
  const bits = FORMATO[mascara]
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1
    if (i < 6) poner(m, 8, i, bit)
    else if (i < 8) poner(m, 8, i + 1, bit)
    else if (i === 8) poner(m, 7, 8, bit)
    else poner(m, 14 - i, 8, bit)

    if (i < 8) poner(m, m.size - 1 - i, 8, bit)
    else poner(m, 8, m.size - 15 + i, bit)
  }
}

/** Máscara 0: la más simple, y suficiente para un código corto. */
const enmascarar = (x: number, y: number) => (x + y) % 2 === 0

function colocarDatos(m: Matriz, datos: Uint8Array) {
  let bit = 0
  let arriba = true
  for (let col = m.size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // la columna de tiempo se salta
    for (let i = 0; i < m.size; i++) {
      const y = arriba ? m.size - 1 - i : i
      for (let j = 0; j < 2; j++) {
        const x = col - j
        if (m.reservado[y * m.size + x]) continue
        let v = 0
        if (bit < datos.length * 8) {
          v = (datos[bit >> 3] >> (7 - (bit & 7))) & 1
        }
        if (enmascarar(x, y)) v ^= 1
        poner(m, x, y, v, false)
        bit++
      }
    }
    arriba = !arriba
  }
}

// ─── API ────────────────────────────────────────────────────────────────────

/**
 * Construye la matriz de módulos del QR. `true` = módulo oscuro.
 *
 * @throws si el texto excede los 213 bytes que cubre esta implementación.
 */
export function generarQR(texto: string): boolean[][] {
  const bytes = new TextEncoder().encode(texto)

  const version = VERSIONES.findIndex(([cap]) => bytes.length <= cap) + 1
  if (version === 0) {
    throw new Error(`El texto excede la capacidad del QR (${bytes.length} bytes, máximo 213)`)
  }
  const [capacidad, ecPorBloque, bloques] = VERSIONES[version - 1]

  // Cabecera: modo byte (0100) + longitud + datos + terminador
  const bits: number[] = []
  const empujar = (valor: number, ancho: number) => {
    for (let i = ancho - 1; i >= 0; i--) bits.push((valor >> i) & 1)
  }
  empujar(0b0100, 4)
  empujar(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) empujar(b, 8)
  empujar(0, Math.min(4, capacidad * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const datos = new Uint8Array(capacidad)
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0)
    datos[i >> 3] = byte
  }
  // Relleno alternado, como manda la norma
  const relleno = [0xec, 0x11]
  for (let i = Math.ceil(bits.length / 8), k = 0; i < capacidad; i++, k++) {
    datos[i] = relleno[k % 2]
  }

  // Reparto en bloques y corrección de errores
  const porBloque = Math.floor(capacidad / bloques)
  const sobra = capacidad % bloques
  const dataBloques: Uint8Array[] = []
  const ecBloques: Uint8Array[] = []
  let off = 0
  for (let i = 0; i < bloques; i++) {
    const largo = porBloque + (i >= bloques - sobra ? 1 : 0)
    const bloque = datos.slice(off, off + largo)
    off += largo
    dataBloques.push(bloque)
    ecBloques.push(correccion(bloque, ecPorBloque))
  }

  // Intercalado
  const salida: number[] = []
  const maxLargo = Math.max(...dataBloques.map((b) => b.length))
  for (let i = 0; i < maxLargo; i++) {
    for (const b of dataBloques) if (i < b.length) salida.push(b[i])
  }
  for (let i = 0; i < ecPorBloque; i++) {
    for (const b of ecBloques) salida.push(b[i])
  }

  const size = 17 + version * 4
  const m = nuevaMatriz(size)
  patronesBusqueda(m)
  patronesAlineacion(m, version)
  patronesTiempo(m)
  reservarFormato(m)
  colocarDatos(m, new Uint8Array(salida))
  escribirFormato(m, 0)

  const matriz: boolean[][] = []
  for (let y = 0; y < size; y++) {
    const fila: boolean[] = []
    for (let x = 0; x < size; x++) fila.push(m.modulos[y * size + x] === 1)
    matriz.push(fila)
  }
  return matriz
}

/**
 * El QR como SVG, listo para imprimir.
 *
 * SVG y no canvas porque la etiqueta se manda a papel: un vector se imprime
 * nítido a cualquier tamaño, y un bitmap de 100 px sale borroso.
 */
export function qrComoSVG(texto: string, tamano = 120): string {
  const m = generarQR(texto)
  const n = m.length
  const quiet = 4 // margen obligatorio de 4 módulos
  const total = n + quiet * 2

  let path = ""
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (m[y][x]) path += `M${x + quiet},${y + quiet}h1v1h-1z`
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tamano}" height="${tamano}"`,
    ` viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="#fff"/>`,
    `<path d="${path}" fill="#000"/>`,
    `</svg>`,
  ].join("")
}

import type { PostgrestError } from "@supabase/supabase-js"

/**
 * Trae TODAS las filas de una consulta, sin el tope de 1000 de PostgREST.
 *
 * PostgREST corta en `db-max-rows` (1000 en Supabase) y NO avisa: devuelve
 * las primeras mil sin error. Una tabla que crece cruza ese número un día
 * cualquiera y desde entonces los tableros muestran de menos —bien
 * formateado y en silencio, que es la peor forma de estar mal—.
 *
 * `ordenes_produccion` ya va en 552 y sube con cada carga de folios.
 *
 * Se pide por páginas con `.range()` hasta que una vuelve incompleta. Se
 * piden PAGINA+1 filas y se descarta la sobrante: así la última página
 * llena no obliga a una consulta extra para descubrir que ya no hay más.
 */

/** Tamaño de página. Debajo del tope del servidor, con margen. */
const PAGINA = 900

/** Techo de seguridad: 90,000 filas. Un bug de filtro no debe colgar el navegador. */
const MAX_PAGINAS = 100

/** Lo mínimo que necesitamos de un builder de PostgREST. */
type Rangeable<T> = {
  range: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null
    error: PostgrestError | null
  }>
}

/**
 * @param construir Devuelve un builder NUEVO en cada llamada. Tiene que ser
 *   una función y no un builder ya armado: un builder de PostgREST solo se
 *   puede ejecutar una vez, así que reusarlo entre páginas falla.
 *
 * @example
 *   const { data, error } = await fetchAll(() =>
 *     supabase.from("ordenes_produccion").select("*").eq("idempresa", IDEMPRESA),
 *   )
 */
export async function fetchAll<T>(
  construir: () => Rangeable<T>,
): Promise<{ data: T[]; error: PostgrestError | null; truncado: boolean }> {
  const todas: T[] = []

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * PAGINA
    const { data, error } = await construir().range(desde, desde + PAGINA)

    // El error se devuelve con lo que se alcanzó a leer: quien llama decide
    // si muestra el parcial o corta. Devolver [] escondería el problema.
    if (error) return { data: todas, error, truncado: false }

    const filas = data ?? []
    todas.push(...filas.slice(0, PAGINA))

    // Vino menos de lo pedido: no hay más páginas
    if (filas.length <= PAGINA) return { data: todas, error: null, truncado: false }
  }

  // Se agotaron las páginas permitidas. Es un caso que no debería ocurrir con
  // los volúmenes de este sistema; si pasa, hay que saberlo.
  console.warn(
    `fetchAll: se alcanzó el tope de ${MAX_PAGINAS * PAGINA} filas. ` +
      "Revisa el filtro de la consulta.",
  )
  return { data: todas, error: null, truncado: true }
}

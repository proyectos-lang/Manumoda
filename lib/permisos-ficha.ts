import type { SessionUser } from "@/lib/types"

/**
 * Los permisos de la ficha técnica.
 *
 * NO SON MÓDULOS, PERO VIVEN EN LA MISMA TABLA:
 *   `permisos_modulo` guarda una fila por usuario y clave. Estos dos no
 *   abren un módulo del menú, sino que gradúan lo que se ve y se puede
 *   hacer DENTRO de la ficha. Comparten tabla porque la forma del dato
 *   es la misma —usuario + clave— y así no hace falta ni migración ni
 *   tocar el login, que ya trae todas las claves del usuario.
 *
 *   Llevan dos puntos (`ficha:costos`) justamente para que se
 *   distingan de una clave de módulo y nunca choquen con una: ningún
 *   ModuleKey lleva ese carácter.
 *
 * QUÉ SIGNIFICA NO TENERLOS:
 *   · Sin `ficha:costos` — la ficha se ve en versión simplificada: los
 *     datos del proceso, las tallas y los materiales sin precios. Ni
 *     costos, ni precios, ni márgenes, ni utilidad.
 *   · Sin `ficha:editar` — la ficha se abre pero todos sus campos están
 *     bloqueados. Es el mismo efecto que el modo de solo lectura, pero
 *     acotado a la ficha.
 *
 * UN ADMIN LOS TIENE SIEMPRE:
 *   Igual que con los módulos, `es_admin` los concede sin necesidad de
 *   la fila. Si hubiera que marcárselos, un admin recién creado se
 *   quedaría fuera de su propia ficha.
 *
 * ESTO ES UN GUARDARRAÍL, NO UNA FRONTERA DE SEGURIDAD:
 *   Sin RLS (script 015), la anon key del navegador puede leer la
 *   tabla `ordenes_produccion` desde la consola, costos incluidos.
 *   Estos permisos evitan que alguien vea lo que no le toca en la
 *   pantalla; no impiden que alguien decidido lo busque por debajo.
 *   Cerrar esa puerta pide RLS.
 */

/** Ver los costos, precios y márgenes de la ficha. */
export const PERMISO_FICHA_COSTOS = "ficha:costos"

/** Editar los campos de la ficha. */
export const PERMISO_FICHA_EDITAR = "ficha:editar"

/** Los dos, con su etiqueta y su explicación, para la pantalla de usuarios. */
export const PERMISOS_FICHA: {
  clave: string
  etiqueta: string
  descripcion: string
}[] = [
  {
    clave: PERMISO_FICHA_COSTOS,
    etiqueta: "Ver costos en la ficha técnica",
    descripcion:
      "Sin este permiso ve una ficha simplificada: proceso, tallas y materiales, sin costos ni precios.",
  },
  {
    clave: PERMISO_FICHA_EDITAR,
    etiqueta: "Editar la ficha técnica",
    descripcion:
      "Sin este permiso puede abrir la ficha, pero no modificar ningún campo.",
  },
]

/** Las claves que NO son módulos: la pantalla de usuarios las lista aparte. */
export const CLAVES_NO_MODULO = new Set(PERMISOS_FICHA.map((p) => p.clave))

/** ¿El usuario ve los costos de la ficha? */
export function puedeVerCostos(user: SessionUser | null): boolean {
  if (!user) return false
  return user.es_admin || user.permisos.includes(PERMISO_FICHA_COSTOS)
}

/**
 * ¿El usuario puede editar la ficha?
 *
 * El modo de solo lectura manda sobre el permiso: alguien marcado como
 * solo lectura no edita nada, tenga la fila o no. Al revés sería una
 * contradicción que dejaría escribir a quien se quiso bloquear.
 */
export function puedeEditarFicha(user: SessionUser | null): boolean {
  if (!user) return false
  if (user.es_admin) return true
  if (user.solo_lectura) return false
  return user.permisos.includes(PERMISO_FICHA_EDITAR)
}

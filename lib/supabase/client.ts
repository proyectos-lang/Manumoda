import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cached: SupabaseClient | null = null

/**
 * Modo de solo lectura de la sesión activa.
 *
 * Vive a nivel de módulo, no en React, porque el cliente de Supabase se
 * pide desde funciones sueltas (`getSupabase()`) que no tienen acceso al
 * contexto de autenticación. `AuthProvider` lo sincroniza al iniciar
 * sesión, al rehidratarla y al cerrarla.
 */
let readOnly = false

/** Métodos de PostgREST que escriben. Todo lo demás pasa sin tocar. */
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"])

export const READ_ONLY_MESSAGE =
  "Tu usuario es de solo lectura: puedes consultar la información pero no modificarla."

export function setSupabaseReadOnly(value: boolean) {
  readOnly = value
}

export function isSupabaseReadOnly() {
  return readOnly
}

/**
 * Sustituto de un builder de PostgREST que nunca llega a la red.
 *
 * Cualquier método encadenado (`.eq()`, `.select()`, …) devuelve el mismo
 * objeto, y al esperarlo resuelve con el error de solo lectura. Así los
 * ~70 puntos de escritura de la app siguen su camino normal —revisan
 * `error` y muestran su toast— sin tener que tocarlos uno por uno.
 */
function blockedBuilder(): unknown {
  const result = {
    data: null,
    error: {
      message: READ_ONLY_MESSAGE,
      details: "",
      hint: "",
      code: "READ_ONLY",
    },
    count: null,
    status: 403,
    statusText: "Forbidden",
  }

  const target = {
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }

  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === "then") return Reflect.get(t, prop, receiver)
      // Cualquier otro método del builder se encadena sobre sí mismo
      return () => receiver
    },
  })
}

/**
 * Envuelve el cliente para que, en modo de solo lectura, las escrituras
 * fallen antes de salir del navegador.
 *
 * Es un guardarraíl contra cambios accidentales, NO una frontera de
 * seguridad: la anon key vive en el bundle y las tablas siguen sin RLS
 * (script 015), así que desde la consola del navegador todavía se puede
 * escribir. La restricción real necesita RLS.
 */
function guard(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (prop === "from" && typeof value === "function") {
        return (...args: unknown[]) => {
          const builder = (value as (...a: unknown[]) => unknown).apply(target, args)
          if (!readOnly) return builder
          return new Proxy(builder as object, {
            get(b, method, r) {
              if (typeof method === "string" && WRITE_METHODS.has(method)) {
                return () => blockedBuilder()
              }
              const v = Reflect.get(b, method, r)
              return typeof v === "function" ? v.bind(b) : v
            },
          })
        }
      }

      // Las dos RPC de la app (recalcular horas, anular programación) escriben
      if (prop === "rpc" && typeof value === "function") {
        return (...args: unknown[]) => {
          if (readOnly) return blockedBuilder()
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }

      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return null
  }

  cached = guard(
    createClient(url, key, {
      db: { schema: "manumoda" } as never,
      auth: { persistSession: false },
    }),
  )

  return cached
}

export function getSupabaseConfigStatus() {
  return {
    hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  }
}

export const IDEMPRESA = 1

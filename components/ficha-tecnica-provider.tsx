"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

/**
 * Quién tiene abierta la ficha técnica, y con qué folio.
 *
 * POR QUÉ UN CONTEXTO Y NO UN MODAL LOCAL:
 *   La ficha se abre desde tres lugares (Panel General, el tablero de
 *   etapas y la cola por etapa), y en los tres colgaba de la hoja de
 *   etapas, que es un panel modal de Radix. Apilar una pantalla grande
 *   sobre otro modal dio tres fallos seguidos: el prompt bloqueado, el
 *   overlay tragándose los clics, y el folio perdiéndose al cerrarse el
 *   panel de abajo.
 *
 *   Con el contexto, la ficha se dibuja UNA vez en la raíz de la
 *   aplicación, como una vista más. Quien la abre solo dice qué folio
 *   quiere ver; no la contiene ni la mantiene viva.
 */

type FichaTecnicaContextValue = {
  /** El folio abierto, o null si la ficha no está en pantalla. */
  folio: string | null
  abrir: (folio: string) => void
  cerrar: () => void
  /** Se dispara al guardar, para que el módulo de origen se refresque. */
  registrarRefresco: (fn: (() => void) | null) => void
  notificarGuardado: () => void
}

const FichaTecnicaContext = createContext<FichaTecnicaContextValue | null>(null)

export function useFichaTecnica(): FichaTecnicaContextValue {
  const ctx = useContext(FichaTecnicaContext)
  if (!ctx) {
    throw new Error("useFichaTecnica debe usarse dentro de FichaTecnicaProvider")
  }
  return ctx
}

export function FichaTecnicaProvider({ children }: { children: ReactNode }) {
  const [folio, setFolio] = useState<string | null>(null)
  /**
   * Qué hacer al guardar. Lo registra el módulo que abrió la ficha, para
   * refrescar su propia tabla sin que la ficha tenga que conocerlo.
   */
  const [refresco, setRefresco] = useState<{ fn: (() => void) | null }>({ fn: null })

  const abrir = useCallback((f: string) => setFolio(f), [])
  const cerrar = useCallback(() => setFolio(null), [])
  const registrarRefresco = useCallback(
    (fn: (() => void) | null) => setRefresco({ fn }),
    [],
  )
  const notificarGuardado = useCallback(() => refresco.fn?.(), [refresco])

  const value = useMemo(
    () => ({ folio, abrir, cerrar, registrarRefresco, notificarGuardado }),
    [folio, abrir, cerrar, registrarRefresco, notificarGuardado],
  )

  return (
    <FichaTecnicaContext.Provider value={value}>{children}</FichaTecnicaContext.Provider>
  )
}

"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { SessionUser } from "@/lib/types"

type AuthContextValue = {
  user: SessionUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<{ error?: string }>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const SESSION_KEY = "manumoda_session"
/** La sesión se cierra automáticamente 1 hora después de iniciarla. */
const SESSION_MAX_MS = 60 * 60 * 1000

/** Envoltura persistida: el usuario más el momento de login. */
type StoredSession = { user: SessionUser; loginAt: number }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current)
      expiryTimer.current = null
    }
  }, [])

  const logout = useCallback((expired = false) => {
    clearExpiryTimer()
    setUser(null)
    localStorage.removeItem(SESSION_KEY)
    if (expired) {
      toast.info("Sesión cerrada", { description: "Pasó 1 hora desde que iniciaste sesión." })
    }
  }, [clearExpiryTimer])

  /** Programa el cierre automático para dentro de `msRestante`. */
  const scheduleExpiry = useCallback((msRestante: number) => {
    clearExpiryTimer()
    expiryTimer.current = setTimeout(() => logout(true), Math.max(0, msRestante))
  }, [clearExpiryTimer, logout])

  // Rehidratar sesión al montar y aplicar la expiración de 1 hora
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredSession> & Partial<SessionUser>
        // Compatibilidad con sesiones viejas (guardaban el usuario plano, sin loginAt)
        const stored: StoredSession =
          "user" in parsed && parsed.user
            ? (parsed as StoredSession)
            : { user: parsed as SessionUser, loginAt: Date.now() }
        const elapsed = Date.now() - stored.loginAt
        if (elapsed >= SESSION_MAX_MS) {
          localStorage.removeItem(SESSION_KEY)
        } else {
          setUser(stored.user)
          scheduleExpiry(SESSION_MAX_MS - elapsed)
        }
      }
    } catch {}
    setLoading(false)
    return () => clearExpiryTimer()
  }, [scheduleExpiry, clearExpiryTimer])

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? "Error al iniciar sesión" }
      const sessionUser = data as SessionUser
      const stored: StoredSession = { user: sessionUser, loginAt: Date.now() }
      setUser(sessionUser)
      localStorage.setItem(SESSION_KEY, JSON.stringify(stored))
      scheduleExpiry(SESSION_MAX_MS)
      return {}
    } catch {
      return { error: "Error de conexión" }
    }
  }, [scheduleExpiry])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout: () => logout(false) }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return ctx
}

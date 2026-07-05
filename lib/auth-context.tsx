"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import type { SessionUser } from "@/lib/types"

type AuthContextValue = {
  user: SessionUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<{ error?: string }>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const SESSION_KEY = "manumoda_session"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setUser(JSON.parse(raw) as SessionUser)
    } catch {}
    setLoading(false)
  }, [])

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
      setUser(sessionUser)
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser))
      return {}
    } catch {
      return { error: "Error de conexión" }
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(SESSION_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return ctx
}

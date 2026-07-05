"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth-context"

type Mode = "checking" | "setup" | "login"

export function LoginScreen() {
  const { login } = useAuth()
  const [mode, setMode] = useState<Mode>("checking")
  const [nombre, setNombre] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/has-users")
      .then((r) => r.json())
      .then(({ hasUsers }) => setMode(hasUsers ? "login" : "setup"))
      .catch(() => setMode("login"))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await login(username, password)
    setLoading(false)
    if (error) setError(error)
  }

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, username, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Error al configurar")
        setLoading(false)
        return
      }
      const { error } = await login(username, password)
      if (error) setError(error)
    } catch {
      setError("Error de conexión. Verifica la configuración de Supabase.")
    }
    setLoading(false)
  }

  if (mode === "checking") {
    return (
      <div className="sidebar-cmyk-gradient flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/60" />
      </div>
    )
  }

  return (
    <div className="sidebar-cmyk-gradient flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + título */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="overflow-hidden rounded-2xl ring-1 ring-white/20 shadow-lg shadow-black/30">
            <Image
              src="/logo-manufacturas.jpeg"
              alt="Manufacturas de la Moda"
              width={80}
              height={80}
              className="size-20 object-cover"
              priority
            />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-white">Manufacturas de la Moda</h1>
            <p className="mt-1 text-sm text-white/60">Sistema de Producción</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
          <h2 className="mb-5 text-base font-semibold text-white">
            {mode === "setup" ? "Primera Configuración" : "Iniciar Sesión"}
          </h2>

          {mode === "setup" && (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
              No hay usuarios registrados. Crea el administrador maestro del sistema para comenzar.
            </p>
          )}

          <form onSubmit={mode === "setup" ? handleSetup : handleLogin} className="space-y-4">
            {mode === "setup" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-white/80">
                  Nombre completo <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Juan García"
                  required
                  autoFocus
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/30"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-white/80">
                Usuario <span className="text-red-400">*</span>
              </Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nombre_usuario"
                required
                autoFocus={mode === "login"}
                autoComplete="username"
                className="border-white/20 bg-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/30"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-white/80">
                Contraseña <span className="text-red-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  className="border-white/20 bg-white/10 pr-10 text-white placeholder:text-white/30 focus-visible:ring-white/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-white font-semibold text-foreground hover:bg-white/90 gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {mode === "setup" ? "Configurando…" : "Ingresando…"}
                </>
              ) : mode === "setup" ? (
                "Crear Administrador"
              ) : (
                "Ingresar"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

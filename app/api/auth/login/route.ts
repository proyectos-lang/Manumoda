import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key)
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 })

  const body = await req.json()
  const username: string = body.username?.trim().toLowerCase() ?? ""
  const password: string = body.password ?? ""

  if (!username || !password)
    return NextResponse.json({ error: "Credenciales requeridas" }, { status: 400 })

  const supabase = createClient(url, key, { db: { schema: "manumoda" as never } })

  const { data: user } = await supabase
    .from("usuarios")
    .select("id, nombre, username, password_hash, es_admin, activo")
    .eq("idempresa", 1)
    .eq("username", username)
    .maybeSingle()

  if (!user)
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 })

  if (!user.activo)
    return NextResponse.json({ error: "Usuario inactivo. Contacta al administrador." }, { status: 403 })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid)
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 })

  const { data: permisosData } = await supabase
    .from("permisos_modulo")
    .select("modulo")
    .eq("idusuario", user.id)

  return NextResponse.json({
    id: user.id,
    nombre: user.nombre,
    username: user.username,
    es_admin: user.es_admin,
    permisos: (permisosData ?? []).map((p: { modulo: string }) => p.modulo),
  })
}

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key)
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 })

  const supabase = createClient(url, key, { db: { schema: "manumoda" as never } })

  const { count } = await supabase
    .from("usuarios")
    .select("*", { count: "exact", head: true })
    .eq("idempresa", 1)

  if ((count ?? 0) > 0)
    return NextResponse.json({ error: "Ya existe un administrador registrado" }, { status: 400 })

  const body = await req.json()
  const nombre: string = body.nombre?.trim() ?? ""
  const username: string = body.username?.trim().toLowerCase() ?? ""
  const password: string = body.password ?? ""

  if (!nombre || !username || !password)
    return NextResponse.json({ error: "Todos los campos son requeridos" }, { status: 400 })

  const password_hash = await bcrypt.hash(password, 10)

  const { error } = await supabase.from("usuarios").insert({
    idempresa: 1,
    nombre,
    username,
    password_hash,
    es_admin: true,
    activo: true,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

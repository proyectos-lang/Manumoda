import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  const { password } = await req.json()
  if (!password)
    return NextResponse.json({ error: "Contraseña requerida" }, { status: 400 })
  const hash = await bcrypt.hash(password, 10)
  return NextResponse.json({ hash })
}

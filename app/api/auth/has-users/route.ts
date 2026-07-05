import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ hasUsers: false })

  const supabase = createClient(url, key, { db: { schema: "manumoda" as never } })
  const { count } = await supabase
    .from("usuarios")
    .select("*", { count: "exact", head: true })
    .eq("idempresa", 1)

  return NextResponse.json({ hasUsers: (count ?? 0) > 0 })
}

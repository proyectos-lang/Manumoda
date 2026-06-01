import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cached: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return null
  }

  cached = createClient(url, key, {
    db: { schema: "manumoda" } as never,
    auth: { persistSession: false },
  })

  return cached
}

export function getSupabaseConfigStatus() {
  return {
    hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  }
}

export const IDEMPRESA = 1

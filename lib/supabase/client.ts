import { createClient } from '@supabase/supabase-js'

let browserClient: ReturnType<typeof createClient> | undefined

export function createBrowserSupabaseClient() {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null
    browserClient = createClient(url, key)
  }
  return browserClient
}

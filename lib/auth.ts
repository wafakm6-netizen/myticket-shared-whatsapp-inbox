import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export type AuthAgent = { id: string; role: 'admin' | 'agent'; is_active: boolean; display_name: string; email: string | null }

async function createAuthClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase public auth credentials are not configured.')
  return createServerClient(url, key, { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } })
}

export async function getActiveAgent(): Promise<AuthAgent | null> {
  const auth = await createAuthClient()
  const { data: { user }, error } = await auth.auth.getUser()
  if (error || !user) return null
  const admin = createServerSupabaseClient()
  const { data: agent, error: agentError } = await admin.from('whatsapp_agents').select('id, role, is_active, display_name, email').eq('auth_user_id', user.id).maybeSingle()
  if (agentError || !agent?.is_active || (agent.role !== 'admin' && agent.role !== 'agent')) return null
  return agent as AuthAgent
}

export async function requireAgent() {
  const agent = await getActiveAgent()
  return agent ? { agent, error: null } : { agent: null, error: Response.json({ error: 'Authentication required.' }, { status: 401 }) }
}

export async function requireAdmin() {
  const agent = await getActiveAgent()
  if (!agent) return { agent: null, error: Response.json({ error: 'Authentication required.' }, { status: 401 }) }
  if (agent.role !== 'admin') return { agent: null, error: Response.json({ error: 'Admin access required.' }, { status: 403 }) }
  return { agent, error: null }
}

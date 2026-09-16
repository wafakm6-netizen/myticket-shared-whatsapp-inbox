import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function createAdminSupabaseClient() {
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function getActor(supabase: ReturnType<typeof createServerSupabaseClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: agent } = await supabase.from('whatsapp_agents').select('id, role, is_active').eq('auth_user_id', user.id).maybeSingle()
  return agent?.is_active && agent.role === 'admin' ? { user, agent } : null
}

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase.from('whatsapp_agents').select('id, display_name, email, avatar_url, is_active, role, availability, auth_user_id, whatsapp_conversations!assigned_agent_id(id, status, last_message_at, whatsapp_contacts(display_name, phone))').order('display_name')
    if (error) throw error
    return NextResponse.json({ agents: data ?? [] })
  } catch (error) {
    console.error('[team] load failed', error)
    return NextResponse.json({ error: 'Team data is unavailable.' }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    if (!(await getActor(supabase))) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
    const body = await request.json()
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!name || !email || !email.includes('@')) return NextResponse.json({ error: 'Name and valid email are required.' }, { status: 400 })
    const temporaryPassword = `Myticket-${crypto.randomUUID().slice(0, 8)}!aA`
    const adminSupabase = createAdminSupabaseClient()
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { display_name: name } })
    if (authError || !authData.user) return NextResponse.json({ error: authError?.message || 'Authentication account could not be created.' }, { status: 400 })
    const { data, error } = await supabase.from('whatsapp_agents').insert({ display_name: name, email, auth_user_id: authData.user.id, role: body.role === 'admin' ? 'admin' : 'agent', availability: 'offline', is_active: true }).select('id, display_name, email, role, availability, is_active').single()
    if (error) { await adminSupabase.auth.admin.deleteUser(authData.user.id); throw error }
    return NextResponse.json({ agent: data, temporaryPassword }, { status: 201 })
  } catch (error) {
    console.error('[team] create failed', error)
    return NextResponse.json({ error: 'Agent could not be added.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    const body = await request.json()
    const { data: currentAgent } = user ? await supabase.from('whatsapp_agents').select('id, role, is_active').eq('auth_user_id', user.id).maybeSingle() : { data: null }
    const isSelfUpdate = Boolean(currentAgent && body.id === currentAgent.id && body.availability && ['available', 'away', 'offline'].includes(body.availability))
    if (!isSelfUpdate && !(await getActor(supabase))) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
    if (isSelfUpdate && !currentAgent?.is_active) return NextResponse.json({ error: 'This agent is inactive.' }, { status: 403 })

    if (!body.id) return NextResponse.json({ error: 'Agent id is required.' }, { status: 400 })
    const patch: Record<string, string | boolean> = {}
    if (typeof body.display_name === 'string' && body.display_name.trim()) patch.display_name = body.display_name.trim()
    if (typeof body.email === 'string' && body.email.includes('@')) patch.email = body.email.trim().toLowerCase()
    if (body.role === 'admin' || body.role === 'agent') patch.role = body.role
    if (['available', 'away', 'offline'].includes(body.availability)) patch.availability = body.availability
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    const { data, error } = await supabase.from('whatsapp_agents').update(patch).eq('id', body.id).select('id, display_name, email, role, availability, is_active').single()
    if (error) throw error
    return NextResponse.json({ agent: data })
  } catch (error) {
    console.error('[team] update failed', error)
    return NextResponse.json({ error: 'Agent could not be updated.' }, { status: 500 })
  }
}

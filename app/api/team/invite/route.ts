import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { inviteTokenMatches, parseInvite } from '@/lib/invites'

// Public endpoints behind an invitation link: look the invitation up, then set the member's password.
async function findInvite(value: unknown) {
  const invite = parseInvite(value)
  if (!invite) return null
  const supabase = createServerSupabaseClient()
  const { data: agent } = await supabase.from('whatsapp_agents').select('id, display_name, email, auth_user_id').eq('id', invite.agentId).maybeSingle()
  if (!agent?.auth_user_id) return null
  const { data } = await supabase.auth.admin.getUserById(agent.auth_user_id)
  const meta = data.user?.app_metadata ?? {}
  if (!data.user || meta.invite_pending !== true || !inviteTokenMatches(invite.token, meta.invite_token_hash)) return null
  if (typeof meta.invite_expires_at !== 'string' || new Date(meta.invite_expires_at).getTime() < Date.now()) return { agent, expired: true as const }
  return { agent, expired: false as const, supabase }
}

const invalid = () => NextResponse.json({ error: 'This invitation link is invalid or has already been used. Ask your administrator for a new link.' }, { status: 404 })
const expired = () => NextResponse.json({ error: 'This invitation link has expired. Ask your administrator for a new link.' }, { status: 410 })

export async function GET(request: NextRequest) {
  const found = await findInvite(request.nextUrl.searchParams.get('invite'))
  if (!found) return invalid()
  if (found.expired) return expired()
  return NextResponse.json({ name: found.agent.display_name, email: found.agent.email })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 12) return NextResponse.json({ error: 'Use at least 12 characters.' }, { status: 400 })
  const found = await findInvite(body.invite)
  if (!found) return invalid()
  if (found.expired) return expired()
  const { error } = await found.supabase.auth.admin.updateUserById(found.agent.auth_user_id, { password, email_confirm: true, app_metadata: { invite_pending: false, invite_token_hash: null, invite_expires_at: null } })
  if (error) return NextResponse.json({ error: error.message || 'Your password could not be saved.' }, { status: 400 })
  return NextResponse.json({ email: found.agent.email })
}

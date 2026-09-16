import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const fields = 'id, title, body, created_by, is_active, created_at, updated_at'

async function requireUser() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function GET() {
  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const { data, error } = await supabase.from('saved_replies').select(fields).eq('is_active', true).order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Saved replies could not be loaded.' }, { status: 500 })
  return NextResponse.json({ replies: data ?? [] })
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const replyBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!title || !replyBody) return NextResponse.json({ error: 'Title and reply text are required.' }, { status: 400 })
  const { data: agent } = await supabase.from('whatsapp_agents').select('id').eq('auth_user_id', user.id).maybeSingle()
  const { data, error } = await supabase.from('saved_replies').insert({ title, body: replyBody, created_by: agent?.id ?? null }).select(fields).single()
  if (error) return NextResponse.json({ error: 'Saved reply could not be created.' }, { status: 500 })
  return NextResponse.json({ reply: data }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Reply id is required.' }, { status: 400 })
  const patch: Record<string, string | boolean> = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
  if (typeof body.body === 'string' && body.body.trim()) patch.body = body.body.trim()
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
  const { data, error } = await supabase.from('saved_replies').update(patch).eq('id', body.id).select(fields).single()
  if (error) return NextResponse.json({ error: 'Saved reply could not be updated.' }, { status: 500 })
  return NextResponse.json({ reply: data })
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Reply id is required.' }, { status: 400 })
  const { error } = await supabase.from('saved_replies').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', body.id)
  if (error) return NextResponse.json({ error: 'Saved reply could not be deleted.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

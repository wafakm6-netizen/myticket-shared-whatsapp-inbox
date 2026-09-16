import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id, status, assigned_agent_id, last_message_at, whatsapp_contacts(id, display_name, phone, contact_type, avatar_url), whatsapp_messages(id, direction, sender_name, body, attachment_url, attachment_name, status, sent_at, created_at)')
      .order('last_message_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ conversations: data ?? [] })
  } catch (error) {
    console.error('[inbox] load failed', error)
    return NextResponse.json({ error: 'Inbox data is unavailable.' }, { status: 503 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createServerSupabaseClient()
    const allowed = ['status', 'assigned_agent_id'] as const
    const patch = Object.fromEntries(Object.entries(body.patch ?? {}).filter(([key]) => allowed.includes(key as (typeof allowed)[number])))
    const { data, error } = await supabase.from('whatsapp_conversations').update(patch).eq('id', body.id).select('id, status, assigned_agent_id').single()
    if (error) throw error
    return NextResponse.json({ conversation: data })
  } catch (error) {
    console.error('[inbox] update failed', error)
    return NextResponse.json({ error: 'Conversation update failed.' }, { status: 500 })
  }
}

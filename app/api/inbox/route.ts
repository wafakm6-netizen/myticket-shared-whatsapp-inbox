import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const [{ data: conversations, error }, { data: agents, error: agentsError }] = await Promise.all([
      supabase.from('whatsapp_conversations').select('id, status, assigned_agent_id, last_message_at, whatsapp_contacts(id, display_name, phone, contact_type, avatar_url), whatsapp_agents(id, display_name, email, avatar_url), whatsapp_messages(id, direction, sender_name, body, attachment_url, attachment_name, status, sent_at, created_at), whatsapp_internal_notes(id, body, created_at, agent_id, whatsapp_agents(display_name))').order('last_message_at', { ascending: false }),
      supabase.from('whatsapp_agents').select('id, display_name, email, avatar_url, is_active').eq('is_active', true).order('display_name')
    ])
    if (error) throw error
    if (agentsError) throw agentsError
    return NextResponse.json({ conversations: conversations ?? [], agents: agents ?? [] })
  } catch (error) {
    console.error('[inbox] load failed', error)
    return NextResponse.json({ error: 'Inbox data is unavailable.' }, { status: 503 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createServerSupabaseClient()
    const patch: Record<string, string | null> = {}
    if (body.patch?.status && ['open', 'pending', 'closed'].includes(body.patch.status)) patch.status = body.patch.status
    if (body.patch && Object.prototype.hasOwnProperty.call(body.patch, 'assigned_agent_id')) patch.assigned_agent_id = body.patch.assigned_agent_id || null
    if (!body.id || !Object.keys(patch).length) return NextResponse.json({ error: 'No valid update supplied.' }, { status: 400 })
    const { data, error } = await supabase.from('whatsapp_conversations').update(patch).eq('id', body.id).select('id, status, assigned_agent_id').single()
    if (error) throw error
    if (body.note?.body?.trim()) {
      const { error: noteError } = await supabase.from('whatsapp_internal_notes').insert({ conversation_id: body.id, agent_id: body.note.agentId || null, body: body.note.body.trim() })
      if (noteError) throw noteError
    }
    return NextResponse.json({ conversation: data })
  } catch (error) {
    console.error('[inbox] update failed', error)
    return NextResponse.json({ error: 'Conversation update failed.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.conversationId || !body.body?.trim()) return NextResponse.json({ error: 'Conversation and note body are required.' }, { status: 400 })
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase.from('whatsapp_internal_notes').insert({ conversation_id: body.conversationId, agent_id: body.agentId || null, body: body.body.trim() }).select('id, body, created_at, agent_id').single()
    if (error) throw error
    return NextResponse.json({ note: data })
  } catch (error) {
    console.error('[inbox] note failed', error)
    return NextResponse.json({ error: 'Note could not be saved.' }, { status: 500 })
  }
} 

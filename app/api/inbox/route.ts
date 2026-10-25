import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAgent } from '@/lib/auth'

export async function GET() {
  const auth = await requireAgent(); if (auth.error) return auth.error
  try {
    const supabase = createServerSupabaseClient()
    const [{ data: conversations, error }, { data: agents, error: agentsError }] = await Promise.all([
      supabase.from('whatsapp_conversations').select('id, status, assigned_agent_id, last_message_at, unread_count, whatsapp_contacts(id, display_name, phone, contact_type, avatar_url), whatsapp_agents(id, display_name, email, avatar_url), whatsapp_messages(id, external_id, reply_to_external_id, direction, sender_name, body, attachment_url, attachment_name, status, failure_reason, sent_at, created_at), whatsapp_internal_notes(id, body, created_at, agent_id, whatsapp_agents(display_name)), whatsapp_conversation_tags(tag_id, whatsapp_tags(id, name, color))').order('last_message_at', { ascending: false }),
      supabase.from('whatsapp_agents').select('id, display_name, email, avatar_url, is_active, auth_user_id, role, availability').eq('is_active', true).order('display_name')
    ])
    if (error) throw error; if (agentsError) throw agentsError
    return NextResponse.json({ conversations: conversations ?? [], agents: agents ?? [] })
  } catch (error) { console.error('[inbox] load failed', error); return NextResponse.json({ error: 'Inbox data is unavailable.' }, { status: 503 }) }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAgent(); if (auth.error) return auth.error
  try {
    const body = await request.json(); const supabase = createServerSupabaseClient(); const patch: Record<string, string | number | null> = {}
    if (body.patch?.status && ['open','pending','closed'].includes(body.patch.status)) patch.status = body.patch.status
    if (body.patch && Object.prototype.hasOwnProperty.call(body.patch,'assigned_agent_id')) patch.assigned_agent_id = body.patch.assigned_agent_id || null
    if (body.patch && Object.prototype.hasOwnProperty.call(body.patch,'unread_count')) patch.unread_count = Math.max(0, Number(body.patch.unread_count) || 0)
    if (!body.id || (!Object.keys(patch).length && !body.contactPatch)) return NextResponse.json({ error:'No valid update supplied.' },{status:400})
    let data:any=null
    if(Object.keys(patch).length){const result=await supabase.from('whatsapp_conversations').update(patch).eq('id',body.id).select('id, status, assigned_agent_id, unread_count').single();if(result.error)throw result.error;data=result.data}
    if(body.contactPatch){const {data:conversation,error:conversationError}=await supabase.from('whatsapp_conversations').select('contact_id').eq('id',body.id).single();if(conversationError)throw conversationError;const contactPatch:Record<string,string>={};if(typeof body.contactPatch.display_name==='string'&&body.contactPatch.display_name.trim())contactPatch.display_name=body.contactPatch.display_name.trim();if(typeof body.contactPatch.contact_type==='string'&&['customer','supplier'].includes(body.contactPatch.contact_type))contactPatch.contact_type=body.contactPatch.contact_type;if(Object.keys(contactPatch).length){const {error}=await supabase.from('whatsapp_contacts').update(contactPatch).eq('id',conversation.contact_id);if(error)throw error}}
    return NextResponse.json({conversation:data})
  } catch(error){console.error('[inbox] update failed',error);return NextResponse.json({error:'Conversation update failed.'},{status:500})}
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent(); if (auth.error) return auth.error
  try {
    const body=await request.json();if(!body.conversationId||!body.body?.trim())return NextResponse.json({error:'Conversation and note body are required.'},{status:400})
    const supabase=createServerSupabaseClient();const {data,error}=await supabase.from('whatsapp_internal_notes').insert({conversation_id:body.conversationId,agent_id:auth.agent.id,body:body.body.trim()}).select('id, body, created_at, agent_id').single();if(error)throw error
    return NextResponse.json({note:data})
  }catch(error){console.error('[inbox] note failed',error);return NextResponse.json({error:'Note could not be saved.'},{status:500})}
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error
  try {
    const { conversationId, messageId } = await request.json().catch(() => ({}))
    if (typeof conversationId !== 'string' || !conversationId) return NextResponse.json({ error: 'Conversation ID is required.' }, { status: 400 })
    const supabase = createServerSupabaseClient()
    const { data: conversation, error: lookupError } = await supabase.from('whatsapp_conversations').select('id').eq('id', conversationId).maybeSingle()
    if (lookupError) throw lookupError
    if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })

    if (messageId !== undefined) {
      if (typeof messageId !== 'string' || !messageId) return NextResponse.json({ error: 'Invalid message ID.' }, { status: 400 })
      const { data: deleted, error } = await supabase.from('whatsapp_messages').delete().eq('id', messageId).eq('conversation_id', conversationId).select('id').maybeSingle()
      if (error) throw error
      if (!deleted) return NextResponse.json({ error: 'Message not found.' }, { status: 404 })
      const { data: latest, error: latestError } = await supabase.from('whatsapp_messages').select('created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1)
      if (latestError) throw latestError
      const { error: updateError } = await supabase.from('whatsapp_conversations').update({ last_message_at: latest?.[0]?.created_at ?? null }).eq('id', conversationId)
      if (updateError) throw updateError
      return NextResponse.json({ success: true, deleted: 'message' })
    }

    // Delete inbox history, not the WhatsApp recipient's messages or contact record.
    for (const table of ['whatsapp_conversation_tags', 'whatsapp_internal_notes', 'whatsapp_messages']) {
      const { error } = await supabase.from(table).delete().eq('conversation_id', conversationId)
      if (error) throw error
    }
    const { data: deleted, error } = await supabase.from('whatsapp_conversations').delete().eq('id', conversationId).select('id').maybeSingle()
    if (error) throw error
    if (!deleted) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    return NextResponse.json({ success: true, deleted: 'conversation' })
  } catch (error) {
    console.error('[inbox] deletion failed', error)
    return NextResponse.json({ error: 'Could not delete inbox content. Please try again.' }, { status: 500 })
  }
}

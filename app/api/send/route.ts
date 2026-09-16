import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const { to, text, conversationId, attachmentUrl, attachmentName, attachmentType } = await request.json().catch(() => ({}))
  if (typeof to !== 'string' || !to.trim() || typeof text !== 'string' || !text.trim()) return NextResponse.json({ error: 'Both recipient and message are required.' }, { status: 400 })
  try {
    const supabase = createServerSupabaseClient()
    let conversation = conversationId
    if (!conversation) {
      const { data: contact, error: contactError } = await supabase.from('whatsapp_contacts').upsert({ external_id: to.trim(), display_name: to.trim(), phone: to.trim() }, { onConflict: 'external_id' }).select('id').single()
      if (contactError) throw contactError
      const { data: created, error: conversationError } = await supabase.from('whatsapp_conversations').upsert({ contact_id: contact.id }, { onConflict: 'contact_id' }).select('id').single()
      if (conversationError) throw conversationError
      conversation = created.id
    }
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    let status = token && phoneNumberId ? 'sent' : 'queued'
    let result: any = null
    let externalId: string | null = null
    if (token && phoneNumberId) {
      const type = attachmentUrl ? (attachmentType?.startsWith('image/') ? 'image' : 'document') : 'text'
      const messageBody = type === 'text' ? { messaging_product: 'whatsapp', to: to.trim(), type, text: { body: text.trim() } } : { messaging_product: 'whatsapp', to: to.trim(), type, [type]: { link: attachmentUrl, caption: text.trim() } }
      const response = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v23.0'}/${phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(messageBody) })
      result = await response.json().catch(() => null)
      externalId = result?.messages?.[0]?.id ?? null
      if (!response.ok) status = 'failed'
    }
    const { data: message, error } = await supabase.from('whatsapp_messages').insert({ conversation_id: conversation, external_id: externalId, direction: 'outbound', body: text.trim(), attachment_url: attachmentUrl ?? null, attachment_name: attachmentName ?? null, status, sent_at: new Date().toISOString() }).select('id, conversation_id, body, attachment_url, attachment_name, status, created_at').single()
    if (error) throw error
    const { error: conversationUpdateError } = await supabase.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation)
    if (conversationUpdateError) throw conversationUpdateError
    return NextResponse.json({ success: status !== 'failed', message, result }, { status: status === 'failed' ? 502 : 200 })
  } catch (error) {
    console.error('[send] failed', error)
    return NextResponse.json({ error: 'Message could not be saved.' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function normalizePhone(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/[^\d+]/g, '') : ''
}

function templatePayload(template: { name: string; languageCode?: string; parameters?: string[] }) {
  return {
    name: template.name,
    language: { code: template.languageCode || 'en_US' },
    components: template.parameters?.length ? [{ type: 'body', parameters: template.parameters.map((text) => ({ type: 'text', text })) }] : undefined,
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = normalizePhone(body.phone)
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const template = body.template && typeof body.template.name === 'string' ? body.template : null

  if (!name || !phone || (!message && !template)) return NextResponse.json({ error: 'Name, WhatsApp number, and a first message or approved template are required.' }, { status: 400 })
  if (!/^\+?\d{8,15}$/.test(phone)) return NextResponse.json({ error: 'Enter a valid WhatsApp number in international format.' }, { status: 400 })

  try {
    const supabase = createServerSupabaseClient()
    const { data: contact, error: contactError } = await supabase.from('whatsapp_contacts').upsert({ external_id: phone, display_name: name, phone }, { onConflict: 'external_id' }).select('id, display_name, phone, contact_type').single()
    if (contactError) throw contactError
    const { data: conversation, error: conversationError } = await supabase.from('whatsapp_conversations').upsert({ contact_id: contact.id, status: 'open', last_message_at: new Date().toISOString() }, { onConflict: 'contact_id' }).select('id, status, assigned_agent_id').single()
    if (conversationError) throw conversationError

    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneNumberId) return NextResponse.json({ error: 'WhatsApp Cloud API is not configured. The conversation was saved, but the message was not sent.', conversationId: conversation.id }, { status: 503 })

    const outgoing = template
      ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: templatePayload(template) }
      : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { preview_url: false, body: message } }
    const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0'
    const metaResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(outgoing) })
    const metaPayload = await metaResponse.json().catch(() => null)
    const externalId = metaPayload?.messages?.[0]?.id || null
    const status = metaResponse.ok && externalId ? 'sent' : 'failed'
    const { data: savedMessage, error: messageError } = await supabase.from('whatsapp_messages').insert({ conversation_id: conversation.id, external_id: externalId, direction: 'outbound', body: template ? `[Template] ${template.name}${message ? ` — ${message}` : ''}` : message, status, sent_at: new Date().toISOString() }).select('id, conversation_id, body, status, external_id, created_at').single()
    if (messageError) throw messageError
    await supabase.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
    if (!metaResponse.ok) return NextResponse.json({ error: metaPayload?.error?.message || 'Meta rejected the message.', conversationId: conversation.id, message: savedMessage }, { status: 502 })
    return NextResponse.json({ conversationId: conversation.id, message: savedMessage, meta: metaPayload })
  } catch (error) {
    console.error('[conversations] create failed', error)
    return NextResponse.json({ error: 'Conversation could not be created.' }, { status: 500 })
  }
}

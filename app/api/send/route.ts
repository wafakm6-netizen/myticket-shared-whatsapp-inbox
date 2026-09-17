import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAgent } from '@/lib/auth'

function normalizeWhatsAppNumber(value: string) {
  return value.trim().replace(/[^0-9]/g, '')
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error

  const { to, text, conversationId, attachmentUrl, attachmentName, attachmentType } = await request.json().catch(() => ({}))
  if (typeof to !== 'string' || !to.trim() || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Both recipient and message are required.' }, { status: 400 })
  }

  try {
    const supabase = createServerSupabaseClient()
    const recipient = normalizeWhatsAppNumber(to)
    if (!recipient) return NextResponse.json({ error: 'Recipient phone number is invalid.' }, { status: 400 })

    let conversation = conversationId
    if (!conversation) {
      const { data: contact, error: contactError } = await supabase
        .from('whatsapp_contacts')
        .upsert({ external_id: recipient, display_name: to.trim(), phone: to.trim() }, { onConflict: 'external_id' })
        .select('id')
        .single()
      if (contactError) throw contactError

      const { data: created, error: conversationError } = await supabase
        .from('whatsapp_conversations')
        .upsert({ contact_id: contact.id }, { onConflict: 'contact_id' })
        .select('id')
        .single()
      if (conversationError) throw conversationError
      conversation = created.id
    }

    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneNumberId) {
      return NextResponse.json({ error: 'WhatsApp Cloud API is not configured.' }, { status: 503 })
    }

    const type = attachmentUrl ? (attachmentType?.startsWith('image/') ? 'image' : 'document') : 'text'
    const messageBody = type === 'text'
      ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type, text: { body: text.trim() } }
      : { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type, [type]: { link: attachmentUrl, caption: text.trim() } }

    const response = await fetch(
      `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v23.0'}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      },
    )
    const result = await response.json().catch(() => null)
    const externalId = result?.messages?.[0]?.id ?? null
    const accepted = response.ok && Boolean(externalId)
    const status = accepted ? 'queued' : 'failed'

    const { data: message, error } = await supabase
      .from('whatsapp_messages')
      .insert({
        conversation_id: conversation,
        external_id: externalId,
        direction: 'outbound',
        body: text.trim(),
        attachment_url: attachmentUrl ?? null,
        attachment_name: attachmentName ?? null,
        status,
        sent_at: new Date().toISOString(),
      })
      .select('id, conversation_id, body, attachment_url, attachment_name, status, created_at, external_id')
      .single()
    if (error) throw error

    const { error: conversationUpdateError } = await supabase
      .from('whatsapp_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation)
    if (conversationUpdateError) throw conversationUpdateError

    if (!accepted) {
      const metaMessage = result?.error?.message || 'Meta did not accept the WhatsApp message.'
      const metaCode = result?.error?.code
      console.error('[send] Meta rejected message', { code: metaCode, message: metaMessage })
      return NextResponse.json(
        { success: false, error: metaMessage, metaCode, message },
        { status: response.ok ? 502 : response.status >= 400 && response.status < 600 ? response.status : 502 },
      )
    }

    // "queued" only means Meta accepted the request. The webhook is authoritative
    // for sent, delivered, read and failed delivery states.
    return NextResponse.json({ success: true, message, metaMessageId: externalId }, { status: 200 })
  } catch (error) {
    console.error('[send] failed', error)
    return NextResponse.json({ error: 'Message could not be sent.' }, { status: 500 })
  }
}

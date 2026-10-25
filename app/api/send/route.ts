import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAgent } from '@/lib/auth'

function normalizeWhatsAppNumber(value: string) {
  return value.trim().replace(/[^0-9]/g, '')
}

function maskPhone(value: string) {
  return value.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error

  const { to, text, conversationId, attachmentUrl, attachmentName, attachmentType, mediaId, template, replyToMessageId } = await request.json().catch(() => ({}))
  if (typeof to !== 'string' || !to.trim() || (!template && !mediaId && !attachmentUrl && (typeof text !== 'string' || !text.trim()))) {
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

    // Meta only allows free-form replies within 24 hours of the customer's
    // latest inbound message. An accepted API request may still fail later
    // through a delivery-status webhook if this window is closed.
    if (!template) {
      const { data: latestInbound, error: inboundError } = await supabase
        .from('whatsapp_messages')
        .select('sent_at')
        .eq('conversation_id', conversation)
        .eq('direction', 'inbound')
        .order('sent_at', { ascending: false })
        .limit(1)
      if (inboundError) throw inboundError
      const lastCustomerMessage = latestInbound?.[0]?.sent_at
      if (!lastCustomerMessage || Date.now() - new Date(lastCustomerMessage).getTime() >= 24 * 60 * 60 * 1000) {
        return NextResponse.json({
          error: 'The WhatsApp 24-hour reply window has expired. Send an approved Meta WhatsApp template to reopen this conversation. Normal messages can be sent after the customer replies.',
          code: 'WHATSAPP_WINDOW_CLOSED',
        }, { status: 409 })
      }
    }

    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneNumberId) {
      console.error('[send] WhatsApp configuration missing', { hasAccessToken: Boolean(token), hasPhoneNumberId: Boolean(phoneNumberId) })
      return NextResponse.json({ error: 'WhatsApp Cloud API is not configured.' }, { status: 503 })
    }

    if (template && (mediaId || attachmentUrl)) return NextResponse.json({ error: 'Template messages cannot include a separate attachment.' }, { status: 400 })
    if (template && (typeof template.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(template.name) || typeof template.languageCode !== 'string' || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.languageCode) || !Array.isArray(template.parameters) || template.parameters.some((p: unknown) => typeof p !== 'string' || !p.trim()))) return NextResponse.json({ error: 'Invalid template selection or missing variables.' }, { status: 400 })
    if (template?.header && (!['image', 'document'].includes(template.header.type) || typeof template.header.id !== 'string' || !/^\d{8,30}$/.test(template.header.id))) return NextResponse.json({ error: 'Invalid template media attachment.' }, { status: 400 })
    const type = template ? 'template' : mediaId ? (attachmentType === 'sticker' ? 'sticker' : attachmentType?.startsWith('image/') ? 'image' : attachmentType?.startsWith('audio/') || !attachmentType ? 'audio' : 'document') : attachmentUrl ? (attachmentType?.startsWith('image/') ? 'image' : 'document') : 'text'
    const messageBody = type === 'template' ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'template', template: { name: template.name, language: { code: template.languageCode }, ...((template.header || template.parameters.length) ? { components: [...(template.header ? [{ type: 'header', parameters: [{ type: template.header.type, [template.header.type]: { id: template.header.id, ...(template.header.type === 'document' ? { filename: template.header.filename } : {}) } }] }] : []), ...(template.parameters.length ? [{ type: 'body', parameters: template.parameters.map((value: string) => ({ type: 'text', text: value.trim() })) }] : [])] } : {}) } } : type === 'sticker' ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'sticker', sticker: { id: mediaId } } : type === 'audio' ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'audio', audio: { id: mediaId } } : type === 'text'
      ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type, text: { body: text.trim() } }
      : { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type, [type]: { ...(mediaId ? { id: mediaId } : { link: attachmentUrl }), ...(type === 'document' && attachmentName ? { filename: attachmentName } : {}), ...(text.trim() ? { caption: text.trim() } : {}) } }

    let replyToExternalId: string | null = null
    if (replyToMessageId) {
      const { data: original, error: originalError } = await supabase.from('whatsapp_messages').select('external_id').eq('id', replyToMessageId).eq('conversation_id', conversation).maybeSingle()
      if (originalError) throw originalError
      if (!original?.external_id) return NextResponse.json({ error: 'This message cannot be replied to because its WhatsApp ID is unavailable.' }, { status: 400 })
      replyToExternalId = original.external_id
      if (!template) Object.assign(messageBody, { context: { message_id: replyToExternalId } })
    }

    // Diagnostic: send uploaded Ogg/Opus as a regular audio attachment, not a voice note.
    // Deliberately omit audio.voice; Meta webhook delivery status remains authoritative.
    const graphVersion = process.env.META_GRAPH_VERSION ?? 'v23.0'
    console.info('[send] sending WhatsApp message', { recipient: maskPhone(recipient), phoneNumberId, graphVersion, type, audioMode: type === 'audio' ? 'regular-attachment' : undefined, voiceFlagPresent: type === 'audio' ? Object.prototype.hasOwnProperty.call((messageBody as { audio?: Record<string, unknown> }).audio ?? {}, 'voice') : undefined })

    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
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

    console.info('[send] Meta WhatsApp response', {
      httpStatus: response.status,
      accepted,
      messageId: externalId,
      recipient: maskPhone(recipient),
      contacts: Array.isArray(result?.contacts) ? result.contacts.map((contact: any) => ({ input: contact?.input ? maskPhone(String(contact.input)) : undefined, waId: contact?.wa_id ? maskPhone(String(contact.wa_id)) : undefined })) : undefined,
      error: result?.error ? { message: result.error.message, type: result.error.type, code: result.error.code, errorSubcode: result.error.error_subcode, errorData: result.error.error_data } : undefined,
    })

    const { data: message, error } = await supabase
      .from('whatsapp_messages')
      .insert({
        conversation_id: conversation,
        external_id: externalId,
        reply_to_external_id: replyToExternalId,
        direction: 'outbound',
        body: template ? `[Template] ${template.name}` : text.trim() || null,
        attachment_url: mediaId ? `/api/media?mediaId=${encodeURIComponent(mediaId)}` : attachmentUrl ?? null,
        attachment_name: type === 'sticker' ? 'sticker attachment' : mediaId && type === 'audio' ? 'Voice message' : attachmentName ?? null,
        status,
        failure_reason: accepted ? null : (result?.error?.message || 'Meta rejected this message.'),
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
      console.error('[send] Meta rejected message', { code: metaCode, message: metaMessage, recipient: maskPhone(recipient) })
      return NextResponse.json(
        { success: false, error: metaMessage, metaCode, message },
        { status: response.ok ? 502 : response.status >= 400 && response.status < 600 ? response.status : 502 },
      )
    }

    const { error: resetError } = await supabase.from('whatsapp_notification_cycles').upsert({ conversation_id: conversation, notified_since_reply: false, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id' })
    if (resetError) console.error('[send] notification reset failed',resetError)
    return NextResponse.json({ success: true, message, metaMessageId: externalId }, { status: 200 })
  } catch (error) {
    console.error('[send] failed', error)
    return NextResponse.json({ error: 'Message could not be sent.' }, { status: 500 })
  }
}

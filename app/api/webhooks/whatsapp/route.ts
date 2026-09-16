import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function verifyMetaSignature(rawBody: string, signature: string | null) {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret || !signature?.startsWith('sha256=')) return false

  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
  const receivedBuffer = Buffer.from(signature, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')

  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('hub.mode') === 'subscribe' && searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN && searchParams.get('hub.challenge')) return new NextResponse(searchParams.get('hub.challenge'), { status: 200 })
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    if (!process.env.META_APP_SECRET) {
      console.error('[whatsapp webhook] META_APP_SECRET is not configured')
      return NextResponse.json({ received: false, error: 'Webhook verification is not configured' }, { status: 503 })
    }

    if (!verifyMetaSignature(rawBody, signature)) {
      console.warn('[whatsapp webhook] rejected request with invalid Meta signature')
      return NextResponse.json({ received: false, error: 'Invalid webhook signature' }, { status: 401 })
    }

    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ received: false, error: 'Invalid webhook payload' }, { status: 400 })
    }

    const supabase = createServerSupabaseClient()
    let stored = 0
    for (const entry of payload?.entry ?? []) for (const change of entry.changes ?? []) {
      const value = change.value ?? {}
      const profileByPhone = new Map((value.contacts ?? []).map((contact: any) => [contact.wa_id, contact.profile?.name]))
      for (const item of value.messages ?? []) {
        const phone = item.from
        if (!phone) continue
        const profileName = profileByPhone.get(phone)
        const contactPayload = profileName ? { external_id: phone, display_name: profileName, phone } : { external_id: phone, phone }
        const { data: contact, error: contactError } = await supabase.from('whatsapp_contacts').upsert(contactPayload, { onConflict: 'external_id', ignoreDuplicates: false }).select('id, display_name').single()
        if (contactError) throw contactError
        const { data: conversation, error: conversationError } = await supabase.from('whatsapp_conversations').upsert({ contact_id: contact.id, status: 'open', last_message_at: new Date().toISOString() }, { onConflict: 'contact_id' }).select('id, unread_count').single()
        if (conversationError) throw conversationError
        const media = item.image || item.document || item.video || item.audio
        const { error: messageError } = await supabase.from('whatsapp_messages').upsert({ conversation_id: conversation.id, external_id: item.id, direction: 'inbound', sender_name: profileName || contact.display_name, body: item.text?.body ?? item.caption ?? media?.filename ?? null, attachment_url: media?.id ? `/api/media?mediaId=${encodeURIComponent(media.id)}` : null, attachment_name: media?.filename ?? (media?.id ? `${item.type} attachment` : null), status: 'delivered', sent_at: new Date(Number(item.timestamp ?? 0) * 1000).toISOString() }, { onConflict: 'external_id' })
        if (messageError) throw messageError
        await supabase.from('whatsapp_conversations').update({ unread_count: (conversation.unread_count ?? 0) + 1, last_message_at: new Date().toISOString() }).eq('id', conversation.id)
        stored++
      }
      for (const status of value.statuses ?? []) {
        const mapped = ['sent', 'delivered', 'read', 'failed'].includes(status.status) ? status.status : null
        if (mapped) {
          const { error: statusError } = await supabase.from('whatsapp_messages').update({ status: mapped }).eq('external_id', status.id)
          if (statusError) throw statusError
        }
      }
    }
    return NextResponse.json({ received: true, stored })
  } catch (error) {
    console.error('[whatsapp webhook] failed', error)
    return NextResponse.json({ received: false, error: 'Invalid webhook payload' }, { status: 400 })
  }
}

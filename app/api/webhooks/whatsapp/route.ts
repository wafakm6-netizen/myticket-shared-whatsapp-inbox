import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('hub.mode') === 'subscribe' && searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN && searchParams.get('hub.challenge')) return new NextResponse(searchParams.get('hub.challenge'), { status: 200 })
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
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
        const { data: conversation, error: conversationError } = await supabase.from('whatsapp_conversations').upsert({ contact_id: contact.id, status: 'open', last_message_at: new Date().toISOString() }, { onConflict: 'contact_id' }).select('id').single()
        if (conversationError) throw conversationError
        const media = item.image || item.document || item.video || item.audio
        await supabase.from('whatsapp_messages').upsert({ conversation_id: conversation.id, external_id: item.id, direction: 'inbound', sender_name: profileName || contact.display_name, body: item.text?.body ?? item.caption ?? media?.filename ?? null, attachment_url: media?.id ? `/api/media?mediaId=${encodeURIComponent(media.id)}` : null, attachment_name: media?.filename ?? (media?.id ? `${item.type} attachment` : null), status: 'sent', sent_at: new Date(Number(item.timestamp ?? 0) * 1000).toISOString() }, { onConflict: 'external_id' })

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

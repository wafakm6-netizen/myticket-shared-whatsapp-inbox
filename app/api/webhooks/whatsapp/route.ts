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
    const messages = payload?.entry?.flatMap((entry: any) => entry.changes?.flatMap((change: any) => change.value?.messages ?? []) ?? []) ?? []
    for (const message of messages) {
      const phone = message.from
      const body = message.text?.body ?? message.caption ?? null
      if (!phone || !body) continue
      const { data: contact, error: contactError } = await supabase.from('whatsapp_contacts').upsert({ external_id: phone, display_name: phone, phone }, { onConflict: 'external_id' }).select('id').single()
      if (contactError) throw contactError
      const { data: conversation, error: conversationError } = await supabase.from('whatsapp_conversations').upsert({ contact_id: contact.id, status: 'open', last_message_at: new Date().toISOString() }, { onConflict: 'contact_id' }).select('id').single()
      if (conversationError) throw conversationError
      await supabase.from('whatsapp_messages').upsert({ conversation_id: conversation.id, external_id: message.id, direction: 'inbound', body, status: 'sent', sent_at: new Date(Number(message.timestamp ?? 0) * 1000).toISOString() }, { onConflict: 'external_id' })
    }
    return NextResponse.json({ received: true, stored: messages.length })
  } catch (error) {
    console.error('[whatsapp webhook] failed', error)
    return NextResponse.json({ received: false, error: 'Invalid webhook payload' }, { status: 400 })
  }
}

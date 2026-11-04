import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAgent } from '@/lib/auth'

// Shows "typing…" in the customer's WhatsApp while an agent writes a reply. Meta only allows this as part of
// marking the customer's latest message as read; the indicator lasts up to 25 seconds or until the reply arrives.
export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error
  const { conversationId } = await request.json().catch(() => ({}))
  if (typeof conversationId !== 'string' || !conversationId) return NextResponse.json({ error: 'conversationId is required.' }, { status: 400 })

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return NextResponse.json({ error: 'WhatsApp Cloud API is not configured.' }, { status: 503 })

  try {
    const supabase = createServerSupabaseClient()
    const { data: latest, error } = await supabase
      .from('whatsapp_messages')
      .select('external_id, sent_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .not('external_id', 'is', null)
      .or('attachment_name.is.null,attachment_name.neq.reaction')
      .order('sent_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const target = latest?.[0]
    // Nothing to attach the indicator to, or the customer's last message is outside the 24-hour window.
    if (!target?.external_id || !target.sent_at || Date.now() - new Date(target.sent_at).getTime() >= 24 * 60 * 60 * 1000) return NextResponse.json({ shown: false })

    const graphVersion = process.env.META_GRAPH_VERSION ?? 'v23.0'
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: target.external_id, typing_indicator: { type: 'text' } }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      console.warn('[typing] Meta rejected typing indicator', { status: response.status, error: result?.error?.message })
      return NextResponse.json({ shown: false, error: result?.error?.message || 'Meta rejected the typing indicator.' }, { status: 502 })
    }
    return NextResponse.json({ shown: true })
  } catch (error) {
    console.error('[typing] failed', error)
    return NextResponse.json({ error: 'Typing indicator could not be sent.' }, { status: 500 })
  }
}

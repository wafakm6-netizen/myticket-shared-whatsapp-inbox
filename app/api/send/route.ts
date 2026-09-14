import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { to, text } = await request.json().catch(() => ({}))
  if (typeof to !== 'string' || !to.trim() || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Both to and text are required.' }, { status: 400 })
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const graphVersion = process.env.META_GRAPH_VERSION ?? 'v23.0'
  if (!token || !phoneNumberId) {
    return NextResponse.json({ error: 'WhatsApp credentials are not configured.' }, { status: 503 })
  }

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.trim(), type: 'text', text: { body: text.trim() } }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) return NextResponse.json({ error: 'Meta API request failed.', details: data }, { status: response.status })
  return NextResponse.json({ success: true, result: data }, { status: 200 })
}

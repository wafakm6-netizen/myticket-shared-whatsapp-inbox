import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const changes = payload?.entry?.flatMap((entry: { changes?: unknown[] }) => entry.changes ?? []) ?? []
    if (process.env.NODE_ENV !== 'production') {
      console.info('[whatsapp webhook] received', { changeCount: changes.length, object: payload?.object })
    }
    return NextResponse.json({ received: true }, { status: 200 })
  } catch {
    return NextResponse.json({ received: false, error: 'Invalid webhook payload' }, { status: 400 })
  }
}

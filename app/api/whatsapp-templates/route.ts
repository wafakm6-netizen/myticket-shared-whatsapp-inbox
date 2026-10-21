import { NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'

export async function GET() {
  const auth = await requireAgent()
  if (auth.error) return auth.error
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '1462651832436945'
  if (!token) return NextResponse.json({ error: 'WhatsApp access token is not configured.' }, { status: 503 })
  try {
    const templates: any[] = []
    const version = process.env.META_GRAPH_VERSION || 'v23.0'
    let url: string | null = `https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`
    for (let page = 0; url && page < 10; page++) {
      const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const payload: any = await response.json().catch(() => ({}))
      if (!response.ok) return NextResponse.json({ error: payload.error?.message || 'Could not load Meta templates.' }, { status: 502 })
      templates.push(...(payload.data || []).filter((t: any) => t.status === 'APPROVED'))
      const next: string | undefined = payload.paging?.next
      url = next && next.startsWith('https://graph.facebook.com/') ? next : null
    }
    return NextResponse.json({ templates })
  } catch (error) {
    console.error('[templates] fetch failed', error)
    return NextResponse.json({ error: 'Could not load WhatsApp templates.' }, { status: 502 })
  }
}

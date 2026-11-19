import { createHmac, randomUUID } from 'node:crypto'

// Outgoing webhooks to API clients (myticket.om, the AI assistant). Configured in INBOX_WEBHOOKS:
// [{"url":"https://example.com/inbox-events","secret":"<shared secret>","events":["message.received"]}]
// Each POST carries X-Inbox-Event, X-Inbox-Delivery and X-Inbox-Signature: sha256=<HMAC of the raw body>.
// Delivery never blocks or fails the inbox: errors are logged and the request times out after 5 seconds.
export type InboxEvent = 'message.received'
type Subscriber = { url: string; secret: string; events: string[] }

function subscribers(): Subscriber[] {
  try {
    const parsed = JSON.parse(process.env.INBOX_WEBHOOKS || '[]')
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s?.url === 'string' && /^https:\/\//.test(s.url) && typeof s.secret === 'string' && Array.isArray(s.events)) : []
  } catch { console.error('[api events] INBOX_WEBHOOKS is not valid JSON'); return [] }
}

export async function emitEvent(type: InboxEvent, data: Record<string, unknown>) {
  const targets = subscribers().filter((s) => s.events.includes(type) || s.events.includes('*'))
  if (!targets.length) return
  const id = randomUUID()
  const body = JSON.stringify({ id, type, created_at: new Date().toISOString(), data })
  await Promise.allSettled(targets.map(async (target) => {
    try {
      const response = await fetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-inbox-event': type, 'x-inbox-delivery': id, 'x-inbox-signature': 'sha256=' + createHmac('sha256', target.secret).update(body).digest('hex') },
        body, signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) console.error('[api events] subscriber rejected', target.url, response.status)
    } catch (error) { console.error('[api events] delivery failed', target.url, error) }
  }))
}

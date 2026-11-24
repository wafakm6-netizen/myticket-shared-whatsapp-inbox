// Tells open inboxes that a chat changed, over Supabase Realtime broadcast (the same kind of channel the typing
// indicator uses). It does not depend on database change events reaching the browser, so a new message shows
// up straight away even if those are delayed or filtered.
export const INBOX_EVENTS_TOPIC = 'inbox-events'

export async function broadcastInboxChange(conversationId: string) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: INBOX_EVENTS_TOPIC, event: 'chat-changed', payload: { conversationId } }] }),
      signal: AbortSignal.timeout(1500),
    })
  } catch (error) {
    console.error('[realtime] broadcast failed', error)
  }
}

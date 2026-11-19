import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { authenticate, asAgent, apiError } from '@/lib/api/service-auth'
import { PATCH as inboxPatch } from '@/app/api/inbox/route'
import { POST as tagAdd, DELETE as tagRemove } from '@/app/api/tags/route'

type Context = { params: Promise<{ id: string }> }
const uuid = /^[0-9a-f-]{36}$/i

// GET /api/v1/conversations/:id?limit=50&before=<ISO created_at>
// The conversation, its contact and tags, and its messages oldest→newest (page back with before).
export async function GET(request: NextRequest, { params }: Context) {
  const { error } = await authenticate(request, 'conversations:read'); if (error) return error
  const { id } = await params
  if (!uuid.test(id)) return apiError(400, 'Invalid conversation id.')
  const search = new URL(request.url).searchParams
  const limit = Math.min(Math.max(Number(search.get('limit')) || 50, 1), 200), before = search.get('before')
  try {
    const supabase = createServerSupabaseClient()
    const { data: conversation, error: dbError } = await supabase.from('whatsapp_conversations')
      .select('id, status, assigned_agent_id, last_message_at, unread_count, contact:whatsapp_contacts(id, display_name, phone, external_id), tags:whatsapp_conversation_tags(tag:whatsapp_tags(id, name, color))')
      .eq('id', id).maybeSingle()
    if (dbError) throw dbError
    if (!conversation) return apiError(404, 'Conversation not found.')
    let messages = supabase.from('whatsapp_messages').select('id, external_id, reply_to_external_id, direction, sender_name, body, attachment_url, attachment_name, status, failure_reason, created_at').eq('conversation_id', id).order('created_at', { ascending: false }).limit(limit)
    if (before) messages = messages.lt('created_at', before)
    const { data: rows, error: messagesError } = await messages
    if (messagesError) throw messagesError
    const list = (rows ?? []).reverse()
    const c: any = conversation
    return NextResponse.json({
      conversation: { ...c, contact: Array.isArray(c.contact) ? c.contact[0] ?? null : c.contact, tags: (c.tags ?? []).map((t: any) => t.tag).filter(Boolean) },
      messages: list,
      next_before: list.length === limit ? list[0]?.created_at : null,
    })
  } catch (dbError) { console.error('[api v1] conversation load failed', dbError); return apiError(503, 'Conversation is unavailable.') }
}

// PATCH /api/v1/conversations/:id  { status?, assigned_agent_id?, add_tags?: [name|id], remove_tags?: [name|id] }
export async function PATCH(request: NextRequest, { params }: Context) {
  const { caller, error } = await authenticate(request, 'conversations:write'); if (error) return error
  const { id } = await params
  if (!uuid.test(id)) return apiError(400, 'Invalid conversation id.')
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError(400, 'JSON body required.')
  const base = new URL(request.url).origin
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) { if (!['open', 'pending', 'closed'].includes(body.status)) return apiError(400, 'status must be open, pending or closed.'); patch.status = body.status }
  if (body.assigned_agent_id !== undefined) patch.assigned_agent_id = body.assigned_agent_id
  if (Object.keys(patch).length) {
    const response = await asAgent(caller, inboxPatch, `${base}/api/inbox`, 'PATCH', { id, patch })
    if (!response.ok) return response
  }
  const resolveTags = async (values: unknown) => {
    if (!Array.isArray(values) || !values.length) return []
    const names = values.filter((v): v is string => typeof v === 'string')
    const { data } = await createServerSupabaseClient().from('whatsapp_tags').select('id, name')
    return names.map((v) => (data ?? []).find((t: any) => t.id === v || t.name.toLowerCase() === v.toLowerCase())).filter(Boolean) as { id: string; name: string }[]
  }
  const add = await resolveTags(body.add_tags), remove = await resolveTags(body.remove_tags)
  if (Array.isArray(body.add_tags) && add.length !== body.add_tags.length) return apiError(400, 'One or more tags in add_tags do not exist.')
  for (const tag of add) { const r = await asAgent(caller, tagAdd, `${base}/api/tags`, 'POST', { conversationId: id, tagId: tag.id }); if (!r.ok) return r }
  for (const tag of remove) { const r = await asAgent(caller, tagRemove, `${base}/api/tags`, 'DELETE', { conversationId: id, tagId: tag.id }); if (!r.ok) return r }
  return NextResponse.json({ updated: true })
}

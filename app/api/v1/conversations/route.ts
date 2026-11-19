import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { authenticate, apiError } from '@/lib/api/service-auth'

// GET /api/v1/conversations?status=open&phone=9689xxxxxxx&limit=50&before=<ISO last_message_at>
// Newest first, each with its contact and latest message only (never the whole history).
export async function GET(request: NextRequest) {
  const { error } = await authenticate(request, 'conversations:read'); if (error) return error
  const params = new URL(request.url).searchParams
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 100)
  const status = params.get('status'), phone = (params.get('phone') || '').replace(/[^\d]/g, ''), before = params.get('before')
  if (status && !['open', 'pending', 'closed'].includes(status)) return apiError(400, 'status must be open, pending or closed.')
  try {
    let query = createServerSupabaseClient().from('whatsapp_conversations')
      .select(`id, status, assigned_agent_id, last_message_at, unread_count, contact:whatsapp_contacts${phone ? '!inner' : ''}(id, display_name, phone, external_id), last_message:whatsapp_messages(id, external_id, direction, sender_name, body, attachment_name, status, created_at)`)
      .order('last_message_at', { ascending: false })
      .order('created_at', { referencedTable: 'last_message', ascending: false })
      .limit(1, { referencedTable: 'last_message' })
      .limit(limit)
    if (status) query = query.eq('status', status)
    if (phone) query = query.eq('contact.external_id', phone)
    if (before) query = query.lt('last_message_at', before)
    const { data, error: dbError } = await query
    if (dbError) throw dbError
    const conversations = (data ?? []).map((row: any) => ({ ...row, contact: Array.isArray(row.contact) ? row.contact[0] ?? null : row.contact, last_message: row.last_message?.[0] ?? null }))
    const next = conversations.length === limit ? conversations.at(-1)?.last_message_at : null
    return NextResponse.json({ conversations, next_before: next })
  } catch (dbError) { console.error('[api v1] conversations list failed', dbError); return apiError(503, 'Conversations are unavailable.') }
}

import { NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { authenticate, asAgent, apiError } from '@/lib/api/service-auth'
import { POST as send } from '@/app/api/send/route'

// POST /api/v1/messages
// { to?: "9689xxxxxxx", conversation_id?, text?, template?: { name, languageCode?, parameters?: string[] }, reply_to_message_id? }
// Sent through the inbox exactly like an agent's message, so the team sees it in the chat.
// Outside WhatsApp's 24-hour window only an approved template can be sent.
export async function POST(request: NextRequest) {
  const { caller, error } = await authenticate(request, 'messages:send'); if (error) return error
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError(400, 'JSON body required.')
  let to = typeof body.to === 'string' ? body.to : ''
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : undefined
  if (!to && conversationId) {
    const { data } = await createServerSupabaseClient().from('whatsapp_conversations').select('contact:whatsapp_contacts(external_id)').eq('id', conversationId).maybeSingle()
    const contact: any = Array.isArray((data as any)?.contact) ? (data as any).contact[0] : (data as any)?.contact
    to = contact?.external_id || ''
  }
  if (!to) return apiError(400, 'Provide to (phone number) or conversation_id.')
  if (!body.text && !body.template) return apiError(400, 'Provide text or template.')
  return asAgent(caller, send, `${new URL(request.url).origin}/api/send`, 'POST', {
    to, conversationId, text: body.text, template: body.template, replyToMessageId: body.reply_to_message_id,
  })
}

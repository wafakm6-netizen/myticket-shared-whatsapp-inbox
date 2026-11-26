import type { SupabaseClient } from '@supabase/supabase-js'
import { detectLanguage } from '@/lib/replies/intents'

// Auto-reply menu (no AI). If a customer waits `delay_seconds` without an answer, WhatsApp sends a tappable list of
// topics. Their choice gets an approved quick reply, or a "the team will follow up" message, and tags the chat.
// Money topics (payment, refund, cancellation) are always handed to the team: nothing here promises money back.

export type AutoReplyOption = {
  id: string
  title_ar: string; title_en: string
  description_ar?: string | null; description_en?: string | null
  reply_code?: string | null
  handoff: boolean
  tag?: string | null
}
export type AutoReplySettings = {
  enabled: boolean; delay_seconds: number; cooldown_hours: number
  intro_ar: string; intro_en: string; button_ar: string; button_en: string
  handoff_ar: string; handoff_en: string; options: AutoReplyOption[]
}
export const SENDER_NAME = 'Auto reply'
export const MENU_PREFIX = 'menu:'

export async function loadAutoReplySettings(supabase: SupabaseClient): Promise<AutoReplySettings | null> {
  const { data, error } = await supabase.from('whatsapp_auto_reply_settings').select('*').eq('id', 1).maybeSingle()
  if (error || !data) return null // table not created yet: the feature simply stays off
  return { ...data, options: Array.isArray(data.options) ? data.options : [] } as AutoReplySettings
}

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

async function sendToWhatsApp(to: string, payload: Record<string, unknown>) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) throw new Error('WhatsApp Cloud API is not configured.')
  const graph = process.env.META_GRAPH_VERSION ?? 'v23.0'
  const response = await fetch(`https://graph.facebook.com/${graph}/${phoneNumberId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/[^0-9]/g, ''), ...payload }),
  })
  const result = await response.json().catch(() => null)
  const externalId: string | null = result?.messages?.[0]?.id ?? null
  return { ok: response.ok && !!externalId, externalId, error: result?.error?.message as string | undefined }
}

async function storeOutbound(supabase: SupabaseClient, conversationId: string, body: string, sent: { ok: boolean; externalId: string | null; error?: string }) {
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conversationId, external_id: sent.externalId, direction: 'outbound', sender_name: SENDER_NAME, body,
    status: sent.ok ? 'queued' : 'failed', failure_reason: sent.ok ? null : sent.error || 'Meta rejected this message.', sent_at: new Date().toISOString(),
  })
  await supabase.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
}

// The menu itself. Claims the log row first, so two runs at the same moment can't both send it.
export async function sendMenu(supabase: SupabaseClient, settings: AutoReplySettings, conversationId: string, phone: string, trigger: { externalId: string; text: string }) {
  const options = settings.options.filter((option) => option.id && option.title_ar && option.title_en).slice(0, 10)
  if (!options.length) return false
  const claim = await supabase.from('whatsapp_auto_reply_log').insert({ conversation_id: conversationId, trigger_external_id: trigger.externalId, kind: 'menu' })
  if (claim.error) return false
  const lang = detectLanguage(trigger.text || '')
  const ar = lang === 'ar'
  const intro = ar ? settings.intro_ar : settings.intro_en
  const rows = options.map((option) => {
    const description = (ar ? option.description_ar : option.description_en) || ''
    return { id: MENU_PREFIX + option.id, title: cut(ar ? option.title_ar : option.title_en, 24), ...(description ? { description: cut(description, 72) } : {}) }
  })
  const sent = await sendToWhatsApp(phone, { type: 'interactive', interactive: { type: 'list', body: { text: cut(intro, 1024) }, action: { button: cut(ar ? settings.button_ar : settings.button_en, 20), sections: [{ title: cut(ar ? 'المواضيع' : 'Topics', 24), rows }] } } })
  await supabase.from('whatsapp_auto_reply_log').update({ external_id: sent.externalId }).eq('trigger_external_id', trigger.externalId).eq('kind', 'menu')
  const listed = options.map((option, index) => `${index + 1}. ${ar ? option.title_ar : option.title_en}`).join('\n')
  await storeOutbound(supabase, conversationId, `${intro}\n\n${listed}`, sent)
  return sent.ok
}

async function addTag(supabase: SupabaseClient, conversationId: string, name: string) {
  let { data: tag } = await supabase.from('whatsapp_tags').select('id').ilike('name', name).maybeSingle()
  if (!tag) {
    const created = await supabase.from('whatsapp_tags').insert({ name, color: '#ff5a1f' }).select('id').maybeSingle()
    tag = created.data ?? (await supabase.from('whatsapp_tags').select('id').ilike('name', name).maybeSingle()).data
  }
  if (tag?.id) await supabase.from('whatsapp_conversation_tags').upsert({ conversation_id: conversationId, tag_id: tag.id }, { onConflict: 'conversation_id,tag_id' })
}

// The customer tapped a topic in the menu.
export async function handleMenuChoice(supabase: SupabaseClient, conversationId: string, phone: string, choiceId: string, choiceExternalId: string) {
  const settings = await loadAutoReplySettings(supabase)
  if (!settings) return
  const option = settings.options.find((item) => MENU_PREFIX + item.id === choiceId)
  if (!option) return
  const claim = await supabase.from('whatsapp_auto_reply_log').insert({ conversation_id: conversationId, trigger_external_id: choiceExternalId, kind: 'answer', option_id: option.id })
  if (claim.error) return // already answered (webhook retried)
  // The menu was sent in the customer's language; answer in the same one.
  const { data: menuRow } = await supabase.from('whatsapp_messages').select('body').eq('conversation_id', conversationId).eq('sender_name', SENDER_NAME).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const lang = detectLanguage(menuRow?.body || option.title_ar)
  let text = ''
  if (!option.handoff && option.reply_code) {
    const { data: reply } = await supabase.from('saved_replies').select('body').eq('is_active', true).ilike('title', `${option.reply_code}-${lang === 'ar' ? 'AR' : 'EN'}%`).limit(1).maybeSingle()
    text = reply?.body || ''
  }
  const handoff = option.handoff || !text // a missing quick reply falls back to the team
  if (!text) text = lang === 'ar' ? settings.handoff_ar : settings.handoff_en
  const sent = await sendToWhatsApp(phone, { type: 'text', text: { body: text } })
  await supabase.from('whatsapp_auto_reply_log').update({ external_id: sent.externalId }).eq('trigger_external_id', choiceExternalId).eq('kind', 'answer')
  await storeOutbound(supabase, conversationId, text, sent)
  if (option.tag) await addTag(supabase, conversationId, option.tag).catch(() => {})
  // Handed over: keep it open and unread so it stands out to the team.
  if (handoff) await supabase.from('whatsapp_conversations').update({ status: 'open', unread_count: 1 }).eq('id', conversationId)
}

// Runs every minute (Vercel cron): customers whose latest message has waited `delay_seconds` with no answer.
export async function runDueMenus(supabase: SupabaseClient) {
  const settings = await loadAutoReplySettings(supabase)
  if (!settings?.enabled) return { checked: 0, sent: 0 }
  const now = Date.now()
  const windowStart = new Date(now - Math.max(15 * 60, settings.delay_seconds + 10 * 60) * 1000).toISOString()
  const { data: rows, error } = await supabase.from('whatsapp_conversations')
    .select('id, last_message_at, whatsapp_contacts(phone, contact_type), whatsapp_messages(external_id, direction, body, attachment_name, sender_name, created_at)')
    .gte('last_message_at', windowStart)
    .order('created_at', { referencedTable: 'whatsapp_messages', ascending: false })
    .limit(6, { referencedTable: 'whatsapp_messages' })
    .limit(200)
  if (error) throw error
  let sent = 0
  for (const row of rows ?? []) {
    const contact: any = Array.isArray(row.whatsapp_contacts) ? row.whatsapp_contacts[0] : row.whatsapp_contacts
    if (!contact?.phone || ['team', 'supplier'].includes(contact.contact_type)) continue
    const messages = (row.whatsapp_messages ?? []).filter((m: any) => m.attachment_name !== 'reaction' && m.attachment_name !== 'reaction attachment')
    const latest: any = messages[0]
    if (!latest || latest.direction !== 'inbound' || !latest.external_id) continue
    const waited = now - new Date(latest.created_at).getTime()
    if (waited < settings.delay_seconds * 1000) continue
    // A person from the team is already talking to this customer (replied in the last 24 hours): stay out of it.
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString()
    const { data: human } = await supabase.from('whatsapp_messages').select('id').eq('conversation_id', row.id).eq('direction', 'outbound')
      .gte('created_at', dayAgo).or(`sender_name.is.null,sender_name.neq.${SENDER_NAME}`).neq('attachment_name', 'reaction').limit(1)
    if (human?.length) continue
    const since = new Date(now - settings.cooldown_hours * 3600 * 1000).toISOString()
    const { data: recent } = await supabase.from('whatsapp_auto_reply_log').select('id').eq('conversation_id', row.id).eq('kind', 'menu').gte('created_at', since).limit(1)
    if (recent?.length) continue
    if (await sendMenu(supabase, settings, row.id, contact.phone, { externalId: latest.external_id, text: latest.body || '' })) sent++
  }
  return { checked: rows?.length ?? 0, sent }
}

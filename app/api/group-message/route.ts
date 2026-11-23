import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { POST as send } from '@/app/api/send/route'

// Group message: one approved template to one person from an uploaded list (the page sends the list a few at a time).
// Finds or creates the contact and chat, keeps an existing contact's saved name, sends through the normal send path
// (so it appears in the chat like any agent message), and optionally tags the chat.
export async function POST(request: NextRequest) {
  const auth = await requireAgent(); if (auth.error) return auth.error
  const body = await request.json().catch(() => null)
  const phone = typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const template = body?.template
  const tagId = typeof body?.tagId === 'string' ? body.tagId : ''
  if (!/^\d{8,15}$/.test(phone)) return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 })
  if (!template || typeof template.name !== 'string') return NextResponse.json({ error: 'An approved template is required.' }, { status: 400 })

  try {
    const supabase = createServerSupabaseClient()
    let { data: contact, error } = await supabase.from('whatsapp_contacts').select('id, display_name').eq('external_id', phone).maybeSingle()
    if (error) throw error
    if (!contact) {
      const created = await supabase.from('whatsapp_contacts').upsert({ external_id: phone, phone, display_name: name || phone }, { onConflict: 'external_id' }).select('id, display_name').single()
      if (created.error) throw created.error
      contact = created.data
    } else if (name && (!contact.display_name || contact.display_name.replace(/\D/g, '') === phone)) {
      // The saved name was only the number: use the name from the file.
      await supabase.from('whatsapp_contacts').update({ display_name: name }).eq('id', contact.id)
    }
    const { data: conversation, error: conversationError } = await supabase.from('whatsapp_conversations').upsert({ contact_id: contact.id }, { onConflict: 'contact_id' }).select('id').single()
    if (conversationError) throw conversationError

    const response = await send(new NextRequest(new URL('/api/send', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, conversationId: conversation.id, template }),
    }))
    const result = await response.json().catch(() => ({}))
    if (response.ok && tagId) {
      const { error: tagError } = await supabase.from('whatsapp_conversation_tags').upsert({ conversation_id: conversation.id, tag_id: tagId, assigned_by: auth.agent!.id }, { onConflict: 'conversation_id,tag_id' })
      if (tagError) console.error('[group-message] tag failed', tagError)
    }
    return NextResponse.json({ ...result, conversationId: conversation.id }, { status: response.status })
  } catch (error) {
    console.error('[group-message] failed', error)
    return NextResponse.json({ error: 'Could not send to this number.' }, { status: 500 })
  }
}

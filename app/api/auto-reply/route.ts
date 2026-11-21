import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAgent } from '@/lib/auth'
import { loadAutoReplySettings, type AutoReplyOption } from '@/lib/auto-reply/engine'

// Auto-reply menu settings. Everyone signed in can read them; only admins can change them.
export async function GET() {
  const auth = await requireAgent(); if (auth.error) return auth.error
  const settings = await loadAutoReplySettings(createServerSupabaseClient())
  if (!settings) return NextResponse.json({ settings: null, setupNeeded: true })
  return NextResponse.json({ settings })
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export async function PUT(request: NextRequest) {
  const auth = await requireAgent(); if (auth.error) return auth.error
  if (auth.agent.role !== 'admin') return NextResponse.json({ error: 'Only administrators can change the auto reply.' }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid settings.' }, { status: 400 })
  const rawOptions: any[] = Array.isArray(body.options) ? body.options.slice(0, 10) : []
  const seen = new Set<string>()
  const options: AutoReplyOption[] = []
  for (const [index, raw] of rawOptions.entries()) {
    const title_ar = text(raw?.title_ar, 24), title_en = text(raw?.title_en, 24)
    if (!title_ar || !title_en) return NextResponse.json({ error: `Option ${index + 1} needs an Arabic and an English title (24 characters max).` }, { status: 400 })
    let id = text(raw?.id, 30).replace(/[^a-z0-9_-]/gi, '') || `opt${index + 1}`
    while (seen.has(id)) id += 'x'
    seen.add(id)
    const replyCode = text(raw?.reply_code, 10).toUpperCase()
    options.push({ id, title_ar, title_en, description_ar: text(raw?.description_ar, 72) || null, description_en: text(raw?.description_en, 72) || null, reply_code: /^QR\d{1,3}$/.test(replyCode) ? replyCode : null, handoff: raw?.handoff === true || !/^QR\d{1,3}$/.test(replyCode), tag: text(raw?.tag, 40) || null })
  }
  const enabled = body.enabled === true
  if (enabled && !options.length) return NextResponse.json({ error: 'Add at least one option before turning the auto reply on.' }, { status: 400 })
  const delay = Math.round(Number(body.delay_seconds))
  const patch = {
    enabled, options,
    delay_seconds: Number.isFinite(delay) ? Math.min(3600, Math.max(30, delay)) : 60,
    intro_ar: text(body.intro_ar, 900), intro_en: text(body.intro_en, 900),
    button_ar: text(body.button_ar, 20) || 'اختر الموضوع', button_en: text(body.button_en, 20) || 'Choose a topic',
    handoff_ar: text(body.handoff_ar, 900), handoff_en: text(body.handoff_en, 900),
    updated_at: new Date().toISOString(), updated_by: auth.agent.id,
  }
  if (!patch.intro_ar || !patch.intro_en || !patch.handoff_ar || !patch.handoff_en) return NextResponse.json({ error: 'The welcome and hand-off messages are required in both languages.' }, { status: 400 })
  const { error } = await createServerSupabaseClient().from('whatsapp_auto_reply_settings').update(patch).eq('id', 1)
  if (error) { console.error('[auto-reply] save failed', error); return NextResponse.json({ error: 'Settings could not be saved.' }, { status: 500 }) }
  return NextResponse.json({ settings: await loadAutoReplySettings(createServerSupabaseClient()) })
}

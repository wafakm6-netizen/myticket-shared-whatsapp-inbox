'use client'

import { useEffect, useMemo, useState } from 'react'
import { suggestIntents } from '@/lib/replies/intents'

// Smart Reply: up to three approved quick replies that match the customer's latest message, shown above the composer.
// Tapping one only fills the composer; the agent edits if needed and presses Send. Nothing is ever sent automatically.
// Needs the QRxx-AR / QRxx-EN saved replies (supabase/seeds/quick_replies_v1.sql); hides itself when they are missing.
type Reply = { id: string; title: string; body: string }
type Props = { conversationId?: string; messageId?: string; customerText?: string; hidden?: boolean; onUse: (body: string) => void }

let cache: { at: number; replies: Reply[] } | null = null
async function loadReplies(): Promise<Reply[]> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.replies
  const response = await fetch('/api/saved-replies', { cache: 'no-store' })
  if (!response.ok) return cache?.replies ?? []
  const payload = await response.json().catch(() => ({}))
  cache = { at: Date.now(), replies: Array.isArray(payload.replies) ? payload.replies : [] }
  return cache.replies
}

export function SmartReplyBar({ conversationId, messageId, customerText, hidden, onUse }: Props) {
  const [replies, setReplies] = useState<Reply[]>([])
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [language, setLanguage] = useState<'ar' | 'en' | null>(null)

  useEffect(() => { void loadReplies().then(setReplies).catch(() => {}) }, [conversationId])
  useEffect(() => { setLanguage(null) }, [messageId])

  const result = useMemo(() => (customerText ? suggestIntents(customerText) : null), [customerText])
  const lang = language ?? result?.language ?? 'ar'
  const items = useMemo(() => {
    if (!result) return []
    const tag = lang === 'ar' ? 'AR' : 'EN'
    return result.suggestions
      .map((s) => ({ ...s, reply: replies.find((r) => r.title.startsWith(`${s.code}-${tag}`)) }))
      .filter((s): s is typeof s & { reply: Reply } => Boolean(s.reply))
  }, [result, replies, lang])

  if (hidden || !messageId || dismissed === messageId || !items.length) return null
  return (
    <div className="smart-reply-bar" dir={lang === 'ar' ? 'rtl' : 'ltr'} role="group" aria-label={lang === 'ar' ? 'ردود مقترحة' : 'Suggested replies'}>
      <span className="smart-reply-label">{lang === 'ar' ? 'مقترح' : 'Suggested'}</span>
      <div className="smart-reply-chips">
        {items.map((item) => (
          <button key={item.code} type="button" className="smart-reply-chip" title={(lang === 'ar' ? 'لأن العميل كتب: ' : 'Because the customer wrote: ') + item.evidence}
            onClick={() => { onUse(item.reply.body); setDismissed(messageId) }}>
            {item.label}
          </button>
        ))}
      </div>
      <button type="button" className="smart-reply-lang" onClick={() => setLanguage(lang === 'ar' ? 'en' : 'ar')} aria-label={lang === 'ar' ? 'Show English replies' : 'عرض الردود بالعربي'}>{lang === 'ar' ? 'EN' : 'ع'}</button>
      <button type="button" className="smart-reply-close" onClick={() => setDismissed(messageId)} aria-label={lang === 'ar' ? 'إخفاء' : 'Dismiss'}>×</button>
    </div>
  )
}

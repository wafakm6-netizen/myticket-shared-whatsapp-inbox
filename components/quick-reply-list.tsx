'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { normalize } from '@/lib/replies/intents'

// Shared list of saved replies: search, a language switch and big tap targets.
// Used by the in-chat picker (tap = put it in the composer) and by the Replies page (tap = open actions).
export type SavedReplyItem = { id: string; title: string; body: string }
export type ReplyLanguage = 'ar' | 'en' | 'all'

// "QR02-AR | التذكرة لم تصل" -> { code: 'QR02', lang: 'ar', label: 'التذكرة لم تصل' }. Other titles pass through unchanged.
export function parseReplyTitle(title: string): { code: string | null; lang: 'ar' | 'en' | null; label: string } {
  const match = title.match(/^\s*(QR\d+)-(AR|EN)\s*\|\s*(.+)$/i)
  if (match) return { code: match[1].toUpperCase(), lang: match[2].toUpperCase() === 'AR' ? 'ar' : 'en', label: match[3].trim() }
  const arabic = /[؀-ۿ]/.test(title)
  return { code: null, lang: arabic ? 'ar' : null, label: title }
}

function replyLanguage(reply: SavedReplyItem): 'ar' | 'en' {
  const parsed = parseReplyTitle(reply.title)
  if (parsed.lang) return parsed.lang
  return /[؀-ۿ]/.test(reply.body) ? 'ar' : 'en'
}

type Props = {
  replies: SavedReplyItem[]
  initialLanguage?: ReplyLanguage
  emptyText?: string
  autoFocusSearch?: boolean
  onTap: (reply: SavedReplyItem) => void
  renderExpanded?: (reply: SavedReplyItem) => ReactNode
  expandedId?: string | null
}

export function QuickReplyList({ replies, initialLanguage = 'all', emptyText = 'No saved replies found.', autoFocusSearch, onTap, renderExpanded, expandedId }: Props) {
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState<ReplyLanguage>(initialLanguage)

  const items = useMemo(() => {
    const query = normalize(search)
    return replies
      .filter((reply) => language === 'all' || replyLanguage(reply) === language)
      .filter((reply) => !query || normalize(`${reply.title} ${reply.body}`).includes(query))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
  }, [replies, search, language])

  return (
    <div className="qr-list-root">
      <div className="qr-list-tools">
        <label className="qr-list-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search · ابحث" aria-label="Search saved replies" autoFocus={autoFocusSearch} enterKeyHint="search" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>}
        </label>
        <div className="qr-list-langs" role="tablist" aria-label="Reply language">
          {([['ar', 'عربي'], ['en', 'English'], ['all', 'All']] as const).map(([key, text]) => (
            <button key={key} type="button" role="tab" aria-selected={language === key} className={language === key ? 'selected' : ''} onClick={() => setLanguage(key)}>{text}</button>
          ))}
        </div>
      </div>
      <div className="qr-list-items">
        {items.length === 0 ? <p className="qr-list-empty">{emptyText}</p> : items.map((reply) => {
          const parsed = parseReplyTitle(reply.title)
          const lang = replyLanguage(reply)
          const open = expandedId === reply.id
          return (
            <div key={reply.id} className={`qr-list-item${open ? ' open' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <button type="button" className="qr-list-tap" onClick={() => onTap(reply)}>
                <span className="qr-list-title"><strong>{parsed.label}</strong>{parsed.code && <small>{parsed.code}</small>}</span>
                <span className="qr-list-body">{reply.body}</span>
              </button>
              {open && renderExpanded?.(reply)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

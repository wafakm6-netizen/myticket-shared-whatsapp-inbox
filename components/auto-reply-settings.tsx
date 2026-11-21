'use client'

import { useEffect, useMemo, useState } from 'react'

// Workspace settings → Auto reply menu (admins). Edit the topics customers can tap, the welcome and hand-off
// messages, and the wait before the menu is sent. Starts switched off.
type Option = { id: string; title_ar: string; title_en: string; description_ar?: string | null; description_en?: string | null; reply_code?: string | null; handoff: boolean; tag?: string | null }
type Settings = { enabled: boolean; delay_seconds: number; cooldown_hours: number; intro_ar: string; intro_en: string; button_ar: string; button_en: string; handoff_ar: string; handoff_en: string; options: Option[] }
type Reply = { id: string; title: string }

const DELAYS = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']] as const

export function AutoReplySettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [replies, setReplies] = useState<Reply[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void fetch('/api/auto-reply', { cache: 'no-store' }).then((r) => r.json()).then((payload) => { if (payload.setupNeeded) setSetupNeeded(true); else setSettings(payload.settings) }).catch(() => setError('Auto reply settings are unavailable.'))
    void fetch('/api/saved-replies', { cache: 'no-store' }).then((r) => r.json()).then((payload) => setReplies(payload.replies ?? [])).catch(() => {})
  }, [])

  const codes = useMemo(() => {
    const map = new Map<string, string>()
    for (const reply of replies) { const match = reply.title.match(/^(QR\d+)-(AR|EN)\s*\|\s*(.+)$/i); if (match && (!map.has(match[1]) || match[2].toUpperCase() === 'EN')) map.set(match[1].toUpperCase(), match[3]) }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [replies])

  if (setupNeeded) return <p className="auto-reply-note">To use the auto reply menu, run <code>supabase/migrations/20261121000000_auto_reply_menu.sql</code> once in Supabase → SQL Editor, then open this page again.</p>
  if (!settings) return <p className="auto-reply-note">{error || 'Loading…'}</p>

  const set = (patch: Partial<Settings>) => { setSettings({ ...settings, ...patch }); setNotice('') }
  const setOption = (index: number, patch: Partial<Option>) => set({ options: settings.options.map((option, i) => (i === index ? { ...option, ...patch } : option)) })
  const move = (index: number, by: number) => { const options = [...settings.options]; const [item] = options.splice(index, 1); options.splice(index + by, 0, item); set({ options }) }

  const save = async (next: Settings) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/auto-reply', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Settings could not be saved.')
      setSettings(payload.settings); setNotice('Saved')
    } catch (err) { setError(err instanceof Error ? err.message : 'Settings could not be saved.') } finally { setBusy(false) }
  }

  return (
    <div className="auto-reply-settings">
      <p className="auto-reply-note">If nobody answers a customer within the wait below, WhatsApp sends them a list of topics to tap. Their choice gets the linked quick reply, or a “the team will follow up” message, and the chat is tagged. Payment, refund and cancellation topics should always go to the team.</p>
      <label className="auto-reply-switch"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void save({ ...settings, enabled: event.target.checked })} /><span>{settings.enabled ? 'On — customers get the menu' : 'Off'}</span></label>
      <label className="auto-reply-field"><span>Send the menu after</span><select value={settings.delay_seconds} onChange={(event) => set({ delay_seconds: Number(event.target.value) })}>{DELAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="auto-reply-pair">
        <label className="auto-reply-field"><span>Welcome (Arabic)</span><textarea dir="rtl" rows={3} value={settings.intro_ar} onChange={(event) => set({ intro_ar: event.target.value })} /></label>
        <label className="auto-reply-field"><span>Welcome (English)</span><textarea rows={3} value={settings.intro_en} onChange={(event) => set({ intro_en: event.target.value })} /></label>
        <label className="auto-reply-field"><span>Hand-off to team (Arabic)</span><textarea dir="rtl" rows={2} value={settings.handoff_ar} onChange={(event) => set({ handoff_ar: event.target.value })} /></label>
        <label className="auto-reply-field"><span>Hand-off to team (English)</span><textarea rows={2} value={settings.handoff_en} onChange={(event) => set({ handoff_en: event.target.value })} /></label>
      </div>
      <h4 className="auto-reply-heading">Topics ({settings.options.length}/10)</h4>
      {settings.options.map((option, index) => (
        <div className="auto-reply-option" key={option.id + index}>
          <div className="auto-reply-option-head"><strong>{index + 1}</strong><span>{option.title_ar || '—'} · {option.title_en || '—'}</span>
            <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">↑</button>
            <button type="button" disabled={index === settings.options.length - 1} onClick={() => move(index, 1)} aria-label="Move down">↓</button>
            <button type="button" onClick={() => set({ options: settings.options.filter((_, i) => i !== index) })} aria-label="Remove topic">×</button></div>
          <div className="auto-reply-pair">
            <input dir="rtl" maxLength={24} placeholder="العنوان (24 حرف)" value={option.title_ar} onChange={(event) => setOption(index, { title_ar: event.target.value })} />
            <input maxLength={24} placeholder="Title (24 characters)" value={option.title_en} onChange={(event) => setOption(index, { title_en: event.target.value })} />
            <input dir="rtl" maxLength={72} placeholder="وصف قصير (اختياري)" value={option.description_ar || ''} onChange={(event) => setOption(index, { description_ar: event.target.value })} />
            <input maxLength={72} placeholder="Short description (optional)" value={option.description_en || ''} onChange={(event) => setOption(index, { description_en: event.target.value })} />
            <select value={option.handoff || !option.reply_code ? '' : option.reply_code} onChange={(event) => setOption(index, event.target.value ? { reply_code: event.target.value, handoff: false } : { reply_code: null, handoff: true })}>
              <option value="">Hand to the team</option>
              {codes.map(([code, label]) => <option key={code} value={code}>Reply {code} · {label}</option>)}
            </select>
            <input maxLength={40} placeholder="Tag to add (optional)" value={option.tag || ''} onChange={(event) => setOption(index, { tag: event.target.value })} />
          </div>
        </div>
      ))}
      {settings.options.length < 10 && <button type="button" className="secondary-btn" onClick={() => set({ options: [...settings.options, { id: `opt${Date.now().toString(36)}`, title_ar: '', title_en: '', handoff: true, reply_code: null, tag: null }] })}>+ Add topic</button>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="auto-reply-actions"><button type="button" className="send-btn" disabled={busy} onClick={() => void save(settings)}>{busy ? 'Saving…' : 'Save changes'}</button>{notice && <span>{notice} ✓</span>}</div>
    </div>
  )
}

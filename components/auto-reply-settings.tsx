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
  const [saved, setSaved] = useState('')
  const [previewLang, setPreviewLang] = useState<'ar' | 'en'>('ar')
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)

  useEffect(() => {
    void fetch('/api/auto-reply', { cache: 'no-store' }).then((r) => r.json()).then((payload) => { if (payload.setupNeeded) setSetupNeeded(true); else { setSettings(payload.settings); setSaved(JSON.stringify(payload.settings)) } }).catch(() => setError('Auto reply settings are unavailable.'))
    void fetch('/api/saved-replies', { cache: 'no-store' }).then((r) => r.json()).then((payload) => setReplies(payload.replies ?? [])).catch(() => {})
  }, [])

  const codes = useMemo(() => {
    const map = new Map<string, string>()
    for (const reply of replies) { const match = reply.title.match(/^(QR\d+)-(AR|EN)\s*\|\s*(.+)$/i); if (match && (!map.has(match[1]) || match[2].toUpperCase() === 'EN')) map.set(match[1].toUpperCase(), match[3]) }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [replies])

  if (setupNeeded) return <p className="auto-reply-note">To use the auto reply menu, run <code>supabase/migrations/20261121000000_auto_reply_menu.sql</code> once in Supabase → SQL Editor, then open this page again.</p>
  if (!settings) return <p className="auto-reply-note">{error || 'Loading…'}</p>

  const set = (patch: Partial<Settings>) => { setSettings({ ...settings, ...patch }); setNotice(''); setConfirmRemove(null) }
  const setOption = (index: number, patch: Partial<Option>) => set({ options: settings.options.map((option, i) => (i === index ? { ...option, ...patch } : option)) })
  const move = (index: number, by: number) => { const options = [...settings.options]; const [item] = options.splice(index, 1); options.splice(index + by, 0, item); set({ options }) }

  const save = async (next: Settings) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/auto-reply', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Settings could not be saved.')
      setSettings(payload.settings); setSaved(JSON.stringify(payload.settings)); setNotice('Saved')
    } catch (err) { setError(err instanceof Error ? err.message : 'Settings could not be saved.') } finally { setBusy(false) }
  }

  const dirty = JSON.stringify(settings) !== saved
  const ar = previewLang === 'ar'
  const previewOptions = settings.options.filter((option) => option.title_ar || option.title_en)
  const replyLabel = (option: Option) => (option.handoff || !option.reply_code ? 'Hands the chat to the team' : `Sends quick reply ${option.reply_code}${codes.find(([code]) => code === option.reply_code)?.[1] ? ' · ' + codes.find(([code]) => code === option.reply_code)![1] : ''}`)

  return (
    <div className="auto-reply-settings">
      <p className="auto-reply-note">If nobody answers a customer within the wait below, WhatsApp sends them this menu. Their choice gets the linked quick reply, or a “the team will follow up” message, and the chat is tagged. Payment, refund and cancellation should always go to the team.</p>
      <div className="auto-reply-top">
        <label className="auto-reply-switch"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void save({ ...settings, enabled: event.target.checked })} /><span>{settings.enabled ? 'On — customers get the menu' : 'Off'}</span></label>
        <label className="auto-reply-field auto-reply-delay"><span>Send after</span><select value={settings.delay_seconds} onChange={(event) => set({ delay_seconds: Number(event.target.value) })}>{DELAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="auto-reply-layout">
        <div className="auto-reply-editor">
          <h4 className="auto-reply-heading">Topics the customer can tap ({settings.options.length}/10)</h4>
          {settings.options.map((option, index) => (
            <div className="auto-reply-option" key={option.id}>
              <div className="auto-reply-option-head"><strong>{index + 1}</strong><span>{replyLabel(option)}</span>
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">↑</button>
                <button type="button" disabled={index === settings.options.length - 1} onClick={() => move(index, 1)} aria-label="Move down">↓</button>
                <button type="button" className={confirmRemove === index ? 'danger' : ''} onClick={() => { if (confirmRemove !== index) { setConfirmRemove(index); return } setConfirmRemove(null); set({ options: settings.options.filter((_, i) => i !== index) }) }} aria-label="Remove topic">{confirmRemove === index ? 'Remove?' : '×'}</button></div>
              <div className="auto-reply-pair">
                <label className="auto-reply-field"><span>Title · عربي <em>{option.title_ar.length}/24</em></span><input dir="rtl" maxLength={24} placeholder="مثال: أبي أحجز" value={option.title_ar} onChange={(event) => setOption(index, { title_ar: event.target.value })} /></label>
                <label className="auto-reply-field"><span>Title · English <em>{option.title_en.length}/24</em></span><input maxLength={24} placeholder="e.g. I want to book" value={option.title_en} onChange={(event) => setOption(index, { title_en: event.target.value })} /></label>
                <label className="auto-reply-field"><span>Description · عربي (optional)</span><input dir="rtl" maxLength={72} value={option.description_ar || ''} onChange={(event) => setOption(index, { description_ar: event.target.value })} /></label>
                <label className="auto-reply-field"><span>Description · English (optional)</span><input maxLength={72} value={option.description_en || ''} onChange={(event) => setOption(index, { description_en: event.target.value })} /></label>
                <label className="auto-reply-field"><span>When tapped</span><select value={option.handoff || !option.reply_code ? '' : option.reply_code} onChange={(event) => setOption(index, event.target.value ? { reply_code: event.target.value, handoff: false } : { reply_code: null, handoff: true })}>
                  <option value="">Hand to the team</option>
                  {codes.map(([code, label]) => <option key={code} value={code}>Send {code} · {label}</option>)}
                </select></label>
                <label className="auto-reply-field"><span>Tag the chat (optional)</span><input maxLength={40} placeholder="e.g. Booking" value={option.tag || ''} onChange={(event) => setOption(index, { tag: event.target.value })} /></label>
              </div>
            </div>
          ))}
          {settings.options.length < 10 && <button type="button" className="auto-reply-add" onClick={() => set({ options: [...settings.options, { id: `opt${Date.now().toString(36)}`, title_ar: '', title_en: '', handoff: true, reply_code: null, tag: null }] })}>+ Add topic</button>}
          <h4 className="auto-reply-heading">Messages</h4>
          <div className="auto-reply-pair">
            <label className="auto-reply-field"><span>Welcome · عربي</span><textarea dir="rtl" rows={3} value={settings.intro_ar} onChange={(event) => set({ intro_ar: event.target.value })} /></label>
            <label className="auto-reply-field"><span>Welcome · English</span><textarea rows={3} value={settings.intro_en} onChange={(event) => set({ intro_en: event.target.value })} /></label>
            <label className="auto-reply-field"><span>Hand-off to team · عربي</span><textarea dir="rtl" rows={2} value={settings.handoff_ar} onChange={(event) => set({ handoff_ar: event.target.value })} /></label>
            <label className="auto-reply-field"><span>Hand-off to team · English</span><textarea rows={2} value={settings.handoff_en} onChange={(event) => set({ handoff_en: event.target.value })} /></label>
          </div>
        </div>
        <aside className="auto-reply-preview" aria-label="What the customer sees">
          <div className="auto-reply-preview-head"><strong>Customer sees</strong><div role="tablist"><button type="button" className={ar ? 'selected' : ''} onClick={() => setPreviewLang('ar')}>عربي</button><button type="button" className={!ar ? 'selected' : ''} onClick={() => setPreviewLang('en')}>English</button></div></div>
          <div className="auto-reply-phone" dir={ar ? 'rtl' : 'ltr'}>
            <div className="auto-reply-bubble"><p>{ar ? settings.intro_ar : settings.intro_en}</p><div className="auto-reply-bubble-button">☰ {ar ? settings.button_ar : settings.button_en}</div></div>
            <div className="auto-reply-sheet">
              {previewOptions.length === 0 ? <p className="auto-reply-note">No topics yet.</p> : previewOptions.map((option) => <div key={option.id} className="auto-reply-sheet-row"><div><strong>{(ar ? option.title_ar : option.title_en) || '—'}</strong>{(ar ? option.description_ar : option.description_en) && <span>{ar ? option.description_ar : option.description_en}</span>}</div><i aria-hidden="true" /></div>)}
            </div>
          </div>
        </aside>
      </div>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className={`auto-reply-actions${dirty ? ' dirty' : ''}`}><span className="auto-reply-state">{dirty ? 'Unsaved changes' : notice ? notice + ' ✓' : 'All changes saved'}</span><button type="button" className="send-btn" disabled={busy || !dirty} onClick={() => void save(settings)}>{busy ? 'Saving…' : 'Save changes'}</button></div>
    </div>
  )
}

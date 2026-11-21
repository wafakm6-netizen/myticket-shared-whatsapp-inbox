'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

// Workspace settings → Auto reply menu (admins). The settings page shows a short summary; "Edit menu" opens a
// full-screen editor: topic list on the left (tap one to edit it), what the customer sees on the right, and a
// Save button that is always in the top bar. Starts switched off.
type Option = { id: string; title_ar: string; title_en: string; description_ar?: string | null; description_en?: string | null; reply_code?: string | null; handoff: boolean; tag?: string | null }
type Settings = { enabled: boolean; delay_seconds: number; cooldown_hours: number; intro_ar: string; intro_en: string; button_ar: string; button_en: string; handoff_ar: string; handoff_en: string; options: Option[] }
type Reply = { id: string; title: string }

const DELAYS = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']] as const

export function AutoReplySettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState('')
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [replies, setReplies] = useState<Reply[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [selected, setSelected] = useState<number | 'messages' | null>(0)
  const [previewLang, setPreviewLang] = useState<'ar' | 'en'>('ar')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    void fetch('/api/auto-reply', { cache: 'no-store' }).then((r) => r.json()).then((payload) => {
      if (payload.setupNeeded) { setSetupNeeded(true); return }
      setSettings(payload.settings); setSaved(JSON.stringify(payload.settings))
    }).catch(() => setError('Auto reply settings are unavailable.'))
    void fetch('/api/saved-replies', { cache: 'no-store' }).then((r) => r.json()).then((payload) => setReplies(payload.replies ?? [])).catch(() => {})
  }, [])

  const codes = useMemo(() => {
    const map = new Map<string, string>()
    for (const reply of replies) { const match = reply.title.match(/^(QR\d+)-(AR|EN)\s*\|\s*(.+)$/i); if (match && (!map.has(match[1].toUpperCase()) || match[2].toUpperCase() === 'EN')) map.set(match[1].toUpperCase(), match[3]) }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [replies])

  if (setupNeeded) return <p className="auto-reply-note">To use the auto reply menu, run <code>supabase/migrations/20261121000000_auto_reply_menu.sql</code> once in Supabase → SQL Editor, then open this page again.</p>
  if (!settings) return <p className="auto-reply-note">{error || 'Loading…'}</p>

  const dirty = JSON.stringify(settings) !== saved
  const set = (patch: Partial<Settings>) => { setSettings({ ...settings, ...patch }); setConfirmRemove(false); setConfirmDiscard(false) }
  const setOption = (index: number, patch: Partial<Option>) => set({ options: settings.options.map((option, i) => (i === index ? { ...option, ...patch } : option)) })
  const move = (index: number, by: number) => { const options = [...settings.options]; const [item] = options.splice(index, 1); options.splice(index + by, 0, item); set({ options }); setSelected(index + by) }
  const actionText = (option: Option) => {
    if (option.handoff || !option.reply_code) return 'Hands the chat to the team'
    const label = codes.find(([code]) => code === option.reply_code)?.[1]
    return `Sends ${option.reply_code}${label ? ' · ' + label : ''}`
  }

  const save = async (next: Settings) => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/auto-reply', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Settings could not be saved.')
      setSettings(payload.settings); setSaved(JSON.stringify(payload.settings))
      return true
    } catch (err) { setError(err instanceof Error ? err.message : 'Settings could not be saved.'); return false } finally { setBusy(false) }
  }
  // The On/Off switch on the settings page saves only the switch, never half-finished edits.
  const toggle = async (enabled: boolean) => { await save({ ...(JSON.parse(saved) as Settings), enabled }) }
  const close = () => {
    if (dirty && !confirmDiscard) { setConfirmDiscard(true); return }
    if (dirty) setSettings(JSON.parse(saved))
    setConfirmDiscard(false); setEditorOpen(false); setError('')
  }
  const addTopic = () => {
    const options = [...settings.options, { id: `opt${Date.now().toString(36)}`, title_ar: '', title_en: '', handoff: true, reply_code: null, tag: null }]
    set({ options }); setSelected(options.length - 1)
  }

  const ar = previewLang === 'ar'
  const index = typeof selected === 'number' ? selected : -1
  const option = index >= 0 ? settings.options[index] : undefined

  const summary = (
    <div className="auto-reply-summary">
      <label className="auto-reply-switch"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void toggle(event.target.checked)} /><span>{settings.enabled ? 'On — customers get the menu' : 'Off'}</span></label>
      <p className="auto-reply-note">{settings.options.length} topics · sent after {DELAYS.find(([value]) => value === settings.delay_seconds)?.[1] || `${settings.delay_seconds} seconds`} without an answer.</p>
      <ol className="auto-reply-summary-list">{settings.options.map((item) => <li key={item.id}><span dir="rtl">{item.title_ar}</span><small>{item.title_en}</small></li>)}</ol>
      {error && !editorOpen && <p className="login-error" role="alert">{error}</p>}
      <button type="button" className="send-btn auto-reply-edit-btn" onClick={() => { setEditorOpen(true); setSelected(settings.options.length ? 0 : 'messages') }}>Edit menu</button>
    </div>
  )

  const editor = editorOpen && typeof document !== 'undefined' ? createPortal(
    <div className="ar-editor" role="dialog" aria-modal="true" aria-label="Edit auto reply menu">
      <header className="ar-editor-bar">
        <button type="button" className={`ar-editor-close${confirmDiscard ? ' danger' : ''}`} onClick={close}>{confirmDiscard ? 'Discard changes?' : 'Close'}</button>
        <strong>Auto reply menu</strong>
        <button type="button" className="ar-editor-save" disabled={busy || !dirty} onClick={() => void save(settings)}>{busy ? 'Saving…' : dirty ? 'Save' : 'Saved ✓'}</button>
      </header>
      {error && <p className="ar-editor-error" role="alert">{error}</p>}
      <div className="ar-editor-body">
        <nav className="ar-editor-list" aria-label="Topics">
          <div className="ar-editor-row-settings">
            <label className="auto-reply-switch"><input type="checkbox" checked={settings.enabled} onChange={(event) => set({ enabled: event.target.checked })} /><span>{settings.enabled ? 'On' : 'Off'}</span></label>
            <label className="ar-editor-delay"><span>Send after</span><select value={settings.delay_seconds} onChange={(event) => set({ delay_seconds: Number(event.target.value) })}>{DELAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <p className="ar-editor-caption">Topics ({settings.options.length}/10) — tap one to edit</p>
          {settings.options.map((item, i) => (
            <button type="button" key={item.id} className={`ar-editor-topic${selected === i ? ' selected' : ''}`} onClick={() => { setSelected(i); setConfirmRemove(false) }}>
              <b>{i + 1}</b>
              <span><strong dir="rtl">{item.title_ar || 'بدون عنوان'}</strong><small>{item.title_en || 'No title'} · {actionText(item)}</small></span>
            </button>
          ))}
          {settings.options.length < 10 && <button type="button" className="auto-reply-add" onClick={addTopic}>+ Add topic</button>}
          <button type="button" className={`ar-editor-topic ar-editor-messages${selected === 'messages' ? ' selected' : ''}`} onClick={() => setSelected('messages')}><b>✉</b><span><strong>Welcome &amp; hand-off messages</strong><small>The text above the menu, and the reply when a topic goes to the team</small></span></button>
        </nav>
        <section className="ar-editor-detail">
          {option && <>
            <div className="ar-editor-detail-head">
              <h3>Topic {index + 1}</h3>
              <div>
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑ Up</button>
                <button type="button" disabled={index === settings.options.length - 1} onClick={() => move(index, 1)}>↓ Down</button>
                <button type="button" className={confirmRemove ? 'danger' : ''} onClick={() => { if (!confirmRemove) { setConfirmRemove(true); return } const remaining = settings.options.length - 1; set({ options: settings.options.filter((_, i) => i !== index) }); setSelected(remaining > 0 ? Math.max(0, index - 1) : 'messages') }}>{confirmRemove ? 'Tap again to remove' : 'Remove'}</button>
              </div>
            </div>
            <label className="ar-field"><span>Arabic title <em>{option.title_ar.length}/24</em></span><input dir="rtl" maxLength={24} placeholder="مثال: أبي أحجز" value={option.title_ar} onChange={(event) => setOption(index, { title_ar: event.target.value })} /></label>
            <label className="ar-field"><span>English title <em>{option.title_en.length}/24</em></span><input maxLength={24} placeholder="e.g. I want to book" value={option.title_en} onChange={(event) => setOption(index, { title_en: event.target.value })} /></label>
            <label className="ar-field"><span>When the customer taps it</span><select value={option.handoff || !option.reply_code ? '' : option.reply_code} onChange={(event) => setOption(index, event.target.value ? { reply_code: event.target.value, handoff: false } : { reply_code: null, handoff: true })}>
              <option value="">Hand the chat to the team</option>
              {codes.map(([code, label]) => <option key={code} value={code}>Send quick reply {code} · {label}</option>)}
            </select></label>
            <label className="ar-field"><span>Tag the chat with (optional)</span><input maxLength={40} placeholder="e.g. Booking" value={option.tag || ''} onChange={(event) => setOption(index, { tag: event.target.value })} /></label>
            <details className="ar-more"><summary>Small grey line under the title (optional)</summary>
              <label className="ar-field"><span>Arabic</span><input dir="rtl" maxLength={72} value={option.description_ar || ''} onChange={(event) => setOption(index, { description_ar: event.target.value })} /></label>
              <label className="ar-field"><span>English</span><input maxLength={72} value={option.description_en || ''} onChange={(event) => setOption(index, { description_en: event.target.value })} /></label>
            </details>
          </>}
          {selected === 'messages' && <>
            <div className="ar-editor-detail-head"><h3>Messages</h3></div>
            <label className="ar-field"><span>Welcome · Arabic</span><textarea dir="rtl" rows={4} value={settings.intro_ar} onChange={(event) => set({ intro_ar: event.target.value })} /></label>
            <label className="ar-field"><span>Welcome · English</span><textarea rows={4} value={settings.intro_en} onChange={(event) => set({ intro_en: event.target.value })} /></label>
            <label className="ar-field"><span>Hand-off to team · Arabic</span><textarea dir="rtl" rows={3} value={settings.handoff_ar} onChange={(event) => set({ handoff_ar: event.target.value })} /></label>
            <label className="ar-field"><span>Hand-off to team · English</span><textarea rows={3} value={settings.handoff_en} onChange={(event) => set({ handoff_en: event.target.value })} /></label>
          </>}
        </section>
        <aside className="ar-editor-preview" aria-label="What the customer sees">
          <div className="auto-reply-preview-head"><strong>Customer sees</strong><div role="tablist"><button type="button" className={ar ? 'selected' : ''} onClick={() => setPreviewLang('ar')}>عربي</button><button type="button" className={!ar ? 'selected' : ''} onClick={() => setPreviewLang('en')}>English</button></div></div>
          <div className="auto-reply-phone" dir={ar ? 'rtl' : 'ltr'}>
            <div className="auto-reply-bubble"><p>{ar ? settings.intro_ar : settings.intro_en}</p><div className="auto-reply-bubble-button">☰ {ar ? settings.button_ar : settings.button_en}</div></div>
            <div className="auto-reply-sheet">
              {settings.options.map((item, i) => <button type="button" key={item.id} className={`auto-reply-sheet-row${selected === i ? ' selected' : ''}`} onClick={() => setSelected(i)}><div><strong>{(ar ? item.title_ar : item.title_en) || '—'}</strong>{(ar ? item.description_ar : item.description_en) && <span>{ar ? item.description_ar : item.description_en}</span>}</div><i aria-hidden="true" /></button>)}
            </div>
          </div>
        </aside>
      </div>
    </div>,
    document.body,
  ) : null

  return <>{summary}{editor}</>
}

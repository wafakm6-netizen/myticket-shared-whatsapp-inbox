'use client'

import { useEffect, useMemo, useState } from 'react'

export type ApprovedTemplate = {
  name: string
  language: string
  category: string
  components: Array<{ type: string; text?: string; format?: string; buttons?: unknown[] }>
}

export type TemplateSelection = { name: string; languageCode: string; parameters: string[]; header?: { type: 'image' | 'document'; id: string; filename?: string } }

const RECENT_KEY = 'myticket-recent-templates'

// "asking_for_meeting_if_first_message_did_not_get_answer_en" → base "asking_for_meeting_if_first_message_did_not_get_answer"
const baseName = (name: string) => name.replace(/_(en|ar)(_[a-z]{2})?$/i, '')
const friendlyName = (name: string) => { const words = baseName(name).replace(/_/g, ' ').trim(); return words.charAt(0).toUpperCase() + words.slice(1) }
const languageLabel = (code: string) => code.toLowerCase().startsWith('ar') ? 'AR' : code.toLowerCase().startsWith('en') ? 'EN' : code.toUpperCase()
const templateIcon = (template: ApprovedTemplate) => {
  const name = template.name.toLowerCase()
  if (/book|confirm|ticket|reserv/.test(name)) return '📅'
  if (/coupon|discount|offer|promo/.test(name)) return '🎟️'
  if (/vendor|supplier|partner|collab/.test(name)) return '🤝'
  if (/meeting|call|follow/.test(name)) return '📞'
  if (/hello|welcome/.test(name)) return '👋'
  if (/refund|payment|invoice/.test(name)) return '💳'
  return template.category === 'UTILITY' ? '💬' : '📣'
}
const keyOf = (template: ApprovedTemplate) => `${template.name}|${template.language}`
const textOf = (template: ApprovedTemplate | undefined, type: string) => template?.components.find((part) => part.type === type)?.text || ''
const buttonsOf = (template: ApprovedTemplate | undefined) => (template?.components.find((part) => part.type === 'BUTTONS')?.buttons ?? []).map((button) => (button as { text?: string })?.text).filter((text): text is string => !!text)
// A blank right after a greeting ("Hi {{1}}", "أهلاً {{1}}") is the customer's name.
const greetingSlots = (body: string) => new Set(Array.from(body.matchAll(/(?:\b(?:hi|hello|hey|dear)|مرحب[اًا]?|أهلاً|اهلا|أهلا|عزيزي|عزيزتي)[ ,،]*\{\{(\d+)\}\}/gi), (match) => Number(match[1])))

export function WhatsAppTemplatePicker({ onChange, onActiveChange, disabled = false, contactName = '' }: {
  onChange: (selection: TemplateSelection | null) => void
  onActiveChange?: (active: boolean) => void
  disabled?: boolean
  contactName?: string
}) {
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [headerMedia, setHeaderMedia] = useState<TemplateSelection['header']>()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'MARKETING' | 'UTILITY'>('all')
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')) } catch {} }, [])
  useEffect(() => {
    let active = true
    fetch('/api/whatsapp-templates', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load templates')
        if (active) setTemplates(payload.templates || [])
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load templates') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  // English and Arabic versions of the same template are listed once, with a language switch in the preview.
  const groups = useMemo(() => {
    const map = new Map<string, ApprovedTemplate[]>()
    for (const template of templates) { const key = baseName(template.name); map.set(key, [...(map.get(key) ?? []), template]) }
    return Array.from(map.entries()).map(([key, versions]) => ({ key, versions: versions.sort((a, b) => (languageLabel(a.language) === 'EN' ? 0 : 1) - (languageLabel(b.language) === 'EN' ? 0 : 1) || languageLabel(a.language).localeCompare(languageLabel(b.language))), name: friendlyName(versions[0].name), category: versions[0].category, icon: templateIcon(versions[0]) }))
  }, [templates])
  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = groups.filter((group) => (category === 'all' || group.category === category) && (!needle || `${group.name} ${group.versions.map((version) => `${version.name} ${textOf(version, 'BODY')}`).join(' ')}`.toLowerCase().includes(needle)))
    const rank = (group: (typeof groups)[number]) => { const index = recent.indexOf(group.key); return index < 0 ? 999 : index }
    return filtered.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [groups, query, category, recent])

  const selected = templates.find((template) => keyOf(template) === selectedKey)
  const selectedGroup = groups.find((group) => group.versions.some((version) => keyOf(version) === selectedKey))
  const body = textOf(selected, 'BODY')
  const indices = useMemo(() => [...new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])))].sort((a, b) => a - b), [body])
  const headerFormat = selected?.components.find((part) => part.type === 'HEADER')?.format
  const headerText = headerFormat === 'TEXT' ? textOf(selected, 'HEADER') : ''
  const footerText = textOf(selected, 'FOOTER')
  const buttons = buttonsOf(selected)
  const needsMedia = headerFormat === 'IMAGE' || headerFormat === 'DOCUMENT'
  const unsupported = Boolean(headerFormat && !['TEXT', 'IMAGE', 'DOCUMENT'].includes(headerFormat))
  const bodyCount = Math.max(0, ...indices)
  const publish = (template: ApprovedTemplate | undefined, entries: string[], media?: TemplateSelection['header']) => {
    const header = template?.components.find((part) => part.type === 'HEADER')?.format
    const content = textOf(template, 'BODY')
    const slots = [...new Set(Array.from(content.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])))]
    const wantsMedia = header === 'IMAGE' || header === 'DOCUMENT'
    const badHeader = Boolean(header && !['TEXT', 'IMAGE', 'DOCUMENT'].includes(header))
    if (!template || badHeader || (wantsMedia && !media) || slots.some((number) => !entries[number - 1]?.trim())) { onChange(null); return }
    onChange({ name: template.name, languageCode: template.language, parameters: Array.from({ length: Math.max(0, ...slots) }, (_, index) => entries[index]?.trim() || ''), ...(media ? { header: media } : {}) })
  }
  const uploadHeader = async (file?: File) => {
    setHeaderMedia(undefined); onChange(null); setUploadError('')
    if (!file || !selected) return
    const valid = headerFormat === 'IMAGE' ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) : headerFormat === 'DOCUMENT' ? ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type) : false
    if (!valid) { setUploadError('Choose a supported file matching this template header.'); return }
    setUploading(true)
    try {
      const form = new FormData(); form.append('file', file); form.append('purpose', 'template-header')
      const response = await fetch('/api/media', { method: 'POST', body: form })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.mediaId) throw new Error(result.error || 'Upload failed')
      const media: NonNullable<TemplateSelection['header']> = { type: headerFormat === 'IMAGE' ? 'image' : 'document', id: result.mediaId, ...(headerFormat === 'DOCUMENT' ? { filename: file.name } : {}) }
      setHeaderMedia(media)
      publish(selected, values, media)
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Upload failed') }
    finally { setUploading(false) }
  }
  const choose = (key: string) => {
    setSelectedKey(key)
    onActiveChange?.(Boolean(key))
    setHeaderMedia(undefined)
    setUploadError('')
    const template = templates.find((item) => keyOf(item) === key)
    if (!template) { setValues([]); onChange(null); return }
    // Fill the customer's first name into a blank that follows a greeting.
    const first = contactName.trim().split(/\s+/)[0] || ''
    const content = textOf(template, 'BODY')
    const next: string[] = []
    if (first && !/^\+?\d[\d\s]+$/.test(first)) for (const slot of greetingSlots(content)) next[slot - 1] = first
    setValues(next)
    publish(template, next)
    const group = groups.find((item) => item.versions.includes(template))
    if (group) setRecent((current) => { const updated = [group.key, ...current.filter((entry) => entry !== group.key)].slice(0, 5); try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)) } catch {}; return updated })
  }
  const setParameter = (index: number, value: string) => {
    const next = [...values]
    next[index] = value
    setValues(next)
    publish(selected, next, headerMedia)
  }
  // Body with each blank shown as the typed value (or its number), highlighted.
  const previewParts = body.split(/(\{\{\d+\}\})/g).map((part, index) => {
    const match = /^\{\{(\d+)\}\}$/.exec(part)
    if (!match) return <span key={index}>{part}</span>
    const value = values[Number(match[1]) - 1]?.trim()
    return <mark key={index} className={value ? 'tpl-var is-filled' : 'tpl-var'}>{value || `{{${match[1]}}}`}</mark>
  })
  const isRecent = (key: string) => recent.includes(key)

  return <div className="meta-template-picker tpl-picker-wrap"><div className={`tpl-picker ${selected ? 'has-selection' : ''}`}>
    <div className="tpl-list-pane">
      <label className="tpl-search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates…" aria-label="Search templates" disabled={disabled || loading} /></label>
      <div className="tpl-chips" role="tablist" aria-label="Template type">{([['all', 'All'], ['MARKETING', 'Marketing'], ['UTILITY', 'Utility']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={category === value} className={category === value ? 'is-on' : ''} onClick={() => setCategory(value)}>{label}</button>)}</div>
      <div className="tpl-list" role="listbox" aria-label="Approved templates">
        {loading && <p className="template-note">Loading approved templates…</p>}
        {error && <p role="alert" className="template-error">{error}</p>}
        {!loading && !error && templates.length === 0 && <p className="template-note">No approved templates found in Meta WhatsApp Manager.</p>}
        {!loading && !error && templates.length > 0 && visibleGroups.length === 0 && <p className="template-note">No templates match.</p>}
        {visibleGroups.map((group) => { const on = selectedGroup?.key === group.key; return <button type="button" role="option" aria-selected={on} key={group.key} className={`tpl-item ${on ? 'is-on' : ''}`} disabled={disabled} onClick={() => choose(keyOf(on && selected ? selected : group.versions[0]))}>
          <span className="tpl-icon" aria-hidden="true">{group.icon}</span>
          <span className="tpl-item-copy"><strong>{group.name}</strong><small>{group.category === 'UTILITY' ? 'Utility' : group.category === 'MARKETING' ? 'Marketing' : group.category.toLowerCase()} · {group.versions.map((version) => languageLabel(version.language)).join(' · ')}{isRecent(group.key) ? ' · Recent' : ''}</small></span>
        </button> })}
      </div>
    </div>
    <div className="tpl-preview-pane">
      {!selected ? <div className="tpl-empty"><span aria-hidden="true">💬</span><p>Choose a template to see exactly what the customer will receive.</p></div> : <>
        <div className="tpl-preview-head"><button type="button" className="tpl-back" onClick={() => choose('')} aria-label="Back to templates">‹</button><strong>{selectedGroup?.name}</strong>{selectedGroup && selectedGroup.versions.length > 1 && <span className="tpl-langs" role="radiogroup" aria-label="Language">{selectedGroup.versions.map((version) => <button key={version.language} type="button" role="radio" aria-checked={version.language === selected.language} className={version.language === selected.language ? 'is-on' : ''} onClick={() => choose(keyOf(version))}>{languageLabel(version.language)}</button>)}</span>}</div>
        <div className="tpl-phone">
          <div className="tpl-bubble" dir="auto">
            {needsMedia && <div className={`tpl-bubble-media ${headerMedia ? 'is-ready' : ''}`}>{headerFormat === 'IMAGE' ? '🖼️' : '📄'} {headerMedia ? (headerMedia.filename || 'Attachment ready') : headerFormat === 'IMAGE' ? 'Image' : 'Document'}</div>}
            {headerText && <strong className="tpl-bubble-title">{headerText}</strong>}
            <p>{body ? previewParts : '(No body text)'}</p>
            {footerText && <small className="tpl-bubble-footer">{footerText}</small>}
          </div>
          {buttons.length > 0 && <div className="tpl-bubble-buttons">{buttons.map((label) => <span key={label}>{label}</span>)}</div>}
        </div>
        {needsMedia && <label className="tpl-field">Attach {headerFormat === 'IMAGE' ? 'image' : 'document'}<input type="file" disabled={disabled || uploading} accept={headerFormat === 'IMAGE' ? 'image/jpeg,image/png,image/webp' : '.pdf,.doc,.docx'} onChange={(event) => void uploadHeader(event.target.files?.[0])}/>{uploading && <small>Uploading attachment…</small>}{uploadError && <span className="template-error">{uploadError}</span>}</label>}
        {unsupported && <p className="template-error">This template uses an unsupported header format.</p>}
        {indices.map((number) => <label key={number} className="tpl-field"><span>Blank {`{{${number}}}`}</span><input dir="auto" disabled={disabled || unsupported} value={values[number - 1] || ''} onChange={(event) => setParameter(number - 1, event.target.value)} placeholder={`Fill in {{${number}}}`} /></label>)}
        <small className="tpl-note">Only approved templates are shown. Meta&apos;s 24-hour messaging rules still apply.</small>
      </>}
    </div>
  </div></div>
}

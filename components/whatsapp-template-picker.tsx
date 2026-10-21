'use client'

import { useEffect, useMemo, useState } from 'react'

export type ApprovedTemplate = {
  name: string
  language: string
  category: string
  components: Array<{ type: string; text?: string; format?: string; buttons?: unknown[] }>
}

export type TemplateSelection = { name: string; languageCode: string; parameters: string[]; header?: { type: 'image' | 'document'; link: string; filename?: string } }

export function WhatsAppTemplatePicker({ onChange, onActiveChange, disabled = false }: {
  onChange: (selection: TemplateSelection | null) => void
  onActiveChange?: (active: boolean) => void
  disabled?: boolean
}) {
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [headerMedia, setHeaderMedia] = useState<TemplateSelection['header']>()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [error, setError] = useState('')
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
  const selected = templates.find((template) => `${template.name}|${template.language}` === selectedKey)
  const body = selected?.components.find((part) => part.type === 'BODY')?.text || ''
  const indices = useMemo(() => [...new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])))].sort((a, b) => a - b), [body])
  const headerFormat = selected?.components.find((part) => part.type === 'HEADER')?.format
  const needsMedia = headerFormat === 'IMAGE' || headerFormat === 'DOCUMENT'
  const unsupported = Boolean(headerFormat && !['TEXT', 'IMAGE', 'DOCUMENT'].includes(headerFormat))
  const bodyCount = Math.max(0, ...indices)
  const publish = (template: ApprovedTemplate | undefined, entries: string[], media?: TemplateSelection['header']) => {
    if (!template || unsupported || (needsMedia && !media) || indices.some((number) => !entries[number - 1]?.trim())) { onChange(null); return }
    onChange({ name: template.name, languageCode: template.language, parameters: Array.from({ length: bodyCount }, (_, index) => entries[index]?.trim() || ''), ...(media ? { header: media } : {}) })
  }
  const uploadHeader = async (file?: File) => {
    setHeaderMedia(undefined); onChange(null); setUploadError('')
    if (!file || !selected) return
    const valid = headerFormat === 'IMAGE' ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) : headerFormat === 'DOCUMENT' ? ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type) : false
    if (!valid) { setUploadError('Choose a supported file matching this template header.'); return }
    setUploading(true)
    try {
      const form = new FormData(); form.append('file', file)
      const response = await fetch('/api/media', { method: 'POST', body: form })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.url) throw new Error(result.error || 'Upload failed')
      const media: NonNullable<TemplateSelection['header']> = { type: headerFormat === 'IMAGE' ? 'image' : 'document', link: result.url, ...(headerFormat === 'DOCUMENT' ? { filename: file.name } : {}) }
      setHeaderMedia(media)
      publish(selected, values, media)
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Upload failed') }
    finally { setUploading(false) }
  }
  const preview = body.replace(/\{\{(\d+)\}\}/g, (_, index) => values[Number(index) - 1] || `{{${index}}}`)
  const choose = (key: string) => {
    setSelectedKey(key)
    onActiveChange?.(Boolean(key))
    setValues([])
    setHeaderMedia(undefined)
    setUploadError('')
    if (!key) onChange(null)
    else {
      const template = templates.find((item) => `${item.name}|${item.language}` === key)
      if (template) {
        onChange(null)
        const header = template.components.find((part) => part.type === 'HEADER')
        const content = template.components.find((part) => part.type === 'BODY')?.text || ''
        if ((!header?.format || header.format === 'TEXT') && !/\{\{\d+\}\}/.test(content)) onChange({ name: template.name, languageCode: template.language, parameters: [] })
      }
    }
  }
  const setParameter = (index: number, value: string) => {
    const next = [...values]
    next[index] = value
    setValues(next)
    publish(selected, next, headerMedia)
  }
  return <div className="meta-template-picker">
    <label htmlFor="meta-template-select">Approved Meta template</label>
    <select id="meta-template-select" disabled={disabled || loading} value={selectedKey} onChange={(event) => choose(event.target.value)}>
      <option value="">{loading ? 'Loading approved templates…' : 'Select a template…'}</option>
      {templates.map((template) => <option key={`${template.name}|${template.language}`} value={`${template.name}|${template.language}`}>{template.name} — {template.language} ({template.category})</option>)}
    </select>
    {error && <p role="alert" className="template-error">{error}</p>}
    {!loading && !error && templates.length === 0 && <p className="template-note">No approved templates found in Meta WhatsApp Manager.</p>}
    {selected && <div className="template-preview">
      <span className="template-preview-label">Message preview</span>
      <p dir="auto">{preview || '(No body text)'}</p>
      {needsMedia && <label>Attach {headerFormat === 'IMAGE' ? 'image' : 'document'}<input type="file" disabled={disabled || uploading} accept={headerFormat === 'IMAGE' ? 'image/jpeg,image/png,image/webp' : '.pdf,.doc,.docx'} onChange={(event) => void uploadHeader(event.target.files?.[0])}/>{uploading && <small>Uploading attachment…</small>}{headerMedia && <small>Attachment ready</small>}{uploadError && <span className="template-error">{uploadError}</span>}</label>}
      {unsupported && <p className="template-error">This template uses an unsupported header format.</p>}
      {indices.map((number) => <label key={number}>Variable {number}<input disabled={disabled || unsupported} value={values[number - 1] || ''} onChange={(event) => setParameter(number - 1, event.target.value)} placeholder={`Enter value for {{${number}}}`} /></label>)}
      <small>Only approved templates are shown. Meta's 24-hour messaging rules still apply.</small>
    </div>}
  </div>
}

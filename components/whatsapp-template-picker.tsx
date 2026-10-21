'use client'

import { useEffect, useMemo, useState } from 'react'

export type ApprovedTemplate = {
  name: string
  language: string
  category: string
  components: Array<{ type: string; text?: string; format?: string; buttons?: unknown[] }>
}

export type TemplateSelection = { name: string; languageCode: string; parameters: string[] }

export function WhatsAppTemplatePicker({ onChange, disabled = false }: {
  onChange: (selection: TemplateSelection | null) => void
  disabled?: boolean
}) {
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
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
  const unsupported = Boolean(selected?.components.some((part) => part.type === 'HEADER' && part.format && part.format !== 'TEXT'))
  const preview = body.replace(/\{\{(\d+)\}\}/g, (_, index) => values[Number(index) - 1] || `{{${index}}}`)
  const choose = (key: string) => {
    setSelectedKey(key)
    setValues([])
    if (!key) onChange(null)
    else {
      const template = templates.find((item) => `${item.name}|${item.language}` === key)
      if (template) {
        const content = template.components.find((part) => part.type === 'BODY')?.text || ''
        const count = Math.max(0, ...Array.from(content.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])))
        const hasMediaHeader = template.components.some((part) => part.type === 'HEADER' && part.format && part.format !== 'TEXT')
        onChange(!hasMediaHeader && count === 0 ? { name: template.name, languageCode: template.language, parameters: [] } : null)
      }
    }
  }
  const setParameter = (index: number, value: string) => {
    const next = [...values]
    next[index] = value
    setValues(next)
    if (selected && !unsupported && indices.every((number) => (number - 1 === index ? value : next[number - 1])?.trim())) {
      onChange({ name: selected.name, languageCode: selected.language, parameters: next.map((part) => part?.trim() || '') })
    } else onChange(null)
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
      {unsupported && <p className="template-error">This template has a media header and cannot be sent from this picker yet.</p>}
      {indices.map((number) => <label key={number}>Variable {number}<input disabled={disabled || unsupported} value={values[number - 1] || ''} onChange={(event) => setParameter(number - 1, event.target.value)} placeholder={`Enter value for {{${number}}}`} /></label>)}
      <small>Only approved templates are shown. Meta's 24-hour messaging rules still apply.</small>
    </div>}
  </div>
}

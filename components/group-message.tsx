'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { readSpreadsheet, type Sheet } from '@/lib/spreadsheet'
import type { ApprovedTemplate } from '@/components/whatsapp-template-picker'

// "Group message": send one approved template to a list of people from an Excel or CSV file.
// 1 file → 2 check numbers → 3 template and blanks from columns → 4 review and send (a few at a time, with progress).
type Recipient = { key: number; name: string; phone: string; raw: string; values: string[]; problem: '' | 'invalid' | 'empty' | 'duplicate' }
type Fill = { kind: 'column'; column: number } | { kind: 'text'; value: string }
type Result = { status: 'waiting' | 'sending' | 'sent' | 'failed'; error?: string }

const PHONE_HEADER = /phone|mobile|whats ?app|number|tel|contact|رقم|هاتف|جوال|موبايل|الهاتف/i
const NAME_HEADER = /name|customer|اسم|الاسم/i
const CONCURRENCY = 3

function normalizePhone(value: string, country: string) {
  let digits = value.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else {
    digits = digits.replace(/^0+/, '')
    // A local number gets the country code (Oman local numbers have exactly 8 digits).
    if (digits.length <= 9 && !(digits.startsWith(country) && digits.length > 9)) {
      const local = digits.replace(/\D/g, '')
      if (country === '968' ? local.length !== 8 : local.length < 7) return ''
      digits = country + local
    }
  }
  digits = digits.replace(/\D/g, '')
  return /^\d{8,15}$/.test(digits) ? digits : ''
}
const formatPhone = (digits: string) => digits.startsWith('968') && digits.length === 11 ? `+968 ${digits.slice(3, 7)} ${digits.slice(7)}` : `+${digits}`
const columnLetter = (index: number) => { let label = ''; let n = index + 1; while (n > 0) { const r = (n - 1) % 26; label = String.fromCharCode(65 + r) + label; n = Math.floor((n - 1) / 26) } return label }
const baseName = (name: string) => name.replace(/_(en|ar)(_[a-z]{2})?$/i, '')
const friendly = (name: string) => { const words = baseName(name).replace(/_/g, ' ').trim(); return words.charAt(0).toUpperCase() + words.slice(1) }
const langLabel = (code: string) => code.toLowerCase().startsWith('ar') ? 'AR' : code.toLowerCase().startsWith('en') ? 'EN' : code.toUpperCase()

// What a template needs from each row, or why it can't be used for a group message.
function describe(template: ApprovedTemplate) {
  const body = template.components.find((part) => part.type === 'BODY')?.text || ''
  const header = template.components.find((part) => part.type === 'HEADER')
  const buttons = (template.components.find((part) => part.type === 'BUTTONS')?.buttons ?? []) as Array<{ type?: string; text?: string; url?: string }>
  const named = /\{\{\s*[a-z_][\w]*\s*\}\}/i.test(body)
  const numbers = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]))
  const count = numbers.length ? Math.max(...numbers) : 0
  const urlIndex = buttons.findIndex((button) => button.type === 'URL' && /\{\{\s*1\s*\}\}/.test(button.url || ''))
  let unsupported = ''
  if (named) unsupported = 'uses named blanks'
  else if (header?.format && header.format !== 'TEXT') unsupported = `has a ${header.format.toLowerCase()} header`
  else if (header?.format === 'TEXT' && /\{\{/.test(header.text || '')) unsupported = 'has a blank in its title'
  else if (urlIndex > 0) unsupported = 'its link button is not the first button'
  return { body, header: header?.format === 'TEXT' ? header.text || '' : '', footer: template.components.find((part) => part.type === 'FOOTER')?.text || '', buttons: buttons.map((b) => b.text || '').filter(Boolean), count, needsButton: urlIndex === 0, unsupported }
}

export function GroupMessage({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [phoneColumn, setPhoneColumn] = useState(0)
  const [nameColumn, setNameColumn] = useState(-1)
  const [country, setCountry] = useState('968')
  const [fileError, setFileError] = useState('')
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const [templates, setTemplates] = useState<ApprovedTemplate[] | null>(null)
  const [templateError, setTemplateError] = useState('')
  const [templateKey, setTemplateKey] = useState('')
  const [templateSearch, setTemplateSearch] = useState('')
  const [fills, setFills] = useState<Fill[]>([])
  const [buttonFill, setButtonFill] = useState<Fill>({ kind: 'text', value: '' })
  const [previewIndex, setPreviewIndex] = useState(0)
  const [tagOn, setTagOn] = useState(true)
  const [tagName, setTagName] = useState('')
  const [results, setResults] = useState<Record<number, Result>>({})
  const [sending, setSending] = useState(false)
  const [paused, setPaused] = useState(false)
  const [sendError, setSendError] = useState('')
  const pausedRef = useRef(false)
  const stopRef = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => { stopRef.current = true }, [])

  const sheet = sheets[sheetIndex]
  const headerRow = useMemo(() => hasHeader ? sheet?.rows[0] ?? [] : [], [sheet, hasHeader])
  const dataRows = useMemo(() => (sheet?.rows ?? []).slice(hasHeader ? 1 : 0).filter((row) => row.some((cell) => cell)), [sheet, hasHeader])
  const columnCount = useMemo(() => Math.max(0, ...((sheet?.rows ?? []).map((row) => row.length))), [sheet])
  const columnName = (index: number) => headerRow[index]?.trim() || `Column ${columnLetter(index)}`

  // Pick the phone and name columns: by header first, otherwise the column that looks most like phone numbers.
  const detectColumns = (target: Sheet, header: boolean) => {
    const head = header ? target.rows[0] ?? [] : []
    const body = target.rows.slice(header ? 1 : 0, 60)
    const width = Math.max(0, ...target.rows.map((row) => row.length))
    let phone = head.findIndex((cell) => PHONE_HEADER.test(cell || ''))
    if (phone < 0) {
      let best = -1, bestScore = 0
      for (let column = 0; column < width; column++) {
        const score = body.filter((row) => /^[+\d\s()-]{8,20}$/.test(row[column] || '') && (row[column] || '').replace(/\D/g, '').length >= 8).length
        if (score > bestScore) { best = column; bestScore = score }
      }
      phone = best
    }
    const name = head.findIndex((cell, index) => index !== phone && NAME_HEADER.test(cell || ''))
    setPhoneColumn(Math.max(0, phone)); setNameColumn(name)
  }

  const openFile = async (file: File) => {
    setFileError(''); setRemoved(new Set())
    try {
      const read = await readSpreadsheet(file)
      const index = Math.max(0, read.findIndex((s) => s.rows.length > 1))
      const header = !(read[index]?.rows[0] ?? []).some((cell) => /^\+?\d[\d\s-]{7,}$/.test(cell || ''))
      setSheets(read); setSheetIndex(index); setHasHeader(header); setFileName(file.name)
      setTagName(file.name.replace(/\.[^.]+$/, '').slice(0, 40))
      detectColumns(read[index], header)
    } catch (error) {
      setSheets([]); setFileName(''); setFileError(error instanceof Error ? error.message : 'This file could not be read.')
    }
  }

  const recipients = useMemo<Recipient[]>(() => {
    const seen = new Set<string>()
    return dataRows.map((row, key) => {
      const raw = row[phoneColumn] ?? ''
      const phone = raw ? normalizePhone(raw, country) : ''
      const problem: Recipient['problem'] = !raw ? 'empty' : !phone ? 'invalid' : seen.has(phone) ? 'duplicate' : ''
      if (phone) seen.add(phone)
      return { key, name: nameColumn >= 0 ? row[nameColumn] ?? '' : '', phone, raw, values: row, problem }
    })
  }, [dataRows, phoneColumn, nameColumn, country])
  const ready = recipients.filter((r) => !r.problem && !removed.has(r.key))
  const counts = { ready: ready.length, duplicate: recipients.filter((r) => r.problem === 'duplicate').length, invalid: recipients.filter((r) => r.problem === 'invalid' || r.problem === 'empty').length, removed: recipients.filter((r) => !r.problem && removed.has(r.key)).length }

  // Templates
  useEffect(() => {
    if (step !== 3 || templates) return
    fetch('/api/whatsapp-templates', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Templates could not be loaded.')
      setTemplates(payload.templates ?? [])
    }).catch((error) => setTemplateError(error instanceof Error ? error.message : 'Templates could not be loaded.'))
  }, [step, templates])
  const template = templates?.find((t) => `${t.name}|${t.language}` === templateKey)
  const info = template ? describe(template) : null
  const chooseTemplate = (next: ApprovedTemplate) => {
    setTemplateKey(`${next.name}|${next.language}`)
    const details = describe(next)
    // Blank 1 right after a greeting (or any blank 1 when there is a name column) is filled with the name.
    setFills(Array.from({ length: details.count }, (_, index) => index === 0 && nameColumn >= 0 ? { kind: 'column', column: nameColumn } : { kind: 'text', value: '' }))
    setButtonFill({ kind: 'text', value: '' })
  }
  const valueOf = (fill: Fill, recipient: Recipient) => fill.kind === 'column' ? (recipient.values[fill.column] ?? '').trim() : fill.value.trim()
  const missingFor = (recipient: Recipient) => {
    const missing = fills.map((fill, index) => valueOf(fill, recipient) ? 0 : index + 1).filter(Boolean)
    if (info?.needsButton && !valueOf(buttonFill, recipient)) missing.push(-1)
    return missing
  }
  const sendable = ready.filter((r) => !missingFor(r).length)
  const skippedForBlanks = ready.length - sendable.length
  const preview = ready[Math.min(previewIndex, Math.max(0, ready.length - 1))]
  const fillBody = (text: string, recipient?: Recipient) => text.split(/(\{\{\s*\d+\s*\}\})/g).map((part, index) => {
    const match = /\{\{\s*(\d+)\s*\}\}/.exec(part)
    if (!match) return <span key={index}>{part}</span>
    const fill = fills[Number(match[1]) - 1]
    const value = fill && recipient ? valueOf(fill, recipient) : ''
    return <mark key={index} className={value ? '' : 'empty'}>{value || `{{${match[1]}}}`}</mark>
  })

  // Sending
  const send = async () => {
    if (!template || !info) return
    setSending(true); setSendError(''); stopRef.current = false
    let tagId = ''
    if (tagOn && tagName.trim()) {
      try {
        const created = await fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tagName.trim(), color: 'blue' }) })
        const payload = await created.json().catch(() => ({}))
        if (created.ok) tagId = payload.tag?.id
        else if (created.status === 409) {
          const list = await fetch('/api/tags', { cache: 'no-store' }).then((response) => response.json()).catch(() => ({}))
          tagId = (list.tags ?? []).find((tag: { id: string; name: string }) => tag.name.trim().toLowerCase() === tagName.trim().toLowerCase())?.id || ''
        }
      } catch {}
    }
    const queue = [...sendable]
    setResults(Object.fromEntries(queue.map((r) => [r.key, { status: 'waiting' } as Result])))
    const worker = async () => {
      while (queue.length && !stopRef.current) {
        while (pausedRef.current && !stopRef.current) await new Promise((resolve) => setTimeout(resolve, 300))
        const recipient = queue.shift()
        if (!recipient) break
        setResults((current) => ({ ...current, [recipient.key]: { status: 'sending' } }))
        try {
          const response = await fetch('/api/group-message', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: recipient.phone, name: recipient.name, tagId: tagId || undefined,
              template: { name: template.name, languageCode: template.language, parameters: fills.map((fill) => valueOf(fill, recipient)), ...(info.needsButton ? { buttonUrlSuffix: valueOf(buttonFill, recipient) } : {}) },
            }),
          })
          const payload = await response.json().catch(() => ({}))
          setResults((current) => ({ ...current, [recipient.key]: response.ok ? { status: 'sent' } : { status: 'failed', error: payload.error || `Error ${response.status}` } }))
          if (response.status === 401) { stopRef.current = true; setSendError('You were signed out. Sign in again and resend the rest.') }
        } catch {
          setResults((current) => ({ ...current, [recipient.key]: { status: 'failed', error: 'No connection' } }))
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setSending(false)
    onSent()
  }
  const togglePause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current) }
  const resultList = Object.entries(results)
  const doneCount = resultList.filter(([, r]) => r.status === 'sent' || r.status === 'failed').length
  const sentCount = resultList.filter(([, r]) => r.status === 'sent').length
  const failedCount = resultList.filter(([, r]) => r.status === 'failed').length
  const started = resultList.length > 0
  const finished = started && !sending
  const downloadReport = () => {
    const lines = [['Name', 'Phone', 'Result', 'Reason']]
    for (const r of recipients) {
      const result = results[r.key]
      const outcome = result ? (result.status === 'sent' ? 'Sent' : result.status === 'failed' ? 'Failed' : 'Not sent') : r.problem ? 'Skipped' : removed.has(r.key) ? 'Removed' : missingFor(r).length ? 'Skipped' : 'Not sent'
      const reason = result?.error || (r.problem === 'duplicate' ? 'Duplicate number' : r.problem === 'invalid' ? 'Invalid number' : r.problem === 'empty' ? 'No number' : missingFor(r).length && !result ? 'Empty value for a blank' : '')
      lines.push([r.name, r.phone ? '+' + r.phone : r.raw, outcome, reason])
    }
    const csv = '﻿' + lines.map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = `group-message-report-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 2000)
  }
  const close = () => { if (sending && !window.confirm('Stop sending? Messages already sent stay sent.')) return; stopRef.current = true; onClose() }

  const filteredTemplates = (templates ?? []).filter((t) => !templateSearch.trim() || (friendly(t.name) + ' ' + (describe(t).body)).toLowerCase().includes(templateSearch.trim().toLowerCase()))
  const titles = ['Group message', `${recipients.length} rows found`, 'Choose template', finished ? 'Done' : started ? 'Sending…' : 'Review & send']

  return <div className="group-msg-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) close() }}>
    <section className="group-msg" role="dialog" aria-modal="true" aria-label="Group message">
      <header className="group-msg-top"><b>{titles[step - 1]}</b><button type="button" className="group-msg-x" aria-label="Close" onClick={close}>✕</button></header>
      <div className="group-msg-steps" aria-hidden="true">{[1, 2, 3, 4].map((n) => <i key={n} className={n <= step ? 'on' : ''} />)}</div>
      <div className="group-msg-body">
        {step === 1 && <>
          <button type="button" className="group-msg-drop" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void openFile(file) }}>
            <span className="group-msg-xls">XLS</span><b>Choose an Excel or CSV file</b><span className="group-msg-muted">.xlsx · .csv — one row per person</span>
          </button>
          <input ref={fileInput} type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = '' }} />
          {fileError && <p className="group-msg-error">{fileError}</p>}
          {sheet && <>
            <div className="group-msg-file"><span className="group-msg-xls small">{/\.csv$/i.test(fileName) ? 'CSV' : 'XLSX'}</span><div><b>{fileName}</b><span className="group-msg-muted">{sheet.name} · {dataRows.length} rows</span></div><span className="group-msg-ok">✓</span></div>
            {sheets.length > 1 && <label className="group-msg-field">Sheet<select value={sheetIndex} onChange={(event) => { const index = Number(event.target.value); setSheetIndex(index); detectColumns(sheets[index], hasHeader); setRemoved(new Set()) }}>{sheets.map((s, index) => <option key={index} value={index}>{s.name} ({s.rows.length} rows)</option>)}</select></label>}
            <label className="group-msg-field">Which column has the phone numbers?<select value={phoneColumn} onChange={(event) => { setPhoneColumn(Number(event.target.value)); setRemoved(new Set()) }}>{Array.from({ length: columnCount }, (_, index) => <option key={index} value={index}>{columnName(index)}</option>)}</select></label>
            <label className="group-msg-field">Name column (optional)<select value={nameColumn} onChange={(event) => setNameColumn(Number(event.target.value))}><option value={-1}>No names</option>{Array.from({ length: columnCount }, (_, index) => <option key={index} value={index}>{columnName(index)}</option>)}</select></label>
            <label className="group-msg-field">Numbers without a country code get<div className="group-msg-prefix">+<input inputMode="numeric" value={country} onChange={(event) => setCountry(event.target.value.replace(/\D/g, '').slice(0, 4) || '968')} /></div></label>
            <label className="group-msg-toggle">First row is the header<input type="checkbox" checked={hasHeader} onChange={(event) => { setHasHeader(event.target.checked); detectColumns(sheet, event.target.checked); setRemoved(new Set()) }} /></label>
          </>}
        </>}

        {step === 2 && <>
          <div className="group-msg-chips"><span className="c1">✓ {counts.ready} ready</span>{counts.duplicate > 0 && <span className="c3">{counts.duplicate} duplicates</span>}{counts.invalid > 0 && <span className="c2">{counts.invalid} invalid</span>}{counts.removed > 0 && <span className="c4">{counts.removed} removed</span>}</div>
          <p className="group-msg-muted">Tap a row to leave it out or put it back. Duplicates and invalid numbers are skipped.</p>
          <div className="group-msg-table">{recipients.slice(0, 500).map((r) => <button type="button" key={r.key} disabled={!!r.problem} className={removed.has(r.key) ? 'removed' : ''} onClick={() => setRemoved((current) => { const next = new Set(current); if (next.has(r.key)) next.delete(r.key); else next.add(r.key); return next })}>
            <span dir="auto">{r.name || '—'}</span><span>{r.phone ? formatPhone(r.phone) : r.raw || '(empty)'}</span>
            <em className={r.problem ? (r.problem === 'duplicate' ? 'dup' : 'bad') : removed.has(r.key) ? 'off' : 'ok'}>{r.problem === 'duplicate' ? 'duplicate' : r.problem === 'invalid' ? 'invalid' : r.problem === 'empty' ? 'no number' : removed.has(r.key) ? 'left out' : '✓'}</em>
          </button>)}</div>
          {recipients.length > 500 && <p className="group-msg-muted">Showing the first 500 of {recipients.length} rows.</p>}
        </>}

        {step === 3 && <>
          {!template && <>
            <input className="group-msg-search" placeholder="Search templates" value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
            {templateError && <p className="group-msg-error">{templateError}</p>}
            {!templates && !templateError && <p className="group-msg-muted">Loading templates…</p>}
            <div className="group-msg-templates">{filteredTemplates.map((t) => { const d = describe(t); return <button type="button" key={`${t.name}|${t.language}`} disabled={!!d.unsupported} onClick={() => chooseTemplate(t)}>
              <b>{friendly(t.name)} <small>{langLabel(t.language)}</small></b><span>{d.unsupported ? `Can't be sent to a group: ${d.unsupported}` : d.body.slice(0, 110)}</span><em>{t.category === 'MARKETING' ? 'Marketing' : t.category === 'UTILITY' ? 'Utility' : t.category.toLowerCase()}</em>
            </button> })}</div>
          </>}
          {template && info && <>
            <div className="group-msg-tpl"><div><b>{friendly(template.name)}</b><span className="group-msg-muted">{template.category === 'MARKETING' ? 'Marketing' : 'Utility'} · {langLabel(template.language)}</span></div><button type="button" onClick={() => setTemplateKey('')}>Change</button></div>
            {(info.count > 0 || info.needsButton) && <p className="group-msg-label">Fill the blanks</p>}
            {fills.map((fill, index) => <FillRow key={index} label={`{{${index + 1}}}`} fill={fill} columns={columnCount} columnName={columnName} onChange={(next) => setFills((current) => current.map((f, i) => i === index ? next : f))} />)}
            {info.needsButton && <FillRow label="Link" fill={buttonFill} columns={columnCount} columnName={columnName} onChange={setButtonFill} />}
            {preview && <>
              <p className="group-msg-label">Preview: {preview.name || formatPhone(preview.phone)}</p>
              <div className="group-msg-wa"><div className="group-msg-bubble" dir="auto">{info.header && <b className="head">{info.header}</b>}<div>{fillBody(info.body, preview)}</div>{info.footer && <small>{info.footer}</small>}{info.buttons.map((b) => <span className="btn" key={b}>{b}</span>)}</div></div>
              <div className="group-msg-pager"><button type="button" disabled={previewIndex <= 0} onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}>‹</button><span>{Math.min(previewIndex + 1, ready.length)} of {ready.length}</span><button type="button" disabled={previewIndex >= ready.length - 1} onClick={() => setPreviewIndex((i) => Math.min(ready.length - 1, i + 1))}>›</button></div>
            </>}
            {skippedForBlanks > 0 && <p className="group-msg-warn">{skippedForBlanks} {skippedForBlanks === 1 ? 'person has' : 'people have'} an empty cell for a blank and will be skipped. Use “Same for everyone” to fill it instead.</p>}
          </>}
        </>}

        {step === 4 && template && <>
          <div className="group-msg-sum"><div><span className="group-msg-muted">Recipients</span><b>{sendable.length}</b></div><div><span className="group-msg-muted">Template</span><b className="small">{friendly(template.name)} · {langLabel(template.language)}</b></div></div>
          {!started && <>
            <label className="group-msg-toggle">Tag these chats<input type="checkbox" checked={tagOn} onChange={(event) => setTagOn(event.target.checked)} /></label>
            {tagOn && <input className="group-msg-search" value={tagName} maxLength={40} onChange={(event) => setTagName(event.target.value)} placeholder="Tag name" />}
            <p className="group-msg-warn">Only send to people who agreed to receive WhatsApp messages from Myticket. {template.category === 'MARKETING' ? 'Marketing templates are charged per message by Meta.' : ''} Keep this screen open while sending.</p>
          </>}
          {started && <>
            <div className="group-msg-prog"><i style={{ width: `${sendable.length ? Math.round(doneCount / sendable.length * 100) : 0}%` }} /></div>
            <p className="group-msg-muted">{doneCount} of {sendable.length} done · {sentCount} sent{failedCount ? ` · ${failedCount} failed` : ''}{paused ? ' · paused' : ''}</p>
            {sendError && <p className="group-msg-error">{sendError}</p>}
            <div className="group-msg-results">{sendable.map((r) => { const result = results[r.key]; return <div key={r.key}><span dir="auto">{r.name || formatPhone(r.phone)}</span><em className={result?.status === 'sent' ? 'ok' : result?.status === 'failed' ? 'bad' : ''} title={result?.error}>{result?.status === 'sent' ? 'Sent' : result?.status === 'failed' ? (result.error || 'Failed').slice(0, 60) : result?.status === 'sending' ? 'Sending…' : 'Waiting'}</em></div> })}</div>
          </>}
        </>}
      </div>
      <footer className="group-msg-foot">
        {step > 1 && !started && <button type="button" className="sec" onClick={() => setStep(step - 1)}>Back</button>}
        {step === 1 && <button type="button" className="pri" disabled={!sheet || !recipients.length} onClick={() => setStep(2)}>Next: check numbers</button>}
        {step === 2 && <button type="button" className="pri" disabled={!ready.length} onClick={() => setStep(3)}>Next: template</button>}
        {step === 3 && <button type="button" className="pri" disabled={!template || !sendable.length} onClick={() => setStep(4)}>Next: review</button>}
        {step === 4 && !started && <button type="button" className="pri" disabled={!sendable.length} onClick={() => void send()}>Send to {sendable.length}</button>}
        {step === 4 && started && !finished && <button type="button" className="sec wide" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>}
        {step === 4 && finished && <><button type="button" className="sec wide" onClick={downloadReport}>Download report</button><button type="button" className="pri" onClick={onClose}>Done</button></>}
      </footer>
    </section>
  </div>
}

function FillRow({ label, fill, columns, columnName, onChange }: { label: string; fill: Fill; columns: number; columnName: (index: number) => string; onChange: (fill: Fill) => void }) {
  // Each blank comes either from a column of the file or from text typed here (the same for everyone).
  const [lastColumn, setLastColumn] = useState(fill.kind === 'column' ? fill.column : 0)
  const [lastText, setLastText] = useState(fill.kind === 'text' ? fill.value : '')
  return <div className="group-msg-map">
    <span className="v">{label}</span>
    <div className="group-msg-seg" role="radiogroup" aria-label={`${label} value`}>
      <button type="button" role="radio" aria-checked={fill.kind === 'column'} className={fill.kind === 'column' ? 'on' : ''} disabled={!columns} onClick={() => onChange({ kind: 'column', column: Math.min(lastColumn, Math.max(0, columns - 1)) })}>From file</button>
      <button type="button" role="radio" aria-checked={fill.kind === 'text'} className={fill.kind === 'text' ? 'on' : ''} onClick={() => onChange({ kind: 'text', value: lastText })}>Type text</button>
    </div>
    {fill.kind === 'column'
      ? <select value={fill.column} onChange={(event) => { setLastColumn(Number(event.target.value)); onChange({ kind: 'column', column: Number(event.target.value) }) }}>{Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{columnName(index)}</option>)}</select>
      : <input dir="auto" value={fill.value} placeholder="Text for everyone" autoFocus onChange={(event) => { setLastText(event.target.value); onChange({ kind: 'text', value: event.target.value }) }} />}
  </div>
}

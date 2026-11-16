'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'

type TagItem = { id: string; name: string; color?: string }
type Assignment = { conversation_id: string; tag_id: string }

// Contact details → Tags: only this chat's tags (tap × to remove) and "+ Add tag", which opens a searchable list.
export function ConversationTags({ conversationId, agentId }: { conversationId: string; agentId?: string }) {
  const [tags, setTags] = useState<TagItem[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    const response = await fetch(`/api/tags?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Tags are unavailable.')
    setTags(payload.tags ?? []); setAssignments(payload.assignments ?? [])
  }
  useEffect(() => { setOpen(false); setQuery(''); setError(''); void load().catch((reason) => setError(reason.message)) }, [conversationId])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  const assignedIds = new Set(assignments.filter((item) => item.conversation_id === conversationId || !item.conversation_id).map((item) => item.tag_id))
  const assigned = tags.filter((tag) => assignedIds.has(tag.id))
  const available = useMemo(() => tags.filter((tag) => !assignedIds.has(tag.id) && tag.name.toLowerCase().includes(query.trim().toLowerCase())), [tags, assignments, query])

  const change = async (tag: TagItem, add: boolean) => {
    setBusy(tag.id); setError('')
    try {
      const response = await fetch('/api/tags', { method: add ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, tagId: tag.id, agentId }) })
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'The tag could not be changed.') }
      setAssignments((current) => add ? [...current, { conversation_id: conversationId, tag_id: tag.id }] : current.filter((item) => item.tag_id !== tag.id))
      if (add) { setOpen(false); setQuery('') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The tag could not be changed.') } finally { setBusy('') }
  }

  return <div className="ctags" ref={wrapRef}>
    <div className="ctags-chips">
      {assigned.map((tag) => <span key={tag.id} className={`ctag ctag-${tag.color || 'gray'}`}><i aria-hidden="true" /><span dir="auto">{tag.name}</span><button type="button" aria-label={`Remove ${tag.name}`} disabled={busy === tag.id} onClick={() => void change(tag, false)}><X size={12} strokeWidth={2.6} /></button></span>)}
      <button type="button" className="ctags-add" aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={14} strokeWidth={2.4} />Add tag</button>
    </div>
    {open && <div className="ctags-menu" role="listbox" aria-label="Add a tag">
      <label className="ctags-search"><Search size={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tags…" /></label>
      <div className="ctags-options">{available.length === 0 ? <p className="ctags-empty">{tags.length === assigned.length ? 'All tags are already added.' : 'No tags found.'}</p> : available.map((tag) => <button type="button" role="option" aria-selected="false" key={tag.id} disabled={busy === tag.id} onClick={() => void change(tag, true)}><i className={`ctag-dot ctag-${tag.color || 'gray'}`} aria-hidden="true" /><span dir="auto">{tag.name}</span></button>)}</div>
    </div>}
    {error && <p className="ctags-error">{error}</p>}
  </div>
}

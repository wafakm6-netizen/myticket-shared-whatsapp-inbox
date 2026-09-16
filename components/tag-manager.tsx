'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Tag, X } from 'lucide-react'

type TagItem = { id: string; name: string }
type Assignment = { conversation_id: string; tag_id: string }

export function TagManager({ conversationId, agentId, compact = false, onChanged }: { conversationId?: string; agentId?: string; compact?: boolean; onChanged?: () => void }) {
  const [tags, setTags] = useState<TagItem[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<TagItem | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    const response = await fetch(`/api/tags${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''}`, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Tags unavailable')
    setTags(payload.tags ?? []); setAssignments(payload.assignments ?? [])
  }
  useEffect(() => { void load().catch((e) => setError(e.message)) }, [conversationId])
  const assigned = new Set(assignments.map((item) => item.tag_id))
  const visible = useMemo(() => tags.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [tags, query])

  const save = async () => {
    if (!name.trim()) return
    const response = await fetch('/api/tags', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing ? { id: editing.id, name } : { name, agentId }) })
    const payload = await response.json(); if (!response.ok) { setError(payload.error || 'Could not save tag'); return }
    setName(''); setEditing(null); setError(''); await load(); onChanged?.()
  }
  const removeTag = async (id: string) => { if (!confirm('Delete this tag? It will be removed from every conversation.')) return; await fetch('/api/tags', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); await load(); onChanged?.() }
  const toggle = async (tagId: string) => {
    if (!conversationId) return
    const isAssigned = assigned.has(tagId)
    await fetch('/api/tags', { method: isAssigned ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, tagId, agentId }) })
    await load(); onChanged?.()
  }

  return <div className={`tag-manager ${compact ? 'tag-manager-compact' : ''}`}>
    {!compact && <><div className="tag-manager-title"><div><h2>Tags</h2><p>Organize conversations using reusable labels.</p></div></div><div className="tag-create-row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={editing ? 'Edit tag name' : 'New tag name'} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} /><button className="primary-small" onClick={() => void save()}>{editing ? 'Update' : '+ New tag'}</button>{editing && <button className="secondary-small" onClick={() => { setEditing(null); setName('') }}>Cancel</button>}</div></>}
    <div className="tag-search"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tags..." /></div>
    {error && <p className="form-error">{error}</p>}
    <div className="tag-list">{visible.length === 0 ? <p className="muted-copy">No tags found.</p> : visible.map((item) => <div className="tag-row" key={item.id}>
      <button className={`tag-pill ${assigned.has(item.id) ? 'tag-pill-active' : ''}`} onClick={() => conversationId ? void toggle(item.id) : undefined}><Tag size={13}/>{item.name}{conversationId && assigned.has(item.id) && <X size={12}/>}</button>
      {!compact && <div className="tag-row-actions"><button onClick={() => { setEditing(item); setName(item.name) }}>Edit</button><button className="danger-text" onClick={() => void removeTag(item.id)}>Delete</button></div>}
    </div>)}</div>
  </div>
}

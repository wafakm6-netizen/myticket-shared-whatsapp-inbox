'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Tag } from 'lucide-react'

type TagItem = { id: string; name: string }
type Assignment = { conversation_id: string; tag_id: string }

export function ConversationTagFilter({ onFilter }: { onFilter: (conversationIds: string[] | null) => void }) {
  const [tags, setTags] = useState<TagItem[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => { void fetch('/api/tags', { cache: 'no-store' }).then(r => r.json()).then(p => { setTags(p.tags ?? []); setAssignments(p.assignments ?? []) }) }, [])
  useEffect(() => {
    if (!selected.length) { onFilter(null); return }
    const ids = [...new Set(assignments.filter(a => selected.includes(a.tag_id)).map(a => a.conversation_id))]
    onFilter(ids)
  }, [selected, assignments, onFilter])
  const visible = useMemo(() => tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase())), [tags, query])
  return <div style={{ padding: '10px 18px', borderBottom: '1px solid #ececec', background: '#fff' }}>
    <div style={{ display:'flex', alignItems:'center', gap:7, border:'1px solid #ececec', borderRadius:7, padding:'0 8px', height:32 }}><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search/filter tags" style={{border:0,outline:0,width:'100%',fontSize:11}}/></div>
    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:7}}>{visible.map(tag => <button key={tag.id} onClick={()=>setSelected(s=>s.includes(tag.id)?s.filter(id=>id!==tag.id):[...s,tag.id])} style={{display:'inline-flex',alignItems:'center',gap:4,border:'1px solid #ffd6c7',borderRadius:999,padding:'4px 7px',fontSize:9,background:selected.includes(tag.id)?'#ff5a1f':'#fff7f3',color:selected.includes(tag.id)?'#fff':'#b54820'}}><Tag size={11}/>{tag.name}</button>)}</div>
  </div>
}

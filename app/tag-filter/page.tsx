'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ConversationTagFilter } from '@/components/conversation-tag-filter'

export default function TagFilterPage() {
  const [ids, setIds] = useState<string[] | null>(null)
  const onFilter = useCallback((next: string[] | null) => setIds(next), [])
  return <main style={{minHeight:'100vh',background:'#fafafa',padding:32}}><section style={{maxWidth:760,margin:'0 auto',background:'#fff',border:'1px solid #ececec',borderRadius:14,padding:24}}>
    <Link href="/" style={{display:'inline-flex',alignItems:'center',gap:6,color:'#ff5a1f',fontSize:12,textDecoration:'none',marginBottom:18}}><ArrowLeft size={15}/> Back to inbox</Link>
    <h2 style={{margin:'0 0 5px'}}>Filter by tags</h2><p style={{color:'#8d99a6',fontSize:12}}>Select one or more tags to find matching conversations.</p>
    <ConversationTagFilter onFilter={onFilter}/>
    <div style={{marginTop:18,fontSize:12,color:'#555'}}>{ids === null ? 'Select a tag to filter conversations.' : `${ids.length} matching conversation${ids.length === 1 ? '' : 's'}.`}</div>
    {ids?.map(id => <Link key={id} href={`/?conversation=${encodeURIComponent(id)}`} style={{display:'block',padding:'9px 0',color:'#ff5a1f',fontSize:12}}>Open conversation {id.slice(0,8)}…</Link>)}
  </section></main>
}

'use client'

import Link from 'next/link'
import { ArrowLeft, Filter, Tag } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

export default function TagsPage() {
  return <main style={{ minHeight:'100vh', background:'#fafafa', padding:32 }}>
    <section style={{ maxWidth:820, margin:'0 auto', background:'#fff', border:'1px solid #ececec', borderRadius:16, padding:26, boxShadow:'0 12px 35px rgba(36,36,36,.06)' }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:22}}>
        <Link href="/" style={{display:'inline-flex',alignItems:'center',gap:6,color:'#ff5a1f',fontSize:12,textDecoration:'none'}}><ArrowLeft size={15}/> Back to inbox</Link>
        <Link href="/tag-filter" style={{display:'inline-flex',alignItems:'center',gap:6,color:'#b54820',fontSize:12,textDecoration:'none',border:'1px solid #ffd6c7',background:'#fff7f3',borderRadius:8,padding:'8px 10px'}}><Filter size={14}/> Filter conversations</Link>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}><div style={{width:38,height:38,borderRadius:10,display:'grid',placeItems:'center',background:'#fff2ed',color:'#ff5a1f'}}><Tag size={19}/></div><div><h1 style={{fontSize:22,margin:0}}>Tags</h1><p style={{fontSize:12,color:'#8d99a6',margin:'3px 0 0'}}>Create, edit and delete reusable conversation labels.</p></div></div>
      <TagManager />
    </section>
  </main>
}

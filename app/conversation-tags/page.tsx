'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

function ConversationTagsContent() {
  const params = useSearchParams()
  const conversationId = params.get('conversationId') || ''
  return <section style={{ maxWidth: 680, margin: '0 auto', background: '#fff', border: '1px solid #ececec', borderRadius: 16, padding: 26, boxShadow: '0 12px 35px rgba(36,36,36,.06)' }}>
    <Link href="/" style={{ display:'inline-flex',alignItems:'center',gap:6,color:'#ff5a1f',fontSize:12,textDecoration:'none',marginBottom:20 }}><ArrowLeft size={15}/> Back to inbox</Link>
    <h2 style={{margin:'0 0 5px'}}>Conversation tags</h2>
    <p style={{color:'#8d99a6',fontSize:12,margin:'0 0 18px'}}>Assign or remove multiple tags from this conversation.</p>
    {conversationId ? <TagManager conversationId={conversationId} compact /> : <p style={{fontSize:13,color:'#8d99a6'}}>Open this page from a conversation to assign tags.</p>}
  </section>
}

export default function ConversationTagsPage() {
  return <main style={{minHeight:'100vh',background:'#fafafa',padding:32}}><Suspense fallback={<div>Loading tags…</div>}><ConversationTagsContent /></Suspense></main>
}

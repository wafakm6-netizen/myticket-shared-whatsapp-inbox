'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

export default function ConversationTagsPage() {
  const params = useSearchParams()
  const conversationId = params.get('conversationId') || ''
  return <main style={{ minHeight: '100vh', background: '#fafafa', padding: 32 }}>
    <section style={{ maxWidth: 620, margin: '0 auto', background: '#fff', border: '1px solid #ececec', borderRadius: 14, padding: 24 }}>
      <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ff5a1f', fontSize: 12, textDecoration: 'none', marginBottom: 20 }}><ArrowLeft size={15}/> Back to conversation</Link>
      <h2 style={{ margin: '0 0 5px' }}>Conversation tags</h2><p style={{ color: '#8d99a6', fontSize: 12, margin: '0 0 18px' }}>Assign or remove multiple tags from this conversation.</p>
      {conversationId ? <TagManager conversationId={conversationId} compact /> : <p>Conversation not specified.</p>}
    </section>
  </main>
}

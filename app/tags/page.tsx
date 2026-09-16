'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

export default function TagsPage() {
  return <main style={{ minHeight: '100vh', background: '#fafafa', padding: 32 }}>
    <section style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #ececec', borderRadius: 14, padding: 24 }}>
      <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ff5a1f', fontSize: 12, textDecoration: 'none', marginBottom: 22 }}><ArrowLeft size={15}/> Back to inbox</Link>
      <TagManager />
    </section>
  </main>
}

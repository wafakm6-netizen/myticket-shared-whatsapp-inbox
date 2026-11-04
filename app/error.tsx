'use client'

import { useEffect } from 'react'

// Shown instead of a blank page when the inbox crashes, with the error text so it can be reported.
export default function InboxError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[inbox] crashed', error) }, [error])
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#f2f4f7', fontFamily: 'inherit' }}>
      <section style={{ width: '100%', maxWidth: 440, padding: 24, borderRadius: 20, background: '#fff', boxShadow: '0 12px 36px rgba(15,23,42,.12)', textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 19, color: '#16243a' }}>Something went wrong</h1>
        <p style={{ margin: '0 0 14px', fontSize: 15, color: '#7a8799' }}>The inbox hit an error while loading. Please send a screenshot of this message to support.</p>
        <pre style={{ margin: '0 0 18px', padding: 12, borderRadius: 12, background: '#f2f4f7', color: '#b42318', fontSize: 12.5, textAlign: 'start', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error.message || 'Unknown error'}{error.digest ? `\n(${error.digest})` : ''}{error.stack ? `\n\n${error.stack.split('\n').slice(0, 4).join('\n')}` : ''}</pre>
        <button type="button" onClick={() => { reset(); window.location.reload() }} style={{ height: 44, padding: '0 22px', border: 0, borderRadius: 999, background: '#ff5a1f', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Reload</button>
      </section>
    </main>
  )
}

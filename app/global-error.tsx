'use client'

// Last-resort screen when even the page layout fails, so the site never shows a blank white page.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f2f4f7', fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ maxWidth: 440, margin: 24, padding: 24, borderRadius: 20, background: '#fff', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 19, color: '#16243a' }}>Something went wrong</h1>
          <pre style={{ margin: '0 0 18px', padding: 12, borderRadius: 12, background: '#f2f4f7', color: '#b42318', fontSize: 12.5, textAlign: 'start', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error.message || 'Unknown error'}{error.digest ? `\n(${error.digest})` : ''}</pre>
          <button type="button" onClick={() => window.location.reload()} style={{ height: 44, padding: '0 22px', border: 0, borderRadius: 999, background: '#ff5a1f', color: '#fff', fontSize: 16, fontWeight: 600 }}>Reload</button>
        </section>
      </body>
    </html>
  )
}

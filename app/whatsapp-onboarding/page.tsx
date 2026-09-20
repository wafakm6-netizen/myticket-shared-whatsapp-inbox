'use client'

import { useEffect, useState } from 'react'

const REDIRECT_URI = 'https://whatsapp.myticketom.com/whatsapp-onboarding'

export default function WhatsAppOnboardingPage() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready to connect the existing WhatsApp Business app number.')
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const configId = process.env.NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
  const graphVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v26.0'

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const errorDescription = params.get('error_description')
    const code = params.get('code')
    if (error) {
      setStatus(`Meta signup failed: ${errorDescription || error}`)
      window.history.replaceState({}, '', '/whatsapp-onboarding')
      return
    }
    if (!code) return

    setBusy(true)
    setStatus('Meta authorization received. Verifying the WhatsApp number and saving the connection…')
    void fetch('/api/whatsapp/onboarding', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not finish WhatsApp onboarding.')
      if (!payload.wabaId || !payload.phoneNumberId) throw new Error('Meta authorization completed, but the WhatsApp account was not verified.')
      setStatus(`Connected successfully. Phone Number ID ${payload.phoneNumberId}. Opening the shared inbox…`)
      window.history.replaceState({}, '', '/whatsapp-onboarding')
      window.setTimeout(() => window.location.assign('/'), 900)
    }).catch((err) => {
      setStatus(err instanceof Error ? err.message : 'Could not finish WhatsApp onboarding.')
      window.history.replaceState({}, '', '/whatsapp-onboarding')
    }).finally(() => setBusy(false))
  }, [])

  const startSignup = () => {
    if (!appId || !configId) {
      setStatus('Embedded Signup is not configured yet. Add the Meta App ID and Configuration ID in Vercel.')
      return
    }
    setBusy(true)
    setStatus('Redirecting to Meta WhatsApp Embedded Signup…')
    const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`)
    url.searchParams.set('client_id', appId)
    url.searchParams.set('config_id', configId)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('override_default_response_type', 'true')
    url.searchParams.set('extras', JSON.stringify({ setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }))
    window.location.assign(url.toString())
  }

  const configured = Boolean(appId && configId)
  return (
    <main style={{ minHeight: '100vh', background: '#fff7f3', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: 'min(620px, 100%)', background: '#fff', border: '1px solid #f0ddd4', borderRadius: 18, padding: 32, boxShadow: '0 18px 60px rgba(68,35,20,.08)' }}>
        <img src="/brand/myticket-wordmark.png" alt="Myticket" style={{ width: 150, height: 'auto', marginBottom: 28 }} />
        <div style={{ color: '#ff5a1f', fontWeight: 700, fontSize: 13, letterSpacing: '.08em', marginBottom: 8 }}>WHATSAPP BUSINESS</div>
        <h1 style={{ fontSize: 30, margin: '0 0 12px', color: '#241a16' }}>Connect the Myticket WhatsApp number</h1>
        <p style={{ color: '#665750', lineHeight: 1.6, margin: '0 0 24px' }}>Connect the existing WhatsApp Business app number through Meta. The connection is verified and saved before the shared inbox opens.</p>
        <div style={{ background: '#fff8f4', border: '1px solid #ffd9c8', borderRadius: 12, padding: 16, marginBottom: 20, color: '#5e4438', lineHeight: 1.5 }}>{status}</div>
        {!configured && <p style={{ color: '#a13b18', fontSize: 14 }}>Vercel still needs NEXT_PUBLIC_META_APP_ID and NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID.</p>}
        <button onClick={startSignup} disabled={busy || !configured} style={{ width: '100%', border: 0, borderRadius: 12, padding: '14px 18px', background: busy || !configured ? '#f3b39b' : '#ff5a1f', color: '#fff', fontWeight: 700, fontSize: 16, cursor: busy || !configured ? 'not-allowed' : 'pointer' }}>{busy ? 'Connecting…' : 'Connect with Meta'}</button>
        <p style={{ color: '#8b7a72', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>Meta handles account authorization. The inbox opens only after the WhatsApp Business Account and phone number are verified and saved.</p>
      </section>
    </main>
  )
}

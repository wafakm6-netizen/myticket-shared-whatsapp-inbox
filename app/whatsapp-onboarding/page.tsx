'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void
      login: (callback: (response: any) => void, options: Record<string, unknown>) => void
    }
    fbAsyncInit?: () => void
  }
}

type SessionInfo = { waba_id?: string; phone_number_id?: string }

export default function WhatsAppOnboardingPage() {
  const [sdkReady, setSdkReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready to connect +968 7117 8817 to the Myticket shared inbox.')
  const sessionInfo = useRef<SessionInfo>({})
  const authCode = useRef<string | null>(null)
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const configId = process.env.NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
  const graphVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v26.0'

  const complete = async () => {
    if (!authCode.current || !sessionInfo.current.waba_id || !sessionInfo.current.phone_number_id) return
    setStatus('WhatsApp number selected. Saving the connection…')
    try {
      const response = await fetch('/api/whatsapp/onboarding', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authCode.current, ...sessionInfo.current }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not finish WhatsApp onboarding.')
      setStatus('Connected successfully. Opening the shared inbox…')
      window.setTimeout(() => window.location.assign('/'), 700)
    } catch (error) {
      setBusy(false)
      setStatus(error instanceof Error ? error.message : 'Could not finish WhatsApp onboarding.')
    }
  }

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
        if (['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(data.event)) {
          sessionInfo.current = { waba_id: data.data?.waba_id, phone_number_id: data.data?.phone_number_id }
          setStatus('Meta returned the WhatsApp Business account and phone number. Finishing connection…')
          void complete()
        } else if (data.event === 'CANCEL') {
          setBusy(false); setStatus('WhatsApp connection was cancelled.')
        } else if (data.event === 'ERROR') {
          setBusy(false); setStatus(`Meta signup error: ${data.data?.error_message || 'Unknown error'}`)
        }
      } catch { /* unrelated message */ }
    }
    window.addEventListener('message', receiveMessage)

    if (!appId) return () => window.removeEventListener('message', receiveMessage)
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion })
      setSdkReady(true)
    }
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script')
      script.id = 'facebook-jssdk'; script.async = true; script.defer = true; script.crossOrigin = 'anonymous'
      script.src = 'https://connect.facebook.net/en_US/sdk.js'
      document.body.appendChild(script)
    } else if (window.FB) window.fbAsyncInit()

    return () => window.removeEventListener('message', receiveMessage)
  }, [appId, graphVersion])

  const startSignup = () => {
    if (!window.FB || !appId || !configId) {
      setStatus('Meta Embedded Signup is not ready. Check the Meta App ID and Configuration ID.')
      return
    }
    setBusy(true); authCode.current = null; sessionInfo.current = {}
    setStatus('Opening WhatsApp Embedded Signup…')
    window.FB.login((response: any) => {
      const code = response?.authResponse?.code
      if (!code) {
        setBusy(false)
        setStatus('Meta did not return an authorization code. Please complete the WhatsApp signup flow.')
        return
      }
      authCode.current = code
      setStatus(sessionInfo.current.phone_number_id ? 'Authorization received. Saving the connection…' : 'Authorization received. Waiting for WhatsApp number selection…')
      void complete()
    }, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    })
  }

  const configured = Boolean(appId && configId)
  return (
    <main style={{ minHeight: '100vh', background: '#fff7f3', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: 'min(620px, 100%)', background: '#fff', border: '1px solid #f0ddd4', borderRadius: 18, padding: 32, boxShadow: '0 18px 60px rgba(68,35,20,.08)' }}>
        <img src="/brand/myticket-wordmark.png" alt="Myticket" style={{ width: 150, height: 'auto', marginBottom: 28 }} />
        <div style={{ color: '#ff5a1f', fontWeight: 700, fontSize: 13, letterSpacing: '.08em', marginBottom: 8 }}>WHATSAPP BUSINESS</div>
        <h1 style={{ fontSize: 30, margin: '0 0 12px', color: '#241a16' }}>Connect +968 7117 8817</h1>
        <p style={{ color: '#665750', lineHeight: 1.6, margin: '0 0 24px' }}>Meta will open WhatsApp Embedded Signup so the authorized number owner can select the Myticket WhatsApp Business account and connect the existing WhatsApp Business App number. All Myticket agents then use this same company number from the shared inbox.</p>
        <div style={{ background: '#fff8f4', border: '1px solid #ffd9c8', borderRadius: 12, padding: 16, marginBottom: 20, color: '#5e4438', lineHeight: 1.5 }}>{status}</div>
        {!configured && <p style={{ color: '#a13b18', fontSize: 14 }}>Vercel needs NEXT_PUBLIC_META_APP_ID and NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID.</p>}
        <button onClick={startSignup} disabled={busy || !sdkReady || !configured} style={{ width: '100%', border: 0, borderRadius: 12, padding: '14px 18px', background: busy || !sdkReady || !configured ? '#f3b39b' : '#ff5a1f', color: '#fff', fontWeight: 700, fontSize: 16, cursor: busy || !sdkReady || !configured ? 'not-allowed' : 'pointer' }}>{busy ? 'Connecting…' : sdkReady ? 'Connect WhatsApp number' : 'Loading Meta…'}</button>
        <p style={{ color: '#8b7a72', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>The connection is saved only after Meta returns both the WhatsApp Business Account ID and Phone Number ID.</p>
      </section>
    </main>
  )
}

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

const META_REDIRECT_URI = 'https://whatsapp.myticketom.com/whatsapp-onboarding'

export default function WhatsAppOnboardingPage() {
  const [sdkReady, setSdkReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready to connect the existing WhatsApp Business app number.')
  const sessionInfo = useRef<SessionInfo>({})
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const configId = process.env.NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
  const graphVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v26.0'

  useEffect(() => {
    if (window.location.pathname !== '/whatsapp-onboarding') {
      window.history.replaceState({}, '', META_REDIRECT_URI)
    }

    const receiveMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return

        const finished =
          data.event === 'FINISH' ||
          data.event === 'FINISH_ONLY_WABA' ||
          data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'

        if (finished) {
          sessionInfo.current = {
            waba_id: data.data?.waba_id,
            phone_number_id: data.data?.phone_number_id,
          }
          setStatus('Meta signup completed. Finishing the server connection…')
        } else if (data.event === 'CANCEL') {
          setBusy(false)
          setStatus('Signup was cancelled before completion.')
        } else if (data.event === 'ERROR') {
          setBusy(false)
          setStatus(`Meta signup error: ${data.data?.error_message || 'Unknown error'}`)
        }
      } catch {
        // Ignore unrelated window messages.
      }
    }
    window.addEventListener('message', receiveMessage)

    if (!appId) return () => window.removeEventListener('message', receiveMessage)

    window.fbAsyncInit = () => {
      // Do not enable Meta's optional FedCM login mode here. Embedded Signup is
      // config_id-based and must continue through the Facebook Login for Business
      // configuration rather than an OpenID-only FedCM prompt.
      window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion })
      setSdkReady(true)
    }
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.async = true
      script.defer = true
      script.crossOrigin = 'anonymous'
      script.src = 'https://connect.facebook.net/en_US/sdk.js'
      document.body.appendChild(script)
    } else if (window.FB) {
      window.fbAsyncInit()
    }

    return () => window.removeEventListener('message', receiveMessage)
  }, [appId, graphVersion])

  const finishSignup = async (response: any) => {
    const code = response?.authResponse?.code
    if (!code) {
      setBusy(false)
      const message = response?.status === 'not_authorized'
        ? 'Meta login was not authorized. Sign in to Facebook and allow the requested business access, then retry.'
        : 'Meta did not return an authorization code. Complete or retry the signup flow.'
      setStatus(message)
      return
    }

    try {
      const finish = await fetch('/api/whatsapp/onboarding', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...sessionInfo.current }),
      })
      const payload = await finish.json()
      if (!finish.ok) throw new Error(payload.error || 'Could not finish WhatsApp onboarding.')
      setStatus(`Connected successfully${payload.phoneNumberId ? ` (Phone Number ID ${payload.phoneNumberId})` : ''}.`)
      window.history.replaceState({}, '', '/whatsapp-onboarding')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not finish WhatsApp onboarding.')
    } finally {
      setBusy(false)
    }
  }

  const startSignup = () => {
    if (!window.FB || !appId || !configId) {
      setStatus('Embedded Signup is not configured yet. Add the Meta App ID and Configuration ID in Vercel.')
      return
    }

    setBusy(true)
    setStatus('Opening Meta Embedded Signup…')
    sessionInfo.current = {}

    try {
      window.FB.login(
        (response: any) => {
          void finishSignup(response)
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        },
      )
    } catch (error) {
      console.error('[whatsapp-onboarding] Meta Embedded Signup failed to open', error)
      setBusy(false)
      setStatus(`Could not open Meta signup: ${error instanceof Error ? error.message : 'Unknown Meta SDK error'}`)
    }
  }

  const configured = Boolean(appId && configId)

  return (
    <main style={{ minHeight: '100vh', background: '#fff7f3', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: 'min(620px, 100%)', background: '#fff', border: '1px solid #f0ddd4', borderRadius: 18, padding: 32, boxShadow: '0 18px 60px rgba(68, 35, 20, .08)' }}>
        <img src="/brand/myticket-wordmark.png" alt="Myticket" style={{ width: 150, height: 'auto', marginBottom: 28 }} />
        <div style={{ color: '#ff5a1f', fontWeight: 700, fontSize: 13, letterSpacing: '.08em', marginBottom: 8 }}>WHATSAPP BUSINESS</div>
        <h1 style={{ fontSize: 30, margin: '0 0 12px', color: '#241a16' }}>Connect the Myticket WhatsApp number</h1>
        <p style={{ color: '#665750', lineHeight: 1.6, margin: '0 0 24px' }}>
          This launches Meta Embedded Signup in WhatsApp Business App coexistence mode. The number owner completes Meta's prompts while the existing WhatsApp Business app remains part of the onboarding flow.
        </p>
        <div style={{ background: '#fff8f4', border: '1px solid #ffd9c8', borderRadius: 12, padding: 16, marginBottom: 20, color: '#5e4438', lineHeight: 1.5 }}>
          {status}
        </div>
        {!configured && <p style={{ color: '#a13b18', fontSize: 14 }}>Vercel still needs NEXT_PUBLIC_META_APP_ID and NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID.</p>}
        <button onClick={startSignup} disabled={busy || !sdkReady || !configured} style={{ width: '100%', border: 0, borderRadius: 12, padding: '14px 18px', background: busy || !sdkReady || !configured ? '#f3b39b' : '#ff5a1f', color: '#fff', fontWeight: 700, fontSize: 16, cursor: busy || !sdkReady || !configured ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Connecting…' : sdkReady ? 'Connect with Meta' : 'Loading Meta…'}
        </button>
        <p style={{ color: '#8b7a72', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>Do not paste access tokens, OTPs, or verification codes into this page. Meta handles the account authorization in its own popup.</p>
      </section>
    </main>
  )
}

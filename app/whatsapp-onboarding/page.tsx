'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    FB?: { init: (options: Record<string, unknown>) => void; login: (callback: (response: any) => void, options: Record<string, unknown>) => void }
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const configId = process.env.NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
  const graphVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v26.0'

  const stopTimer = () => { if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null } }

  const complete = async () => {
    if (!authCode.current || !sessionInfo.current.waba_id || !sessionInfo.current.phone_number_id) return
    stopTimer(); setStatus('WhatsApp number selected. Saving the connection…')
    try {
      const response = await fetch('/api/whatsapp/onboarding', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: authCode.current, ...sessionInfo.current }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not finish WhatsApp onboarding.')
      setStatus('Connected successfully. Opening the shared inbox…')
      window.setTimeout(() => window.location.assign('/'), 700)
    } catch (error) { setBusy(false); setStatus(error instanceof Error ? error.message : 'Could not finish WhatsApp onboarding.') }
  }

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'].includes(event.origin)) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
        if (['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(data.event)) {
          const returned = data.data || {}
          sessionInfo.current = { waba_id: returned.waba_id || returned.wabaId, phone_number_id: returned.phone_number_id || returned.phoneNumberId }
          if (!sessionInfo.current.waba_id || !sessionInfo.current.phone_number_id) {
            stopTimer(); setBusy(false); setStatus('Meta finished authorization but did not return the WhatsApp phone number. The number is not connected. Please reopen setup and make sure +968 7117 8817 is selected in the WhatsApp step.')
            return
          }
          setStatus('Meta returned the WhatsApp Business account and phone number. Finishing connection…'); void complete()
        } else if (data.event === 'CANCEL') { stopTimer(); setBusy(false); setStatus('WhatsApp connection was cancelled in Meta.') }
        else if (data.event === 'ERROR') { stopTimer(); setBusy(false); setStatus(`Meta signup error: ${data.data?.error_message || data.data?.error || 'Unknown error'}`) }
      } catch { /* unrelated browser message */ }
    }
    window.addEventListener('message', receiveMessage)
    if (!appId) return () => window.removeEventListener('message', receiveMessage)
    window.fbAsyncInit = () => { window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion }); setSdkReady(true) }
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script'); script.id = 'facebook-jssdk'; script.async = true; script.defer = true; script.crossOrigin = 'anonymous'; script.src = 'https://connect.facebook.net/en_US/sdk.js'; document.body.appendChild(script)
    } else if (window.FB) window.fbAsyncInit()
    return () => { window.removeEventListener('message', receiveMessage); stopTimer() }
  }, [appId, graphVersion])

  const startSignup = () => {
    if (!window.FB || !appId || !configId) { setStatus('Meta Embedded Signup is not ready. Check the Meta App ID and Configuration ID.'); return }
    stopTimer(); setBusy(true); authCode.current = null; sessionInfo.current = {}; setStatus('Opening WhatsApp Embedded Signup…')
    timeoutRef.current = setTimeout(() => { setBusy(false); setStatus('Meta did not return the WhatsApp Business Account and phone number. The connection was NOT saved. Please retry and complete the WhatsApp Business account/phone-number selection inside Meta.'); timeoutRef.current = null }, 30000)
    window.FB.login((response: any) => {
      const code = response?.authResponse?.code
      if (!code) { stopTimer(); setBusy(false); setStatus('Meta did not return an authorization code. The WhatsApp number was NOT connected.'); return }
      authCode.current = code
      if (sessionInfo.current.waba_id && sessionInfo.current.phone_number_id) { setStatus('Authorization received. Saving the connection…'); void complete() }
      else setStatus('Authorization received. Waiting for Meta to return the WhatsApp Business Account and phone number…')
    }, { config_id: configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' } })
  }

  const configured = Boolean(appId && configId)
  return <main style={{ minHeight:'100vh',background:'#fff7f3',display:'grid',placeItems:'center',padding:24,fontFamily:'Arial, sans-serif' }}><section style={{ width:'min(620px, 100%)',background:'#fff',border:'1px solid #f0ddd4',borderRadius:18,padding:32,boxShadow:'0 18px 60px rgba(68,35,20,.08)' }}><img src="/brand/myticket-wordmark.png" alt="Myticket" style={{ width:150,height:'auto',marginBottom:28 }}/><div style={{ color:'#ff5a1f',fontWeight:700,fontSize:13,letterSpacing:'.08em',marginBottom:8 }}>WHATSAPP BUSINESS</div><h1 style={{ fontSize:30,margin:'0 0 12px',color:'#241a16' }}>Connect +968 7117 8817</h1><p style={{ color:'#665750',lineHeight:1.6,margin:'0 0 24px' }}>Connect the company WhatsApp Business App number once. After it is verified, all authorized Myticket agents use this same number from the shared inbox.</p><div style={{ background:'#fff8f4',border:'1px solid #ffd9c8',borderRadius:12,padding:16,marginBottom:20,color:'#5e4438',lineHeight:1.5 }}>{status}</div>{!configured && <p style={{ color:'#a13b18',fontSize:14 }}>Vercel needs the Meta App ID and Embedded Signup Configuration ID.</p>}<button onClick={startSignup} disabled={busy||!sdkReady||!configured} style={{ width:'100%',border:0,borderRadius:12,padding:'14px 18px',background:busy||!sdkReady||!configured?'#f3b39b':'#ff5a1f',color:'#fff',fontWeight:700,fontSize:16,cursor:busy||!sdkReady||!configured?'not-allowed':'pointer' }}>{busy?'Connecting…':sdkReady?'Connect WhatsApp number':'Loading Meta…'}</button><p style={{ color:'#8b7a72',fontSize:12,marginTop:16,lineHeight:1.5 }}>If Meta does not return both the WABA ID and Phone Number ID within 30 seconds, this page stops instead of falsely showing a connection.</p></section></main>
}

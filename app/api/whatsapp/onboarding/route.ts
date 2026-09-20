import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'

// Meta's JavaScript SDK uses the site's root URL as the redirect_uri for the
// Embedded Signup OAuth authorization request. The authorization-code exchange
// MUST use that exact same URI or Meta rejects the code.
const META_OAUTH_REDIRECT_URI = 'https://whatsapp.myticketom.com/'

export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error

  const {
    code,
    redirect_uri: suppliedRedirectUri,
    waba_id: suppliedWabaId,
    phone_number_id: suppliedPhoneNumberId,
  } = await request.json().catch(() => ({}))

  if (typeof code !== 'string' || !code) {
    return NextResponse.json({ error: 'Meta authorization code is required.' }, { status: 400 })
  }

  // If a caller supplies a redirect URI, only accept the exact URI Meta used
  // when issuing the authorization code.
  if (suppliedRedirectUri && suppliedRedirectUri !== META_OAUTH_REDIRECT_URI) {
    return NextResponse.json({ error: 'Invalid Meta redirect URI.' }, { status: 400 })
  }

  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const graphVersion = process.env.META_GRAPH_VERSION || 'v26.0'
  if (!appId || !appSecret) {
    return NextResponse.json({ error: 'Meta App ID/App Secret are not configured on the server.' }, { status: 503 })
  }

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
    tokenUrl.searchParams.set('client_id', appId)
    tokenUrl.searchParams.set('client_secret', appSecret)
    tokenUrl.searchParams.set('code', code)
    tokenUrl.searchParams.set('redirect_uri', META_OAUTH_REDIRECT_URI)

    const tokenResponse = await fetch(tokenUrl, { method: 'GET', cache: 'no-store' })
    const tokenPayload = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      console.error('[whatsapp-onboarding] token exchange failed', {
        httpStatus: tokenResponse.status,
        code: tokenPayload?.error?.code,
        message: tokenPayload?.error?.message,
      })
      return NextResponse.json({ error: tokenPayload?.error?.message || 'Meta token exchange failed.' }, { status: 502 })
    }

    const accessToken = tokenPayload.access_token as string
    const wabaId = typeof suppliedWabaId === 'string' ? suppliedWabaId : undefined
    const phoneNumberId = typeof suppliedPhoneNumberId === 'string' ? suppliedPhoneNumberId : undefined

    if (wabaId) {
      const subscribeResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const subscribePayload = await subscribeResponse.json().catch(() => null)
      if (!subscribeResponse.ok || subscribePayload?.success === false) {
        console.error('[whatsapp-onboarding] WABA app subscription failed', {
          httpStatus: subscribeResponse.status,
          code: subscribePayload?.error?.code,
          message: subscribePayload?.error?.message,
          wabaId,
        })
        return NextResponse.json({ error: subscribePayload?.error?.message || 'WhatsApp account could not be subscribed to the app.' }, { status: 502 })
      }
    }

    console.info('[whatsapp-onboarding] completed', {
      wabaId: wabaId || null,
      phoneNumberId: phoneNumberId || null,
      subscribed: Boolean(wabaId),
    })

    return NextResponse.json({
      success: true,
      wabaId: wabaId || null,
      phoneNumberId: phoneNumberId || null,
      subscribed: Boolean(wabaId),
    })
  } catch (error) {
    console.error('[whatsapp-onboarding] failed', error)
    return NextResponse.json({ error: 'WhatsApp onboarding could not be completed.' }, { status: 500 })
  }
}

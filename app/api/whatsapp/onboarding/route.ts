import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error

  const { code, waba_id: suppliedWabaId, phone_number_id: suppliedPhoneNumberId } = await request.json().catch(() => ({}))
  if (typeof code !== 'string' || !code) {
    return NextResponse.json({ error: 'Meta authorization code is required.' }, { status: 400 })
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
    let wabaId = typeof suppliedWabaId === 'string' ? suppliedWabaId : undefined
    let phoneNumberId = typeof suppliedPhoneNumberId === 'string' ? suppliedPhoneNumberId : undefined

    // Coexistence session information is normally supplied by the Embedded Signup
    // FINISH event. If Meta omitted it, keep the token exchange successful and
    // report that the account IDs still need to be confirmed in Meta.
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
      // Deliberately never return the exchanged access token to the browser.
    })
  } catch (error) {
    console.error('[whatsapp-onboarding] failed', error)
    return NextResponse.json({ error: 'WhatsApp onboarding could not be completed.' }, { status: 500 })
  }
}

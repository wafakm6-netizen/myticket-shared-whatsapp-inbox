import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error

  const { code, waba_id: suppliedWabaId, phone_number_id: suppliedPhoneNumberId } = await request.json().catch(() => ({}))
  if (typeof code !== 'string' || !code) return NextResponse.json({ error: 'Meta authorization code is required.' }, { status: 400 })

  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const graphVersion = process.env.META_GRAPH_VERSION || 'v26.0'
  const redirectUri = 'https://whatsapp.myticketom.com/whatsapp-onboarding'
  if (!appId || !appSecret) return NextResponse.json({ error: 'Meta App ID/App Secret are not configured on the server.' }, { status: 503 })

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
    tokenUrl.searchParams.set('client_id', appId)
    tokenUrl.searchParams.set('client_secret', appSecret)
    tokenUrl.searchParams.set('code', code)
    tokenUrl.searchParams.set('redirect_uri', redirectUri)
    const tokenResponse = await fetch(tokenUrl, { method: 'GET', cache: 'no-store' })
    const tokenPayload = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      console.error('[whatsapp-onboarding] token exchange failed', { httpStatus: tokenResponse.status, code: tokenPayload?.error?.code, subcode: tokenPayload?.error?.error_subcode, message: tokenPayload?.error?.message })
      return NextResponse.json({ error: tokenPayload?.error?.message || 'Meta token exchange failed.' }, { status: 502 })
    }

    const accessToken = tokenPayload.access_token as string
    let wabaId = typeof suppliedWabaId === 'string' && suppliedWabaId ? suppliedWabaId : undefined
    let phoneNumberId = typeof suppliedPhoneNumberId === 'string' && suppliedPhoneNumberId ? suppliedPhoneNumberId : undefined

    // The redirect OAuth variant may not carry Embedded Signup's window-message payload.
    // Resolve the WABA/phone from the assets the returned business token can actually access.
    if (!wabaId) {
      const businessesResponse = await fetch(`https://graph.facebook.com/${graphVersion}/me/businesses?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, { cache: 'no-store' })
      const businessesPayload = await businessesResponse.json().catch(() => null)
      for (const business of businessesPayload?.data || []) {
        const accountsResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${business.id}/owned_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, { cache: 'no-store' })
        const accountsPayload = await accountsResponse.json().catch(() => null)
        const account = accountsPayload?.data?.[0]
        if (account?.id) { wabaId = account.id; break }
      }
    }

    if (wabaId && !phoneNumberId) {
      const phonesResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${encodeURIComponent(accessToken)}`, { cache: 'no-store' })
      const phonesPayload = await phonesResponse.json().catch(() => null)
      const preferred = (phonesPayload?.data || []).find((phone: any) => String(phone.display_phone_number || '').replace(/\D/g, '').endsWith('71178817')) || phonesPayload?.data?.[0]
      if (preferred?.id) phoneNumberId = preferred.id
    }

    if (!wabaId || !phoneNumberId) {
      return NextResponse.json({ error: 'Meta authorization succeeded, but no accessible WhatsApp Business Account/phone number was returned. The connection has not been saved.' }, { status: 502 })
    }

    const subscribeResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
    const subscribePayload = await subscribeResponse.json().catch(() => null)
    if (!subscribeResponse.ok || subscribePayload?.success === false) return NextResponse.json({ error: subscribePayload?.error?.message || 'WhatsApp account could not be subscribed to the app.' }, { status: 502 })

    const supabase = createServerSupabaseClient()
    const { error: saveError } = await supabase.from('whatsapp_connection').upsert({ id: 1, waba_id: wabaId, phone_number_id: phoneNumberId, connected: true, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (saveError) {
      console.error('[whatsapp-onboarding] connection persistence failed', saveError)
      return NextResponse.json({ error: 'Meta connected, but the connection could not be saved in the inbox database.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, wabaId, phoneNumberId, subscribed: true })
  } catch (error) {
    console.error('[whatsapp-onboarding] failed', error)
    return NextResponse.json({ error: 'WhatsApp onboarding could not be completed.' }, { status: 500 })
  }
}

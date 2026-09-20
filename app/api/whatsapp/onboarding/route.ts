import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const auth = await requireAgent()
  if (auth.error) return auth.error

  const { code, waba_id: suppliedWabaId, phone_number_id: suppliedPhoneNumberId } = await request.json().catch(() => ({}))
  if (typeof code !== 'string' || !code) return NextResponse.json({ error: 'Meta authorization code is required.' }, { status: 400 })
  if (typeof suppliedWabaId !== 'string' || !suppliedWabaId || typeof suppliedPhoneNumberId !== 'string' || !suppliedPhoneNumberId) {
    return NextResponse.json({ error: 'Meta did not return the WhatsApp Business Account and phone number. The connection was not saved.' }, { status: 400 })
  }

  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const graphVersion = process.env.META_GRAPH_VERSION || 'v26.0'
  if (!appId || !appSecret) return NextResponse.json({ error: 'Meta App ID/App Secret are not configured on the server.' }, { status: 503 })

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
    tokenUrl.searchParams.set('client_id', appId)
    tokenUrl.searchParams.set('client_secret', appSecret)
    tokenUrl.searchParams.set('code', code)
    const tokenResponse = await fetch(tokenUrl, { method: 'GET', cache: 'no-store' })
    const tokenPayload = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      console.error('[whatsapp-onboarding] token exchange failed', { httpStatus: tokenResponse.status, code: tokenPayload?.error?.code, subcode: tokenPayload?.error?.error_subcode, message: tokenPayload?.error?.message })
      return NextResponse.json({ error: tokenPayload?.error?.message || 'Meta token exchange failed.' }, { status: 502 })
    }

    const accessToken = tokenPayload.access_token as string
    const wabaId = suppliedWabaId
    const phoneNumberId = suppliedPhoneNumberId

    // Verify that the selected phone really belongs to the WABA authorized by Meta.
    const phonesResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } })
    const phonesPayload = await phonesResponse.json().catch(() => null)
    if (!phonesResponse.ok) return NextResponse.json({ error: phonesPayload?.error?.message || 'Could not verify the WhatsApp phone number.' }, { status: 502 })
    const selectedPhone = (phonesPayload?.data || []).find((phone: any) => phone.id === phoneNumberId)
    if (!selectedPhone) return NextResponse.json({ error: 'The phone number returned by Meta does not belong to the authorized WhatsApp Business Account.' }, { status: 400 })

    const digits = String(selectedPhone.display_phone_number || '').replace(/\D/g, '')
    if (digits && !digits.endsWith('71178817')) return NextResponse.json({ error: `Meta returned a different WhatsApp number (${selectedPhone.display_phone_number}). Select +968 7117 8817 during signup.` }, { status: 400 })

    const subscribeResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
    const subscribePayload = await subscribeResponse.json().catch(() => null)
    if (!subscribeResponse.ok || subscribePayload?.success === false) return NextResponse.json({ error: subscribePayload?.error?.message || 'WhatsApp account could not be subscribed to the app.' }, { status: 502 })

    const supabase = createServerSupabaseClient()
    const { error: saveError } = await supabase.from('whatsapp_connection').upsert({ id: 1, waba_id: wabaId, phone_number_id: phoneNumberId, connected: true, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (saveError) return NextResponse.json({ error: 'Meta connected, but the connection could not be saved in the inbox database.' }, { status: 500 })

    return NextResponse.json({ success: true, wabaId, phoneNumberId, displayPhoneNumber: selectedPhone.display_phone_number || null, subscribed: true })
  } catch (error) {
    console.error('[whatsapp-onboarding] failed', error)
    return NextResponse.json({ error: 'WhatsApp onboarding could not be completed.' }, { status: 500 })
  }
}

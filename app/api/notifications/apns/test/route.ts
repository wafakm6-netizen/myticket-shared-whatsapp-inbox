import { NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { APNS_PREFIX, sendApnsPush } from '@/lib/notifications/apns'

// "Send a test notification" in the iOS app: pushes to every iPhone saved for the signed-in agent and reports
// Apple's answer for each, so a failing step (missing keys, wrong key, unknown device) is visible in the app.
export async function POST() {
  const auth = await requireAgent(); if (auth.error) return auth.error
  if (!process.env.APNS_KEY_P8 || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) {
    return NextResponse.json({ ok: false, message: 'The server has no Apple push key (APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID in Vercel).' })
  }
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.from('whatsapp_push_subscriptions').select('endpoint').eq('agent_id', auth.agent!.id).like('endpoint', APNS_PREFIX + '%')
  if (error) return NextResponse.json({ ok: false, message: 'Could not read saved devices.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ ok: false, devices: 0, message: 'No iPhone is saved for your account yet.' })
  const results = await Promise.all(data.map(async ({ endpoint }) => {
    const device = '…' + endpoint.slice(-6)
    try {
      const outcome = await sendApnsPush(endpoint, { title: 'Myticket Inbox', body: 'Test notification: notifications work on this iPhone.', tag: 'myticket-test' })
      if (outcome === 'expired') { await supabase.from('whatsapp_push_subscriptions').delete().eq('endpoint', endpoint); return { device, ok: false, reason: 'Apple no longer accepts this device (removed).' } }
      return { device, ok: outcome === true, reason: outcome === true ? '' : 'Not sent.' }
    } catch (err) {
      return { device, ok: false, reason: err instanceof Error ? err.message : 'Unknown error' }
    }
  }))
  return NextResponse.json({ ok: results.some((r) => r.ok), devices: results.length, results })
}

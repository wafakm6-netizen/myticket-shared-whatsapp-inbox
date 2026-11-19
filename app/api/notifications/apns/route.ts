import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { APNS_PREFIX } from '@/lib/notifications/apns'

// The iOS app registers its APNs device token here after the agent signs in.
// Stored alongside browser subscriptions (endpoint "apns:<token>") so delivery code stays unchanged.
export async function POST(request: NextRequest) {
  const auth = await requireAgent(); if (auth.error) return auth.error
  const { token } = await request.json().catch(() => ({}))
  if (typeof token !== 'string' || !/^[0-9a-f]{32,200}$/i.test(token)) return NextResponse.json({ error: 'Invalid device token' }, { status: 400 })
  const { error } = await createServerSupabaseClient().from('whatsapp_push_subscriptions').upsert({ agent_id: auth.agent!.id, endpoint: APNS_PREFIX + token.toLowerCase(), p256dh: 'apns', auth: 'apns' }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: 'Could not save device token' }, { status: 500 })
  return NextResponse.json({ success: true })
}
export async function DELETE(request: NextRequest) {
  const auth = await requireAgent(); if (auth.error) return auth.error
  const { token } = await request.json().catch(() => ({}))
  if (typeof token !== 'string') return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  await createServerSupabaseClient().from('whatsapp_push_subscriptions').delete().eq('agent_id', auth.agent!.id).eq('endpoint', APNS_PREFIX + token.toLowerCase())
  return NextResponse.json({ success: true })
}

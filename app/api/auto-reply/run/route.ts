import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { runDueMenus } from '@/lib/auto-reply/engine'

// Called every minute by Vercel Cron (vercel.json). With CRON_SECRET set in Vercel, only Vercel's own call is accepted.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authorized = secret ? request.headers.get('authorization') === `Bearer ${secret}` : /vercel-cron/i.test(request.headers.get('user-agent') || '')
  if (!authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const result = await runDueMenus(createServerSupabaseClient())
    return NextResponse.json(result)
  } catch (error) {
    console.error('[auto-reply] run failed', error)
    return NextResponse.json({ error: 'Auto reply run failed.' }, { status: 500 })
  }
}

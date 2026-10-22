import { NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(){
  const auth=await requireAgent()
  if(auth.error)return auth.error
  const {data,error}=await createServerSupabaseClient().from('whatsapp_notification_events').select('id').eq('agent_id',auth.agent!.id).order('created_at',{ascending:false}).limit(1)
  if(error)return NextResponse.json({error:'Notifications unavailable'},{status:500})
  return NextResponse.json({latestId:data?.[0]?.id||null},{headers:{'Cache-Control':'no-store'}})
}

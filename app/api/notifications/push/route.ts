import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(){
  const auth=await requireAgent();if(auth.error)return auth.error
  return NextResponse.json({publicKey:process.env.WEB_PUSH_VAPID_PUBLIC_KEY || null,enabled:Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT)})
}
export async function POST(request:NextRequest){
  const auth=await requireAgent();if(auth.error)return auth.error
  const {subscription}=await request.json().catch(()=>({}))
  const endpoint=subscription?.endpoint,p256dh=subscription?.keys?.p256dh,keyAuth=subscription?.keys?.auth
  if(typeof endpoint!=='string'||typeof p256dh!=='string'||typeof keyAuth!=='string'||endpoint.length>2048||!/^https:\/\//.test(endpoint)||!p256dh||!keyAuth)return NextResponse.json({error:'Invalid push subscription'},{status:400})
  const supabase=createServerSupabaseClient()
  const {error}=await supabase.from('whatsapp_push_subscriptions').upsert({agent_id:auth.agent!.id,endpoint,p256dh,auth:keyAuth},{onConflict:'endpoint'})
  if(error)return NextResponse.json({error:'Could not save push subscription'},{status:500})
  return NextResponse.json({success:true})
}
export async function DELETE(request:NextRequest){
  const auth=await requireAgent();if(auth.error)return auth.error
  const {endpoint}=await request.json().catch(()=>({}))
  if(typeof endpoint!=='string')return NextResponse.json({error:'Missing endpoint'},{status:400})
  const {error}=await createServerSupabaseClient().from('whatsapp_push_subscriptions').delete().eq('agent_id',auth.agent!.id).eq('endpoint',endpoint)
  if(error)return NextResponse.json({error:'Could not remove subscription'},{status:500})
  return NextResponse.json({success:true})
}

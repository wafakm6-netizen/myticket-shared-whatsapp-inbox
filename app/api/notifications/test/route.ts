import { NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sendBrowserPush } from '@/lib/notifications/push'

export async function POST(){
  const auth=await requireAgent()
  if(auth.error)return auth.error
  const supabase=createServerSupabaseClient()
  const {data:subscriptions,error}=await supabase.from('whatsapp_push_subscriptions').select('endpoint,p256dh,auth').eq('agent_id',auth.agent!.id)
  if(error)return NextResponse.json({error:'Unable to load push subscriptions.'},{status:500})
  if(!subscriptions?.length)return NextResponse.json({error:'No browser subscription found. Enable browser notifications on this device first.'},{status:400})
  const results=await Promise.all(subscriptions.map(async subscription=>{
    try{
      const result=await sendBrowserPush(subscription,{title:'Myticket Test Notification',body:'This is a test notification.',tag:'myticket-test-'+Date.now(),url:'https://whatsapp.myticketom.com/'})
      if(result==='expired')await supabase.from('whatsapp_push_subscriptions').delete().eq('endpoint',subscription.endpoint)
      return {status:result===true?'accepted':result==='expired'?'expired':'not_configured'}
    }catch(e){return {status:'failed',reason:e instanceof Error?e.message:'Unknown delivery error'}}
  }))
  const accepted=results.filter(x=>x.status==='accepted').length
  return NextResponse.json({accepted,total:results.length,results},{status:accepted?200:502})
}

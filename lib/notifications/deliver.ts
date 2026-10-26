import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sendBrowserPush } from '@/lib/notifications/push'

type Database = ReturnType<typeof createServerSupabaseClient>
export async function notifyFirstInbound(supabase: Database, conversationId: string, externalId: string, contactName: string, assignedAgentId?: string | null) {
  const { data: claimed, error: claimError } = await supabase.rpc('claim_whatsapp_notification',{p_conversation_id:conversationId,p_external_id:externalId})
  if (claimError) throw claimError
  if (!claimed) return
  const query = supabase.from('whatsapp_agents').select('id,email').eq('is_active',true)
  const {data:agents,error:agentError} = await query
  if (agentError) throw agentError
  const name = contactName || 'Customer or supplier'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatsapp.myticketom.com'
  for (const agent of agents || []) {
    try {
      await supabase.from('whatsapp_notification_events').insert({conversation_id:conversationId,agent_id:agent.id,kind:'incoming'})
      const {data:subscriptions,error:subscriptionError} = await supabase.from('whatsapp_push_subscriptions').select('endpoint,p256dh,auth').eq('agent_id',agent.id)
      if (subscriptionError) throw subscriptionError
      await Promise.allSettled((subscriptions || []).map(async subscription=>{
        try {
          const outcome = await sendBrowserPush(subscription,{title:'Myticket Shared Inbox',body:'Someone sent you messages.',tag:'myticket-'+conversationId,url:appUrl+'/?conversation='+encodeURIComponent(conversationId),contact:name})
          if (outcome==='expired') await supabase.from('whatsapp_push_subscriptions').delete().eq('endpoint',subscription.endpoint)
        } catch(error){console.error('[notifications] browser push failed',error)}
      }))
      if (process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL && agent.email) {
        const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.NOTIFICATION_FROM_EMAIL,to:[agent.email],subject:'Someone sent you messages — Myticket',text:'Someone sent you messages.\nFrom: '+name+'\nOpen the inbox: '+appUrl+'/?conversation='+encodeURIComponent(conversationId)})})
        if (!response.ok) console.error('[notifications] email delivery request failed',response.status)
      }
    } catch(error){console.error('[notifications] recipient delivery failed',error)}
  }
}

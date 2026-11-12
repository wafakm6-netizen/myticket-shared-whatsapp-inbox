import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sendBrowserPush } from '@/lib/notifications/push'

type Database = ReturnType<typeof createServerSupabaseClient>
export async function notifyFirstInbound(supabase: Database, conversationId: string, externalId: string, contactName: string, assignedAgentId?: string | null, messagePreview?: string | null) {
  // The webhook already checks the incoming WhatsApp message external ID before
  // invoking this function. Do not gate alerts on a conversation-level claim:
  // every newly received message should notify subscribed agents.
  const query = supabase.from('whatsapp_agents').select('id,email').eq('is_active',true)
  const {data:agents,error:agentError} = await query
  if (agentError) throw agentError
  const name = contactName || 'Customer or supplier'
  const preview = messagePreview?.trim().slice(0, 240) || 'Sent an attachment'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatsapp.myticketom.com'
  for (const agent of agents || []) {
    try {
      await supabase.from('whatsapp_notification_events').insert({conversation_id:conversationId,agent_id:agent.id,kind:'incoming'})
      const {data:subscriptions,error:subscriptionError} = await supabase.from('whatsapp_push_subscriptions').select('endpoint,p256dh,auth').eq('agent_id',agent.id)
      if (subscriptionError) throw subscriptionError
      await Promise.allSettled((subscriptions || []).map(async subscription=>{
        try {
          const outcome = await sendBrowserPush(subscription,{title:name,body:preview,tag:'myticket-'+externalId,url:appUrl+'/?conversation='+encodeURIComponent(conversationId),contact:name})
          if (outcome==='expired') await supabase.from('whatsapp_push_subscriptions').delete().eq('endpoint',subscription.endpoint)
        } catch(error){console.error('[notifications] browser push failed',error)}
      }))
      if (process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL && agent.email) {
        const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.NOTIFICATION_FROM_EMAIL,to:[agent.email],subject:name+' — Myticket',text:name+'\n'+preview+'\nOpen the inbox: '+appUrl+'/?conversation='+encodeURIComponent(conversationId)})})
        if (!response.ok) console.error('[notifications] email delivery request failed',response.status)
      }
    } catch(error){console.error('[notifications] recipient delivery failed',error)}
  }
}

// Someone was @mentioned in an internal note: alert only the mentioned teammates (never the customer).
export async function notifyMentions(supabase: Database, conversationId: string, noteId: string, authorId: string, authorName: string, body: string) {
  const pattern = /@\[([^\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)/g
  const ids = Array.from(new Set(Array.from(body.matchAll(pattern), (match) => match[2]))).filter((id) => id !== authorId)
  if (!ids.length) return
  const { data: agents, error } = await supabase.from('whatsapp_agents').select('id,email').eq('is_active', true).in('id', ids)
  if (error) throw error
  if (!agents?.length) return
  const { data: conversation } = await supabase.from('whatsapp_conversations').select('id, whatsapp_contacts(display_name, phone)').eq('id', conversationId).maybeSingle()
  const contact: any = Array.isArray((conversation as any)?.whatsapp_contacts) ? (conversation as any).whatsapp_contacts[0] : (conversation as any)?.whatsapp_contacts
  const contactName = (contact?.display_name && String(contact.display_name).trim() !== '.' ? contact.display_name : contact?.phone) || 'a customer'
  const text = body.replace(pattern, (_match, name) => `@${name}`).trim().slice(0, 240)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatsapp.myticketom.com'
  const url = appUrl + '/?conversation=' + encodeURIComponent(conversationId)
  for (const agent of agents) {
    try {
      // Older databases may only allow the 'incoming' kind here; a failed log must not stop the alert.
      const { error: eventError } = await supabase.from('whatsapp_notification_events').insert({ conversation_id: conversationId, agent_id: agent.id, kind: 'mention' })
      if (eventError) console.warn('[notifications] mention event not logged', eventError.message)
      const { data: subscriptions, error: subscriptionError } = await supabase.from('whatsapp_push_subscriptions').select('endpoint,p256dh,auth').eq('agent_id', agent.id)
      if (subscriptionError) throw subscriptionError
      await Promise.allSettled((subscriptions || []).map(async (subscription) => {
        try {
          const outcome = await sendBrowserPush(subscription, { title: `${authorName} mentioned you`, body: `Chat with ${contactName}: ${text}`, tag: 'myticket-mention-' + noteId, url, contact: contactName })
          if (outcome === 'expired') await supabase.from('whatsapp_push_subscriptions').delete().eq('endpoint', subscription.endpoint)
        } catch (pushError) { console.error('[notifications] mention push failed', pushError) }
      }))
    } catch (recipientError) { console.error('[notifications] mention delivery failed', recipientError) }
  }
}

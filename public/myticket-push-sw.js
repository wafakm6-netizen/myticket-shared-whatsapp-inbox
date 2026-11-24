self.addEventListener('push', event => {
  let data={}
  try { data=event.data ? event.data.json() : {} } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Myticket Shared Inbox',{
    body:data.body || 'Someone sent you messages.',
    icon:'/brand/app-icon-192.png?v=3',
    badge:'/brand/app-icon-96.png?v=3',
    tag:data.tag || 'myticket-incoming',
    data:{url:data.url || '/'}
  }))
})
self.addEventListener('notificationclick',event=>{
  event.notification.close()
  const target=event.notification.data?.url || '/'
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    // Inbox already open: focus it and open the chat in place (no reload), so the new message shows at once.
    const conversationId=new URL(target,self.location.origin).searchParams.get('conversation')
    for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();if(conversationId)client.postMessage({type:'open-conversation',conversationId});else client.navigate(target);return}}
    return clients.openWindow(target)
  }))
})

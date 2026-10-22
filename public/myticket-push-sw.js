self.addEventListener('push', event => {
  let data={}
  try { data=event.data ? event.data.json() : {} } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Myticket Shared Inbox',{
    body:data.body || 'Someone sent you messages.',
    icon:'/myticket-favicon.png',
    badge:'/myticket-favicon.png',
    tag:data.tag || 'myticket-incoming',
    data:{url:data.url || '/'}
  }))
})
self.addEventListener('notificationclick',event=>{
  event.notification.close()
  const target=event.notification.data?.url || '/'
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();client.navigate(target);return}}
    return clients.openWindow(target)
  }))
})

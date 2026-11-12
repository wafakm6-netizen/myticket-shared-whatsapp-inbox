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
    for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();client.navigate(target);return}}
    return clients.openWindow(target)
  }))
})

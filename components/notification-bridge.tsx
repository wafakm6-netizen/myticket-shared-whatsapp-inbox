'use client'

import { useEffect, useRef, useState } from 'react'

type InboxRow = {
  id: string
  unread_count?: number | null
  last_message_at?: string | null
  whatsapp_contacts?: { display_name?: string | null; phone?: string | null } | { display_name?: string | null; phone?: string | null }[] | null
  whatsapp_messages?: { direction?: string; body?: string | null; attachment_name?: string | null; created_at?: string | null; sent_at?: string | null }[] | null
}

type Notice = { id: string; conversationId: string; name: string; preview: string; time: string }

export function NotificationBridge() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [open, setOpen] = useState(false)
  const baseline = useRef<Map<string, number> | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = async () => {
      try {
        const response = await fetch('/api/inbox', { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const payload = await response.json()
        const next = new Map<string, number>()
        const incoming: Notice[] = []
        for (const row of (payload.conversations ?? []) as InboxRow[]) {
          const count = Math.max(0, Number(row.unread_count) || 0)
          next.set(row.id, count)
          const previous = baseline.current?.get(row.id) ?? 0
          if (baseline.current && count > previous) {
            const contact = Array.isArray(row.whatsapp_contacts) ? row.whatsapp_contacts[0] : row.whatsapp_contacts
            const messages = [...(row.whatsapp_messages ?? [])].sort((a, b) => new Date(a.created_at || a.sent_at || 0).getTime() - new Date(b.created_at || b.sent_at || 0).getTime())
            const lastInbound = [...messages].reverse().find((message) => message.direction === 'inbound')
            incoming.push({
              id: `${row.id}-${Date.now()}`,
              conversationId: row.id,
              name: contact?.display_name || contact?.phone || 'WhatsApp contact',
              preview: lastInbound?.body || lastInbound?.attachment_name || 'New WhatsApp message',
              time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            })
          }
        }
        baseline.current = next
        if (incoming.length) {
          setNotices((current) => [...incoming, ...current].slice(0, 30))
          for (const notice of incoming) {
            if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
              const notification = new Notification(`New message from ${notice.name}`, { body: notice.preview, icon: '/brand/myticket-icon.png', tag: `conversation-${notice.conversationId}` })
              notification.onclick = () => { window.focus(); notification.close() }
            }
          }
        }
      } catch (error) {
        console.error('[notifications] refresh failed', error)
      }
    }

    const poll = () => {
      if (cancelled) return
      void check().finally(() => { if (!cancelled) timer = setTimeout(poll, 5000) })
    }
    void check()
    timer = setTimeout(poll, 5000)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[aria-label="Notifications"]')
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      setOpen((value) => !value)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const enableBrowser = async () => {
    if (!('Notification' in window)) return
    await Notification.requestPermission()
  }

  const openConversation = (conversationId: string) => {
    const card = Array.from(document.querySelectorAll<HTMLButtonElement>('button.conversation')).find((item) => item.dataset.conversationId === conversationId)
    card?.click()
    setNotices((current) => current.filter((notice) => notice.conversationId !== conversationId))
    setOpen(false)
  }

  return <>
    {notices.length > 0 && <span className="notification-count" aria-label={`${notices.length} new notification${notices.length === 1 ? '' : 's'}`}>{notices.length > 99 ? '99+' : notices.length}</span>}
    {open && <div className="notification-panel" role="dialog" aria-label="Notifications">
      <div className="notification-panel-head"><div><strong>Notifications</strong><span>{notices.length ? `${notices.length} new` : 'You’re all caught up'}</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">×</button></div>
      {'Notification' in globalThis && Notification.permission !== 'granted' && <button type="button" className="notification-enable" onClick={() => void enableBrowser()}>Enable browser notifications</button>}
      <div className="notification-list">{notices.length === 0 ? <p className="notification-empty">No new messages.</p> : notices.map((notice) => <button type="button" className="notification-item" key={notice.id} onClick={() => openConversation(notice.conversationId)}><span className="notification-avatar">{notice.name.slice(0, 2).toUpperCase()}</span><span className="notification-copy"><strong>{notice.name}</strong><span>{notice.preview}</span><small>{notice.time}</small></span></button>)}</div>
      {notices.length > 0 && <button type="button" className="notification-clear" onClick={() => setNotices([])}>Clear notifications</button>}
    </div>}
  </>
}

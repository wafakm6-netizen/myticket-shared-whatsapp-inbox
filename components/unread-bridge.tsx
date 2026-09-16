'use client'

import { useEffect } from 'react'

type InboxConversation = {
  id: string
  unread_count?: number | null
  whatsapp_contacts?: { display_name?: string | null; phone?: string | null } | { display_name?: string | null; phone?: string | null }[] | null
}

export function UnreadBridge() {
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearBadges = () => document.querySelectorAll('.conversation-unread-badge').forEach((node) => node.remove())

    const renderUnread = async () => {
      try {
        const response = await fetch('/api/inbox', { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const payload = await response.json()
        if (cancelled) return
        clearBadges()
        const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('button.conversation'))
        for (const row of (payload.conversations ?? []) as InboxConversation[]) {
          const unread = Math.max(0, Number(row.unread_count) || 0)
          if (!unread) continue
          const contact = Array.isArray(row.whatsapp_contacts) ? row.whatsapp_contacts[0] : row.whatsapp_contacts
          const name = contact?.display_name?.trim()
          const phone = contact?.phone?.trim()
          const card = cards.find((item) => {
            const text = (item.innerText || '').replace(/\s+/g, ' ')
            return Boolean((name && text.includes(name)) || (phone && text.includes(phone)))
          })
          if (!card) continue
          card.dataset.conversationId = row.id
          const top = card.querySelector('.conversation-top')
          if (!top) continue
          const badge = document.createElement('span')
          badge.className = 'conversation-unread-badge'
          badge.textContent = unread > 99 ? '99+' : String(unread)
          badge.setAttribute('aria-label', `${unread} unread message${unread === 1 ? '' : 's'}`)
          badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;margin-left:auto;border-radius:999px;background:#ff5a1f;color:#fff;font-size:10px;font-weight:800;line-height:1;box-sizing:border-box;flex:0 0 auto;'
          top.appendChild(badge)
        }
      } catch (error) {
        console.error('[unread] refresh failed', error)
      }
    }

    const markRead = async (card: HTMLButtonElement) => {
      const badge = card.querySelector('.conversation-unread-badge')
      if (!badge) return
      let id = card.dataset.conversationId
      if (!id) {
        await renderUnread()
        id = card.dataset.conversationId
      }
      if (!id) return
      badge.remove()
      try {
        const response = await fetch('/api/inbox', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, patch: { unread_count: 0 } }),
        })
        if (!response.ok) throw new Error('Could not mark conversation as read')
      } catch (error) {
        console.error('[unread] mark read failed', error)
        void renderUnread()
      }
    }

    const onClick = (event: MouseEvent) => {
      const card = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button.conversation')
      if (card) void markRead(card)
    }

    document.addEventListener('click', onClick, true)
    void renderUnread()
    const poll = () => {
      if (cancelled) return
      void renderUnread().finally(() => { if (!cancelled) timer = setTimeout(poll, 5000) })
    }
    timer = setTimeout(poll, 5000)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('click', onClick, true)
      clearBadges()
    }
  }, [])

  return null
}

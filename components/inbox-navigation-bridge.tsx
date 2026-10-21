'use client'

import { useEffect } from 'react'

export function InboxNavigationBridge() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const tagsButton = target?.closest('button[aria-label="Tags"]')
      if (!tagsButton) return
      event.preventDefault()
      event.stopPropagation()
      window.location.assign('/tags')
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  return null
}

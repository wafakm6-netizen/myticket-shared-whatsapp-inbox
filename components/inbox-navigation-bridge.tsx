'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function InboxNavigationBridge() {
  const router = useRouter()

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const tagsButton = target?.closest('button[aria-label="Tags"]')
      if (!tagsButton) return
      event.preventDefault()
      event.stopPropagation()
      router.push('/tags')
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [router])

  return null
}

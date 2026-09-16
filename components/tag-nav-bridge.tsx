'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function TagNavBridge() {
  const router = useRouter()

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest('button[aria-label="Tags"]')
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      router.push('/tags')
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [router])

  return null
}

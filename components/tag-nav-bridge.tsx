'use client'

import { useEffect, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

export function TagNavBridge() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest('button[aria-label="Tags"]')
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(true)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  if (!open) return null

  return (
    <div className="tag-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="tag-manager-modal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
        <div className="tag-manager-modal-header">
          <div className="tag-manager-heading">
            <span className="tag-manager-icon"><Tag size={18} /></span>
            <div><p>WORKSPACE</p><h2 id="tag-manager-title">Tags</h2></div>
          </div>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close tags"><X size={18} /></button>
        </div>
        <p className="tag-manager-description">Create, edit and delete reusable labels for conversations.</p>
        <div className="tag-manager-content"><TagManager /></div>
      </section>
    </div>
  )
}

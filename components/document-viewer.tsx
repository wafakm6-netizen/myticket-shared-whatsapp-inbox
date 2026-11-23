'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, Share, X } from 'lucide-react'

// Full-screen document viewer for the iOS app, where links that open a new tab do nothing.
// PDFs are drawn page by page with pdf.js (pinch, double-tap or +/- to zoom); other files are shown in a frame.
export function DocumentViewer({ url, name, pdf, onClose }: { url: string; name: string; pdf?: boolean; onClose: () => void }) {
  const isPdf = pdf ?? /\.pdf$/i.test(name)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(isPdf ? 'loading' : 'ready')
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.documentElement.classList.add('document-viewer-open')
    return () => { window.removeEventListener('keydown', onKey); document.documentElement.classList.remove('document-viewer-open') }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error('unavailable')
        const data = await response.arrayBuffer()
        if (cancelled) return
        setFile(new File([data], name, { type: response.headers.get('content-type') || 'application/octet-stream' }))
        if (!isPdf) return
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
        if (cancelled) return
        setPageCount(pdf.numPages)
        const holder = pagesRef.current
        if (!holder) return
        holder.innerHTML = ''
        // Sharp up to about 2.5x zoom on a 3x screen without using too much memory.
        const target = Math.min(2400, (holder.clientWidth || 360) * Math.min(3, window.devicePixelRatio || 1) * 1.6)
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: target / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(viewport.width)
          canvas.height = Math.round(viewport.height)
          canvas.className = 'document-viewer-page'
          canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
          holder.appendChild(canvas)
          await page.render({ canvas, viewport }).promise
          if (number === 1 && !cancelled) setState('ready')
        }
      } catch {
        if (!cancelled) setState('error')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [url, name, isPdf])

  // Pinch to zoom (the app itself is not zoomable) and double-tap to toggle 1x / 2x, keeping the touched point in place.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !isPdf) return
    let pinch: { dist: number; zoom: number; midX: number; midY: number; left: number; top: number } | null = null
    let lastTap = 0
    const dist = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const applyZoom = (next: number, clientX: number, clientY: number, from: { zoom: number; left: number; top: number }) => {
      const value = Math.min(4, Math.max(1, next))
      const rect = scroller.getBoundingClientRect()
      const x = clientX - rect.left, y = clientY - rect.top
      const ratio = value / from.zoom
      setZoom(value)
      requestAnimationFrame(() => { scroller.scrollLeft = (from.left + x) * ratio - x; scroller.scrollTop = (from.top + y) * ratio - y })
    }
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch = { dist: dist(event.touches), zoom: zoomRef.current, midX: (event.touches[0].clientX + event.touches[1].clientX) / 2, midY: (event.touches[0].clientY + event.touches[1].clientY) / 2, left: scroller.scrollLeft, top: scroller.scrollTop }
      } else if (event.touches.length === 1) {
        const now = Date.now()
        if (now - lastTap < 280) {
          event.preventDefault()
          const touch = event.touches[0]
          applyZoom(zoomRef.current > 1 ? 1 : 2, touch.clientX, touch.clientY, { zoom: zoomRef.current, left: scroller.scrollLeft, top: scroller.scrollTop })
          lastTap = 0
        } else lastTap = now
      }
    }
    const onMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      applyZoom(pinch.zoom * dist(event.touches) / pinch.dist, pinch.midX, pinch.midY, pinch)
    }
    const onEnd = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null }
    scroller.addEventListener('touchstart', onStart, { passive: false })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd)
    scroller.addEventListener('touchcancel', onEnd)
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', onEnd)
    }
  }, [isPdf])

  const canShare = Boolean(file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] }))
  const share = async () => { if (file) { try { await navigator.share({ files: [file], title: name }) } catch {} } }
  const step = (delta: number) => {
    const scroller = scrollRef.current
    if (!scroller) return setZoom((value) => Math.min(4, Math.max(1, value + delta)))
    const rect = scroller.getBoundingClientRect()
    const next = Math.min(4, Math.max(1, zoom + delta)), ratio = next / zoom
    const x = rect.width / 2, y = rect.height / 2, left = scroller.scrollLeft, top = scroller.scrollTop
    setZoom(next)
    requestAnimationFrame(() => { scroller.scrollLeft = (left + x) * ratio - x; scroller.scrollTop = (top + y) * ratio - y })
  }

  return createPortal(
    <div className="document-viewer" role="dialog" aria-modal="true" aria-label={name}>
      <header className="document-viewer-bar">
        <button type="button" className="document-viewer-btn" onClick={onClose} aria-label="Close"><X size={22} /></button>
        <div className="document-viewer-title"><strong dir="auto">{name}</strong>{pageCount > 0 && <span>{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>}</div>
        {canShare && <button type="button" className="document-viewer-btn" onClick={() => void share()} aria-label="Share or save"><Share size={20} /></button>}
      </header>
      <div className="document-viewer-scroll" ref={scrollRef}>
        {isPdf
          ? <div className="document-viewer-pages" ref={pagesRef} style={{ width: `${zoom * 100}%` }} />
          : <iframe className="document-viewer-frame" src={url} title={name} />}
        {state === 'loading' && <p className="document-viewer-status">Opening…</p>}
        {state === 'error' && <p className="document-viewer-status">This document could not be opened.</p>}
      </div>
      {isPdf && state === 'ready' && <div className="document-viewer-zoom">
        <button type="button" onClick={() => step(-0.5)} disabled={zoom <= 1} aria-label="Zoom out"><Minus size={18} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => step(0.5)} disabled={zoom >= 4} aria-label="Zoom in"><Plus size={18} /></button>
      </div>}
    </div>,
    document.body,
  )
}

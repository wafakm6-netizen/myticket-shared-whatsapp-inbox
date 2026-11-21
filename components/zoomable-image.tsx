'use client'

import { useEffect, useRef, useState } from 'react'

// Full-screen photo like WhatsApp: pinch or double-tap to zoom, drag to pan when zoomed, swipe down to close.
// Gestures are handled here, so the page itself can stay non-zoomable in the iOS app.
type Point = { x: number; y: number }

export function ZoomableImage({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [animate, setAnimate] = useState(false)
  const [dismiss, setDismiss] = useState(0)
  const viewRef = useRef(view)
  viewRef.current = view
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ startDist: number; startScale: number; startMid: Point; startView: { scale: number; x: number; y: number }; start: Point; moved: boolean } | null>(null)
  const lastTap = useRef(0)

  useEffect(() => { setView({ scale: 1, x: 0, y: 0 }); setDismiss(0) }, [src])

  const clampScale = (value: number) => Math.min(5, Math.max(1, value))
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  const begin = () => {
    const points = [...pointers.current.values()]
    const v = viewRef.current
    if (points.length >= 2) gesture.current = { startDist: distance(points[0], points[1]), startScale: v.scale, startMid: midpoint(points[0], points[1]), startView: v, start: points[0], moved: true }
    else if (points.length === 1) gesture.current = { startDist: 0, startScale: v.scale, startMid: points[0], startView: v, start: points[0], moved: false }
  }

  const onPointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setAnimate(false)
    begin()
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (!g) return
    const points = [...pointers.current.values()]
    if (points.length >= 2 && g.startDist > 0) {
      const scale = clampScale(g.startScale * (distance(points[0], points[1]) / g.startDist))
      const mid = midpoint(points[0], points[1])
      setView({ scale, x: g.startView.x + (mid.x - g.startMid.x), y: g.startView.y + (mid.y - g.startMid.y) })
      return
    }
    const dx = points[0].x - g.start.x, dy = points[0].y - g.start.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true
    if (g.startView.scale > 1) setView({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy })
    else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) setDismiss(dy)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    const g = gesture.current
    if (pointers.current.size) { begin(); return }
    gesture.current = null
    setAnimate(true)
    if (viewRef.current.scale <= 1.02) {
      if (dismiss > 120) { onClose(); return }
      setDismiss(0)
      setView({ scale: 1, x: 0, y: 0 })
    }
    if (g && !g.moved) {
      const now = Date.now()
      if (now - lastTap.current < 300) {
        lastTap.current = 0
        const zoomed = viewRef.current.scale > 1
        setView(zoomed ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 })
      } else lastTap.current = now
    }
  }

  return (
    <div
      className="zoomable-image"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={(event) => { setAnimate(false); setView((v) => { const scale = clampScale(v.scale * (event.deltaY < 0 ? 1.12 : 0.89)); return scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...v, scale } }) }}
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', overflow: 'hidden', opacity: dismiss ? Math.max(0.35, 1 - dismiss / 400) : 1 }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ maxWidth: '100vw', maxHeight: '88vh', objectFit: 'contain', userSelect: 'none', pointerEvents: 'none', transform: `translate(${view.x}px, ${view.y + dismiss}px) scale(${view.scale})`, transition: animate ? 'transform .2s ease-out' : 'none', willChange: 'transform' }}
      />
    </div>
  )
}

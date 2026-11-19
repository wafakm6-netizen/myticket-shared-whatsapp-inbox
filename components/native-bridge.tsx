'use client'

import { useEffect } from 'react'

// Runs only inside the Myticket Inbox iOS app (Capacitor shell). In Safari and on desktop it does nothing,
// so the web inbox keeps behaving exactly as before. Plugins are reached through window.Capacitor, which the
// shell injects, so the web app needs no Capacitor packages of its own.
type Plugins = Record<string, any>
declare global { interface Window { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Plugins } } }

export function NativeBridge() {
  useEffect(() => {
    const cap = window.Capacitor
    if (!cap?.isNativePlatform?.()) return
    const plugins = cap.Plugins || {}
    const html = document.documentElement
    html.dataset.native = cap.getPlatform?.() || 'native'

    // iOS has no navigator.vibrate, so the inbox's swipe-to-reply and long-press cues were silent. Route them to the Taptic Engine.
    const haptics = plugins.Haptics
    if (haptics) {
      navigator.vibrate = ((pattern: VibratePattern) => {
        const ms = Array.isArray(pattern) ? pattern[0] || 0 : pattern || 0
        haptics.impact({ style: ms >= 20 ? 'MEDIUM' : 'LIGHT' }).catch(() => {})
        return true
      }) as Navigator['vibrate']
    }

    // No pinch zoom in the app, like WhatsApp.
    const viewport = document.querySelector('meta[name="viewport"]')
    if (viewport && !/user-scalable=no/.test(viewport.getAttribute('content') || '')) viewport.setAttribute('content', (viewport.getAttribute('content') || '') + ', user-scalable=no')

    // Hide the "< > Done" bar iOS puts above the keyboard.
    plugins.Keyboard?.setAccessoryBarVisible?.({ isVisible: false }).catch?.(() => {})

    // Status bar text follows the inbox's own Light/Dark choice.
    const statusBar = plugins.StatusBar
    const syncStatusBar = () => statusBar?.setStyle?.({ style: html.dataset.theme === 'dark' ? 'DARK' : 'LIGHT' }).catch?.(() => {})
    syncStatusBar()
    const observer = new MutationObserver(syncStatusBar)
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] })

    // Light tap feedback on primary buttons (send, tabs), as in WhatsApp.
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.('.send-btn, .mobile-tab, .forward-send, button[aria-label="Send message"], button[aria-label^="Save internal note"]')
      if (target) haptics?.impact?.({ style: 'LIGHT' }).catch?.(() => {})
    }
    document.addEventListener('click', onClick, true)

    return () => { observer.disconnect(); document.removeEventListener('click', onClick, true) }
  }, [])
  return null
}

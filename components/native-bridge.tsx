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

    const cleanups: Array<() => void> = []
    const listen = (plugin: any, event: string, handler: (data: any) => void) => {
      const handle = plugin?.addListener?.(event, handler)
      cleanups.push(() => { Promise.resolve(handle).then((h: any) => h?.remove?.()).catch(() => {}) })
    }

    // Keep the newest message in view while the keyboard opens, like WhatsApp.
    listen(plugins.Keyboard, 'keyboardDidShow', () => {
      const thread = document.querySelector('.app-shell.mobile-chat-open .thread') as HTMLElement | null
      if (thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 400) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' })
    })

    // "Connecting…" bar when the phone loses the internet, instead of things silently failing.
    const banner = document.createElement('div')
    banner.className = 'native-offline-banner'
    banner.textContent = 'Connecting…'
    document.body.appendChild(banner)
    const setOnline = (online: boolean) => { html.dataset.offline = online ? '' : '1'; if (online) delete html.dataset.offline }
    const onOnline = () => setOnline(true), onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
    setOnline(navigator.onLine)
    cleanups.push(() => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); banner.remove() })

    // Native push (APNs). The device token is saved for the signed-in agent; tapping a notification opens its chat.
    const push = plugins.PushNotifications
    const saveToken = (token: string) => {
      try { localStorage.setItem('native-push-token', token) } catch {}
      fetch('/api/notifications/apns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token }) }).catch(() => {})
    }
    const registerPush = async () => {
      if (!push || html.dataset.session !== '1') return
      try {
        let status = await push.checkPermissions()
        if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') status = await push.requestPermissions()
        if (status.receive === 'granted') await push.register()
      } catch {}
    }
    listen(push, 'registration', (token: { value: string }) => token?.value && saveToken(token.value))
    listen(push, 'pushNotificationActionPerformed', (action: any) => {
      const url = action?.notification?.data?.url
      if (typeof url === 'string') { try { const target = new URL(url, location.origin); if (target.origin === location.origin) location.assign(target.pathname + target.search) } catch {} }
    })
    registerPush()
    // Screen transitions start after launch so the first paint does not slide in.
    const settle = window.setTimeout(() => { html.dataset.navigated = '1'; registerPush() }, 1500)
    cleanups.push(() => window.clearTimeout(settle))
    // Re-register when the app comes back to the foreground (e.g. after signing in or allowing notifications in Settings).
    listen(plugins.App, 'appStateChange', (state: { isActive: boolean }) => { if (state?.isActive) registerPush() })

    return () => { observer.disconnect(); document.removeEventListener('click', onClick, true); cleanups.forEach((fn) => fn()) }
  }, [])
  return null
}

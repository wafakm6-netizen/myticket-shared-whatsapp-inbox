import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { TagNavBridge } from '@/components/tag-nav-bridge'
import { UnreadBridge } from '@/components/unread-bridge'
import { NotificationBridge } from '@/components/notification-bridge'
import './globals.css'
import './new-conversation.css'
import './dark-theme.css'
import './dark-theme-overrides.css'

export const metadata: Metadata = { title: 'Myticket Shared Inbox', description: 'A separate WhatsApp shared inbox for the Myticket support team.', generator: 'v0.app', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Myticket Inbox', statusBarStyle: 'default' }, icons: { icon: [{ url: '/brand/favicon-48.png?v=3', type: 'image/png', sizes: '48x48' }, { url: '/brand/app-icon-192.png?v=3', type: 'image/png', sizes: '192x192' }], shortcut: '/brand/favicon-48.png?v=3', apple: [{ url: '/brand/apple-touch-icon.png?v=4', sizes: '180x180' }] } }
// maximumScale stops iOS Safari auto-zooming into focused fields; iOS still allows pinch zoom.
// The theme colour (phone status bar) is set by the head script so it follows the inbox's Light/Dark choice, not only the phone's setting.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, interactiveWidget: 'resizes-content' }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="bg-white" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "(function(){try{var p=localStorage.getItem('inbox-theme')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);window.__applyTheme=function(d){var h=document.documentElement;h.dataset.theme=d?'dark':'light';h.style.colorScheme=d?'dark':'light';var m=document.getElementById('theme-color');if(!m){m=document.createElement('meta');m.id='theme-color';m.name='theme-color';document.head.appendChild(m)}m.content=d?'#161d25':'#ffffff'};window.__applyTheme(d);var k=Object.keys(localStorage).some(function(x){return /^sb-.*-auth-token/.test(x)});if(k||/(^|;\\s*)sb-[^=]*-auth-token/.test(document.cookie))document.documentElement.dataset.session='1'}catch(e){}})()" }} /></head><body className="antialiased"><TagNavBridge/><UnreadBridge/><NotificationBridge/>{children}{process.env.NODE_ENV === 'production' && <Analytics/>}</body></html> }

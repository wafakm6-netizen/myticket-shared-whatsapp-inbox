import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { TagNavBridge } from '@/components/tag-nav-bridge'
import { UnreadBridge } from '@/components/unread-bridge'
import { NotificationBridge } from '@/components/notification-bridge'
import './globals.css'
import './new-conversation.css'

export const metadata: Metadata = { title: 'Myticket Shared Inbox', description: 'A separate WhatsApp shared inbox for the Myticket support team.', generator: 'v0.app', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Myticket Inbox', statusBarStyle: 'default' }, icons: { icon: [{ url: '/brand/favicon-48.png?v=3', type: 'image/png', sizes: '48x48' }, { url: '/brand/app-icon-192.png?v=3', type: 'image/png', sizes: '192x192' }], shortcut: '/brand/favicon-48.png?v=3', apple: [{ url: '/brand/apple-touch-icon.png?v=4', sizes: '180x180' }] } }
// maximumScale stops iOS Safari auto-zooming into focused fields; iOS still allows pinch zoom.
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#ffffff', width: 'device-width', initialScale: 1, maximumScale: 1, interactiveWidget: 'resizes-content' }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="bg-white"><body className="antialiased"><TagNavBridge/><UnreadBridge/><NotificationBridge/>{children}{process.env.NODE_ENV === 'production' && <Analytics/>}</body></html> }

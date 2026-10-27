import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google'

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400','500','600','700'], display: 'swap', variable: '--font-plex-latin' })
const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400','500','600','700'], display: 'swap', variable: '--font-plex-arabic' })
import { TagNavBridge } from '@/components/tag-nav-bridge'
import { UnreadBridge } from '@/components/unread-bridge'
import { NotificationBridge } from '@/components/notification-bridge'
import './globals.css'
import './new-conversation.css'

export const metadata: Metadata = { title: 'Myticket Shared Inbox', description: 'A separate WhatsApp shared inbox for the Myticket support team.', generator: 'v0.app', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Myticket Inbox', statusBarStyle: 'default' }, icons: { icon: [{ url: '/brand/myticket-icon.png?v=2', type: 'image/png' }], shortcut: '/brand/myticket-icon.png?v=2', apple: '/brand/myticket-icon.png?v=2' } }
// maximumScale stops iOS Safari auto-zooming into focused fields; iOS still allows pinch zoom.
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#ffffff', width: 'device-width', initialScale: 1, maximumScale: 1 }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="bg-white"><body className={`${plex.variable} ${plexArabic.variable} antialiased`}><TagNavBridge/><UnreadBridge/><NotificationBridge/>{children}{process.env.NODE_ENV === 'production' && <Analytics/>}</body></html> }

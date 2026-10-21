import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], display: 'swap' })
import { TagNavBridge } from '@/components/tag-nav-bridge'
import { UnreadBridge } from '@/components/unread-bridge'
import { NotificationBridge } from '@/components/notification-bridge'
import './globals.css'
import './new-conversation.css'

export const metadata: Metadata = { title: 'Myticket Shared Inbox', description: 'A separate WhatsApp shared inbox for the Myticket support team.', generator: 'v0.app', icons: { icon: [{ url: '/favicon-myticket.svg', type: 'image/svg+xml' }], shortcut: '/favicon-myticket.svg', apple: '/apple-icon.png' } }
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#ffffff' }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="bg-white"><body className={`${inter.className} antialiased`}><TagNavBridge/><UnreadBridge/><NotificationBridge/>{children}{process.env.NODE_ENV === 'production' && <Analytics/>}</body></html> }

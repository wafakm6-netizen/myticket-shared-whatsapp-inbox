import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { TagNavBridge } from '@/components/tag-nav-bridge'
import { ConversationTagBridge } from '@/components/conversation-tag-bridge'
import './globals.css'
import './new-conversation.css'

export const metadata: Metadata = { title: 'Myticket Shared Inbox', description: 'A separate WhatsApp shared inbox for the Myticket support team.', generator: 'v0.app', icons: { icon: [{ url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' }, { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' }, { url: '/icon.svg', type: 'image/svg+xml' }], apple: '/apple-icon.png' } }
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#ffffff' }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="bg-white"><body className="antialiased"><TagNavBridge/><ConversationTagBridge/>{children}{process.env.NODE_ENV === 'production' && <Analytics/>}</body></html> }

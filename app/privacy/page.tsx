import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | Myticket WhatsApp Shared Inbox',
  description: 'Privacy information for the Myticket WhatsApp Shared Inbox.',
}

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#fafbfc', color: '#253247', padding: '48px 20px', fontFamily: 'Arial, sans-serif' }}>
      <article style={{ maxWidth: 780, margin: '0 auto', background: '#fff', border: '1px solid #e8edf1', borderRadius: 18, padding: 'clamp(24px, 5vw, 52px)', lineHeight: 1.75 }}>
        <Link href="/" style={{ color: '#f4512d', textDecoration: 'none', fontSize: 14 }}>← Back to Myticket Shared Inbox</Link>
        <h1 style={{ fontSize: 32, marginTop: 24, marginBottom: 4 }}>Privacy Policy</h1>
        <p style={{ color: '#718096', fontSize: 14, marginBottom: 30 }}>Myticket WhatsApp Shared Inbox · Last updated October 16, 2026</p>
        <p>This policy describes how Myticket Oman, operated by BEYOND VENTURE MODERN, processes personal information in its WhatsApp Shared Inbox, a workspace used by authorized support staff to communicate with customers and business contacts.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>1. Information we process</h2>
        <p>When the service is used, we may process WhatsApp phone numbers, contact names, message text, attachments, message timestamps, delivery information, conversation assignments, internal support notes, and customer-service tags. For authorized team members, we process account details such as names, work email addresses, roles, and sign-in information needed to control access.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>2. How we use information</h2>
        <p>We use this information to respond to enquiries, manage support conversations, assign work to team members, maintain service continuity, secure the workspace, and troubleshoot technical issues. We do not use this inbox to sell personal information.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>3. WhatsApp and service providers</h2>
        <p>Messages sent or received through WhatsApp are also subject to WhatsApp and Meta's applicable terms and privacy practices. The inbox uses hosting and database infrastructure to operate the service, including Vercel and Supabase. Authorized service providers may process data only as needed to provide the relevant services.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>4. Access and security</h2>
        <p>Access to the inbox is intended for authorized Myticket personnel. We use account authentication and access controls to help protect information. No online service can guarantee absolute security.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>5. Retention</h2>
        <p>We retain information for as long as reasonably needed to operate customer support, meet legitimate business needs, resolve disputes, and comply with applicable legal obligations. Retention may vary by the type of record and the reason it is held.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>6. Your privacy choices and deletion requests</h2>
        <p>You may request access to, correction of, or deletion of personal information associated with your conversations, subject to applicable legal and operational requirements. To submit a request, contact Myticket through its official website at <a href="https://myticketom.com/" style={{ color: '#f4512d' }}>myticketom.com</a> or through the Myticket WhatsApp business number, +968 7117 8817. Please explain your request so we can identify the relevant information and respond appropriately.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>7. Changes to this policy</h2>
        <p>We may update this policy as our service or legal obligations change. The updated version will be posted here with a revised date.</p>

        <h2 style={{ fontSize: 20, marginTop: 30 }}>8. Contact</h2>
        <p>Myticket Oman (BEYOND VENTURE MODERN), Sultanate of Oman. Website: <a href="https://myticketom.com/" style={{ color: '#f4512d' }}>https://myticketom.com/</a>.</p>
      </article>
    </main>
  )
}

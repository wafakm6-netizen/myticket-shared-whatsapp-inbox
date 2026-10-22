# First-incoming-message notifications

The WhatsApp webhook sends **one browser push and one email per customer/supplier conversation** until a Myticket agent sends a reply successfully accepted by Meta. Subsequent inbound messages before that reply do not send new alerts.

Recipients: assigned active agent, or active Administrators if the conversation is unassigned. No alert is sent for outbound messages. A separate notification cycle is maintained for each conversation. Duplicate Meta webhook message IDs are ignored.

## Required Vercel Production environment variables

- `RESEND_API_KEY`: Resend API key for a verified sending domain
- `NOTIFICATION_FROM_EMAIL`: verified sender, e.g. `Myticket <alerts@your-verified-domain>`
- `WEB_PUSH_VAPID_PUBLIC_KEY`: P-256 uncompressed public key, base64url encoded
- `WEB_PUSH_VAPID_PRIVATE_KEY`: matching 32-byte P-256 private key, base64url encoded
- `WEB_PUSH_SUBJECT`: `mailto:your-team-email@your-domain`
- `NEXT_PUBLIC_APP_URL`: `https://whatsapp.myticketom.com` (optional; this is the fallback)

Generate a VAPID keypair using Node.js locally:

```js
const {createECDH}=require('node:crypto');
const e=createECDH('prime256v1');e.generateKeys();
console.log('WEB_PUSH_VAPID_PUBLIC_KEY='+e.getPublicKey(undefined,'uncompressed').toString('base64url'));
console.log('WEB_PUSH_VAPID_PRIVATE_KEY='+e.getPrivateKey().toString('base64url'));
```

Keep the private key secret. Configure these variables in Vercel, redeploy, then each agent signs in, opens **Account Settings → Enable browser notifications**, and grants browser permission. Email alerts use the agent's email from the Team account.

Browser push works when the tab is closed if the browser/OS supports service-worker push and has not blocked notifications. Push delivery is subject to the browser provider and device settings. Resend email delivery requires a verified sender domain.

The Supabase database contains `whatsapp_notification_cycles`, `whatsapp_push_subscriptions`, and `whatsapp_notification_events` with RLS enabled. Notification delivery errors are logged and do not reject inbound WhatsApp webhooks.

Note: delivery currently occurs inline in the webhook request; a durable background queue/retry mechanism is recommended before high-volume production usage.

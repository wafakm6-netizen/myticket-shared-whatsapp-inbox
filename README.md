# Myticket Shared Inbox

A separate WhatsApp shared inbox for the Myticket support team. This project is intentionally independent from Myticket bookings, products, payments, customer databases, and CRM systems.

## Deploy to Vercel

1. Import `wafakm6-netizen/Myticket-Shared-Inbox` into Vercel.
2. Use `main` as the production branch.
3. Add the variables from `.env.example` in Vercel Project Settings → Environment Variables.
4. Deploy. GitHub pushes to `main` will create production deployments.

The demo inbox UI works without credentials. WhatsApp sending and webhook verification require Meta test credentials.

## Meta WhatsApp setup

In Meta for Developers, open your WhatsApp app and configure Webhooks:

- Callback URL: `https://YOUR-VERCEL-DOMAIN.vercel.app/api/webhooks/whatsapp`
- Verify Token: the exact value used for `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the `messages` webhook field

The GET route validates Meta's `hub.mode`, `hub.verify_token`, and `hub.challenge`. The POST route acknowledges webhook payloads quickly and is structured for later persistence.

To send a message, the server route accepts `{ "to": "968...", "text": "Hello" }` at `/api/send`. Access tokens are only read on the server and are never included in frontend code.

## Future production setup

Do not connect the real Myticket WhatsApp number until Meta credentials, permissions, webhook subscriptions, and a separate PostgreSQL database have been reviewed. The future custom callback URL is:

`https://inbox.myticket.om/api/webhooks/whatsapp`

When persistence is needed, add PostgreSQL tables for `contacts`, `conversations`, `messages`, `agents`, `assignments`, and `notes`, then replace the demo state with server-side queries. Keep every query scoped to the inbox workspace and add Admin/Agent authentication before exposing multi-agent controls.

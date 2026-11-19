# Myticket Inbox API (v1)

For systems that work with the shared inbox: the myticket.om platform (booking confirmations), the AI assistant, and team tools.
Everything goes through the inbox, so the team sees every message and change in the chat, attributed to the client's own agent.

Base URL: `https://whatsapp.myticketom.com/api/v1`

## Authentication

Every request sends an API key:

```
Authorization: Bearer mti_...
```

Each key belongs to one client, acts as one agent (a row in `whatsapp_agents`, e.g. "myticket.om" or "AI Assistant"), and only has the scopes it was given. API clients are never admins.

| Scope | Allows |
|---|---|
| `conversations:read` | List conversations, read a conversation and its messages |
| `conversations:write` | Change status, assignment and tags |
| `messages:send` | Send messages and templates, list templates |
| `notes:write` | Add internal notes (team only, never sent to the customer) |
| `agents:read` | List team members |

### Creating a key (admin)

1. Create an agent for the client in the inbox (Team), e.g. "myticket.om". Copy its id.
2. Run `node scripts/create-api-key.mjs myticket-platform <agent-id> messages:send conversations:read notes:write`.
3. Give the printed key to the client once. Add the printed JSON object to the `INBOX_API_KEYS` array in Vercel (Production) and redeploy.

Only the SHA-256 of each key is stored. To revoke a key, remove its object from `INBOX_API_KEYS` and redeploy.

## Endpoints

### Send a message — `POST /messages` (`messages:send`)

```json
{ "to": "96891234567", "text": "مرحبا! تم تأكيد حجزك." }
```

or by conversation, or as a WhatsApp template (required when the customer has not written in the last 24 hours):

```json
{ "conversation_id": "…", "template": { "name": "booking_confirmed", "languageCode": "ar", "parameters": ["محمد", "مهرجان صلالة", "8:00 م"] } }
```

Optional: `reply_to_message_id`. Returns the inbox's send result.

### List templates — `GET /templates` (`messages:send`)

### List conversations — `GET /conversations` (`conversations:read`)

Query: `status` (open | pending | closed), `phone` (digits, e.g. 96891234567), `limit` (≤100, default 50), `before` (use `next_before` from the previous page).
Each conversation has its `contact` and `last_message` only.

### Read a conversation — `GET /conversations/:id` (`conversations:read`)

Query: `limit` (≤200, default 50), `before` (page back with `next_before`). Messages are oldest → newest; includes `contact` and `tags`.

### Update a conversation — `PATCH /conversations/:id` (`conversations:write`)

```json
{ "status": "pending", "assigned_agent_id": "…", "add_tags": ["Refund", "Urgent"], "remove_tags": ["Solved"] }
```

Tags by name (case-insensitive) or id; unknown names in `add_tags` are rejected.

### Add an internal note — `POST /conversations/:id/notes` (`notes:write`)

```json
{ "body": "Booking #4821 — 2 tickets, Salalah Festival, paid." }
```

### List team members — `GET /agents` (`agents:read`)

## Events (webhooks out)

The inbox POSTs events to the URLs in `INBOX_WEBHOOKS` (Vercel):

```json
[{ "url": "https://ai.myticketom.com/inbox-events", "secret": "<long random secret>", "events": ["message.received"] }]
```

`message.received` — a customer sent a message:

```json
{ "id": "…", "type": "message.received", "created_at": "…",
  "data": { "conversation_id": "…", "message_id": "wamid…", "type": "text", "from": "96891234567", "contact_name": "…", "body": "…", "assigned_agent_id": null } }
```

Headers: `X-Inbox-Event`, `X-Inbox-Delivery` (unique id; ignore repeats), `X-Inbox-Signature: sha256=<HMAC-SHA256 of the raw body with your secret>`. Always verify the signature.
Delivery is best-effort with a 5-second timeout and never affects the inbox; to catch anything missed, read `GET /conversations`.

## Errors

JSON `{ "error": "…" }` with 400 (bad input), 401 (missing/invalid key), 403 (missing scope), 404, 503 (temporarily unavailable).

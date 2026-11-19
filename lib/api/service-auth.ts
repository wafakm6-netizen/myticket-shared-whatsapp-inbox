import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { AuthAgent } from '@/lib/auth'
import { serviceAgentContext } from '@/lib/api/context'

// API clients (myticket.om, the AI assistant, team tools) are configured in the INBOX_API_KEYS env var:
// [{"name":"myticket-platform","keyHash":"<sha256 hex of the key>","agentId":"<whatsapp_agents.id>","scopes":["messages:send"]}]
// Only the SHA-256 of each key is stored. Create keys with: node scripts/create-api-key.mjs
export type Scope = 'conversations:read' | 'conversations:write' | 'messages:send' | 'notes:write' | 'agents:read'
type ApiClient = { name: string; keyHash: string; agentId: string; scopes: Scope[] }

function configuredClients(): ApiClient[] {
  try {
    const parsed = JSON.parse(process.env.INBOX_API_KEYS || '[]')
    return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.keyHash === 'string' && typeof c.agentId === 'string' && Array.isArray(c.scopes)) : []
  } catch { console.error('[api] INBOX_API_KEYS is not valid JSON'); return [] }
}

export const apiError = (status: number, error: string) => NextResponse.json({ error }, { status })

export type ApiCaller = { client: string; agent: AuthAgent }
export async function authenticate(request: NextRequest, scope: Scope): Promise<{ caller: ApiCaller; error?: undefined } | { caller?: undefined; error: Response }> {
  const header = request.headers.get('authorization') || ''
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!key) return { error: apiError(401, 'Missing API key. Send "Authorization: Bearer <key>".') }
  const hash = createHash('sha256').update(key).digest()
  let match: ApiClient | undefined
  for (const client of configuredClients()) {
    const stored = Buffer.from(client.keyHash, 'hex')
    if (stored.length === hash.length && timingSafeEqual(stored, hash)) match = client
  }
  if (!match) return { error: apiError(401, 'Invalid API key.') }
  if (!match.scopes.includes(scope)) return { error: apiError(403, `This key does not have the "${scope}" scope.`) }
  const { data: agent, error } = await createServerSupabaseClient().from('whatsapp_agents').select('id, is_active, display_name, email').eq('id', match.agentId).maybeSingle()
  if (error || !agent?.is_active) return { error: apiError(503, 'The agent linked to this API key is missing or inactive.') }
  // API clients always act as a normal agent, never an admin.
  return { caller: { client: match.name, agent: { ...agent, role: 'agent' } as AuthAgent } }
}

// Run one of the inbox's existing route handlers as the API client's agent, with a fresh JSON request.
export async function asAgent(caller: ApiCaller, handler: (request: NextRequest) => Promise<Response>, url: string, method: string, body?: unknown) {
  const request = new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return serviceAgentContext.run(caller.agent, () => handler(request))
}

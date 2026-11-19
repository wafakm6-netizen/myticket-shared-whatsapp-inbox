import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthAgent } from '@/lib/auth'

// Set only while a /api/v1 request runs with a valid API key. lib/auth.ts reads it, so the inbox's own routes
// (send, assign, tags, notes) act on behalf of that API client's bot agent. Never set anywhere else, so an
// API key cannot open the inbox's other routes.
export const serviceAgentContext = new AsyncLocalStorage<AuthAgent>()

import { NextRequest } from 'next/server'
import { authenticate, asAgent, apiError } from '@/lib/api/service-auth'
import { POST as addNote } from '@/app/api/inbox/route'

// POST /api/v1/conversations/:id/notes  { body }  Internal note the team sees (never sent to the customer).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticate(request, 'notes:write'); if (error) return error
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (typeof body?.body !== 'string' || !body.body.trim()) return apiError(400, 'body is required.')
  return asAgent(caller, addNote, `${new URL(request.url).origin}/api/inbox`, 'POST', { conversationId: id, body: body.body.slice(0, 4000) })
}

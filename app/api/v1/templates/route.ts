import { NextRequest } from 'next/server'
import { authenticate, asAgent } from '@/lib/api/service-auth'
import { GET as listTemplates } from '@/app/api/whatsapp-templates/route'

// GET /api/v1/templates  Approved WhatsApp templates that can be sent with POST /api/v1/messages.
export async function GET(request: NextRequest) {
  const { caller, error } = await authenticate(request, 'messages:send'); if (error) return error
  return asAgent(caller, () => listTemplates(), `${new URL(request.url).origin}/api/whatsapp-templates`, 'GET')
}

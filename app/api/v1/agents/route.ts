import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { authenticate, apiError } from '@/lib/api/service-auth'

// GET /api/v1/agents  Active team members, for assigning conversations.
export async function GET(request: NextRequest) {
  const { error } = await authenticate(request, 'agents:read'); if (error) return error
  const { data, error: dbError } = await createServerSupabaseClient().from('whatsapp_agents').select('id, display_name, availability').eq('is_active', true).order('display_name')
  if (dbError) return apiError(503, 'Agents are unavailable.')
  return NextResponse.json({ agents: data ?? [] })
}

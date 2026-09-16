import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const colors = ['gray','red','orange','yellow','green','blue','purple']
const validColor = (value: unknown) => typeof value === 'string' && colors.includes(value) ? value : 'orange'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const conversationId = new URL(request.url).searchParams.get('conversationId')
    const { data: tags, error } = await supabase.from('whatsapp_tags').select('id, name, color, created_at, created_by').order('name')
    if (error) throw error
    const { data: assignments, error: assignmentError } = await supabase.from('whatsapp_conversation_tags').select('conversation_id, tag_id, created_at, assigned_by')
    if (assignmentError) throw assignmentError
    return NextResponse.json({ tags: tags ?? [], assignments: conversationId ? (assignments ?? []).filter((item) => item.conversation_id === conversationId) : assignments ?? [] })
  } catch (error) { console.error('[tags] load failed', error); return NextResponse.json({ error: 'Tags are unavailable.' }, { status: 503 }) }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json(); const supabase = createServerSupabaseClient()
    if (body.conversationId && body.tagId) { const { data, error } = await supabase.from('whatsapp_conversation_tags').upsert({ conversation_id: body.conversationId, tag_id: body.tagId, assigned_by: body.agentId || null }, { onConflict: 'conversation_id,tag_id' }).select().single(); if (error) throw error; return NextResponse.json({ assignment: data }) }
    if (!body.name?.trim()) return NextResponse.json({ error: 'Tag name is required.' }, { status: 400 })
    const { data, error } = await supabase.from('whatsapp_tags').insert({ name: body.name.trim(), color: validColor(body.color), created_by: body.agentId || null }).select().single(); if (error) throw error; return NextResponse.json({ tag: data })
  } catch (error: any) { console.error('[tags] create failed', error); if (error?.code === '23505') return NextResponse.json({ error: 'A tag with this name already exists.' }, { status: 409 }); return NextResponse.json({ error: 'Tag could not be created.' }, { status: 500 }) }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json(); if (!body.id || !body.name?.trim()) return NextResponse.json({ error: 'Tag and name are required.' }, { status: 400 })
    const supabase = createServerSupabaseClient(); const { data, error } = await supabase.from('whatsapp_tags').update({ name: body.name.trim(), color: validColor(body.color) }).eq('id', body.id).select().single(); if (error) throw error; return NextResponse.json({ tag: data })
  } catch (error: any) { console.error('[tags] update failed', error); if (error?.code === '23505') return NextResponse.json({ error: 'A tag with this name already exists.' }, { status: 409 }); return NextResponse.json({ error: 'Tag could not be updated.' }, { status: 500 }) }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json(); const supabase = createServerSupabaseClient()
    if (body.conversationId && body.tagId) { const { error } = await supabase.from('whatsapp_conversation_tags').delete().eq('conversation_id', body.conversationId).eq('tag_id', body.tagId); if (error) throw error; return NextResponse.json({ removed: true }) }
    if (!body.id) return NextResponse.json({ error: 'Tag id is required.' }, { status: 400 }); const { error } = await supabase.from('whatsapp_tags').delete().eq('id', body.id); if (error) throw error; return NextResponse.json({ deleted: true })
  } catch (error) { console.error('[tags] delete failed', error); return NextResponse.json({ error: 'Tag could not be deleted.' }, { status: 500 }) }
}

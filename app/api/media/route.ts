import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const mediaId = new URL(request.url).searchParams.get('mediaId')
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!mediaId || !token) return NextResponse.json({ error: 'Media is unavailable.' }, { status: 404 })
  try {
    const graph = process.env.META_GRAPH_VERSION ?? 'v23.0'
    const metadataResponse = await fetch(`https://graph.facebook.com/${graph}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const metadata = await metadataResponse.json().catch(() => null)
    if (!metadataResponse.ok || typeof metadata?.url !== 'string') return NextResponse.json({ error: 'Media is unavailable.' }, { status: 404 })
    const mediaResponse = await fetch(metadata.url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!mediaResponse.ok || !mediaResponse.body) return NextResponse.json({ error: 'Media is unavailable.' }, { status: 404 })
    return new NextResponse(mediaResponse.body, { headers: { 'Content-Type': metadata.mime_type || 'application/octet-stream', 'Cache-Control': 'private, max-age=300' } })
  } catch (error) {
    console.error('[media] download failed', error)
    return NextResponse.json({ error: 'Media is unavailable.' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File) || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'A file up to 15 MB is required.' }, { status: 400 })
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type)) return NextResponse.json({ error: 'Only images and documents are supported.' }, { status: 400 })
    const supabase = createServerSupabaseClient()
    const path = `outbox/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error } = await supabase.storage.from('whatsapp-media').upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })
    if (error) throw error
    const { data: signed, error: signedError } = await supabase.storage.from('whatsapp-media').createSignedUrl(path, 60 * 60)
    if (signedError) throw signedError
    return NextResponse.json({ url: signed.signedUrl, path, name: file.name, type: file.type })
  } catch (error) {
    console.error('[media] upload failed', error)
    return NextResponse.json({ error: 'Media upload failed. Create the private whatsapp-media bucket first.' }, { status: 500 })
  }
} 

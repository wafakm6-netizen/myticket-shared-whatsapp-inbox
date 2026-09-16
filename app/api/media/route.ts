import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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

import { createServerSupabaseClient } from '@/lib/supabase/server'

// WhatsApp only keeps media for about 30 days, and fetching it live is slow, so every sticker, photo, voice note
// and file is copied once into a private Supabase Storage bucket and served from there afterwards.
const BUCKET = 'whatsapp-media'
let bucketReady: Promise<void> | null = null

function storageKey(mediaId: string) {
  return `meta/${mediaId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const storage = createServerSupabaseClient().storage
      const { data } = await storage.getBucket(BUCKET)
      if (!data) {
        const { error } = await storage.createBucket(BUCKET, { public: false })
        if (error && !/exist/i.test(error.message)) throw error
      }
    })().catch((error) => { bucketReady = null; throw error })
  }
  return bucketReady
}

export async function readCachedMedia(mediaId: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    await ensureBucket()
    const { data, error } = await createServerSupabaseClient().storage.from(BUCKET).download(storageKey(mediaId))
    if (error || !data) return null
    return { bytes: new Uint8Array(await data.arrayBuffer()), type: data.type || 'application/octet-stream' }
  } catch {
    return null
  }
}

export async function storeCachedMedia(mediaId: string, bytes: Uint8Array, type: string) {
  try {
    await ensureBucket()
    await createServerSupabaseClient().storage.from(BUCKET).upload(storageKey(mediaId), bytes, { contentType: type, upsert: true, cacheControl: '31536000' })
  } catch (error) {
    console.error('[media-cache] store failed', error)
  }
}

// Download from WhatsApp (two requests: metadata, then the file).
export async function fetchMetaMedia(mediaId: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) return null
  const graph = process.env.META_GRAPH_VERSION ?? 'v23.0'
  const metadataResponse = await fetch(`https://graph.facebook.com/${graph}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const metadata = await metadataResponse.json().catch(() => null)
  if (!metadataResponse.ok || typeof metadata?.url !== 'string') return null
  const mediaResponse = await fetch(metadata.url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!mediaResponse.ok) return null
  return { bytes: new Uint8Array(await mediaResponse.arrayBuffer()), type: metadata.mime_type || mediaResponse.headers.get('content-type') || 'application/octet-stream' }
}

// Cached copy first; otherwise fetch from WhatsApp and keep a copy for next time.
export async function getMedia(mediaId: string) {
  const cached = await readCachedMedia(mediaId)
  if (cached) return cached
  const fresh = await fetchMetaMedia(mediaId)
  if (fresh) await storeCachedMedia(mediaId, fresh.bytes, fresh.type)
  return fresh
}

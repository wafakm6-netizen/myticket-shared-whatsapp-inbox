'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { Archive, Bell, Check, ChevronDown, CircleHelp, FileText, Inbox, Menu, Mic, Square, MoreHorizontal, Paperclip, Search, Send, Settings, Smile, Tag, Users, X } from 'lucide-react'

type Status = 'open' | 'pending' | 'closed'
type Agent = { id: string; display_name: string; email?: string; auth_user_id?: string; role?: 'admin' | 'agent'; availability?: 'available' | 'away' | 'offline'; is_active?: boolean; whatsapp_conversations?: { id: string; status: Status; whatsapp_contacts?: { display_name?: string; phone?: string } }[] }
type Message = { id: string; from: 'customer' | 'agent'; text: string; time: string; status?: string; attachmentUrl?: string; attachmentName?: string }
type Conversation = { id: string; name: string; initials: string; color: string; type: 'Customer' | 'Supplier'; phone: string; preview: string; time: string; unread: number; status: Status; assignedTo: string | null; agentName?: string; messages: Message[]; notes: { id: string; body: string; time: string; agentName: string }[] }
type SavedReply = { id: string; title: string; body: string }

const colors = ['#ff5a1f', '#d9774a', '#ff8b5c', '#b94d25']

const avatarPalettes = [
  ['#0e624a', '#30dc82'], ['#214f98', '#8bc5ff'], ['#6639aa', '#d5b2ff'],
  ['#9a3d52', '#ffb5c4'], ['#995315', '#ffcf83'], ['#087f83', '#8cf4e6'],
  ['#3e5976', '#b3d7f8'], ['#8e3b29', '#ffbaa0'],
]

function ContactAvatar({ phone, className = '' }: { phone: string; className?: string }) {
  const hash = Array.from(phone || 'unknown').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7)
  const [background, foreground] = avatarPalettes[hash % avatarPalettes.length]
  return <div className={`avatar ${className}`} style={{ backgroundColor: background }} aria-label="Default contact profile image">
    <svg viewBox="0 0 48 48" width="62%" height="62%" aria-hidden="true" focusable="false" style={{ display: 'block', margin: 'auto' }}>
      <circle cx="24" cy="16" r="8" fill={foreground} />
      <path d="M9 39c0-8 6.7-13 15-13s15 5 15 13v2H9z" fill={foreground} />
    </svg>
  </div>
}

function displayPhone(phone: string) {
  const cleaned = (phone || '').trim()
  if (!cleaned) return ''
  if (cleaned.startsWith('+')) return cleaned
  const digits = cleaned.replace(/[^\d]/g, '')
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  if (digits.startsWith('968') && digits.length === 11) return '+' + digits
  if (digits.startsWith('1') && digits.length === 11) return '+' + digits
  if (digits.length === 8 && /^[79]/.test(digits)) return '+968 ' + digits
  return cleaned
}


const dialingCountries = [["🇴🇲","Oman","+968"],["🇦🇪","United Arab Emirates","+971"],["🇸🇦","Saudi Arabia","+966"],["🇶🇦","Qatar","+974"],["🇧🇭","Bahrain","+973"],["🇰🇼","Kuwait","+965"],["🇺🇸","United States","+1"],["🇨🇦","Canada","+1"],["🇬🇧","United Kingdom","+44"],["🇮🇳","India","+91"],["🇵🇰","Pakistan","+92"],["🇪🇬","Egypt","+20"],["🇯🇴","Jordan","+962"],["🇱🇧","Lebanon","+961"],["🇲🇦","Morocco","+212"],["🇩🇪","Germany","+49"],["🇫🇷","France","+33"],["🇹🇷","Türkiye","+90"],["🇵🇭","Philippines","+63"],["🇧🇩","Bangladesh","+880"],["🇮🇩","Indonesia","+62"],["🇲🇾","Malaysia","+60"],["🇦🇺","Australia","+61"],["🇨🇳","China","+86"],["🇯🇵","Japan","+81"],["🇿🇦","South Africa","+27"],["🇳🇵","Nepal","+977"],["🇱🇰","Sri Lanka","+94"],["🇸🇬","Singapore","+65"],["🇮🇹","Italy","+39"],["🇪🇸","Spain","+34"],["🇳🇱","Netherlands","+31"],["🇧🇷","Brazil","+55"],["🇲🇽","Mexico","+52"]]

export default function Page() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'open' | 'pending' | 'closed'>('all')
  const [query, setQuery] = useState('')
  const [editingContact, setEditingContact] = useState(false)
  const [contactNameDraft, setContactNameDraft] = useState('')
  const [contactTypeDraft, setContactTypeDraft] = useState<'customer' | 'supplier'>('customer')
  const [contactSaveBusy, setContactSaveBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageSendError, setMessageSendError] = useState('')
  const sendInProgress = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const previousThread = useRef<{ id: string; count: number } | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiSearch, setEmojiSearch] = useState('')
  const [emojiCategory, setEmojiCategory] = useState('recent')
  const [noteDraft, setNoteDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [activeNav, setActiveNav] = useState<'inbox' | 'team' | 'replies' | 'tags'>('inbox')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recordingStartedRef = useRef(0)
  useEffect(() => { if (!recording) return; const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordingStartedRef.current) / 1000)), 500); return () => window.clearInterval(timer) }, [recording])
  useEffect(() => () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()) }, [])
  const clearVoice = () => { setVoiceFile(null); setVoicePreviewUrl(url => { if (url) URL.revokeObjectURL(url); return null }) }
  const startVoiceRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Audio recording is not supported in this browser.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const supported = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
      if (!supported) { stream.getTracks().forEach(track => track.stop()); throw new Error('This browser cannot record a WhatsApp-compatible audio format. Update Chrome to the latest version or try Safari.') }
      const recorder = new MediaRecorder(stream, { mimeType: supported })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setRecording(false)
        if (!chunks.length) return
        const mime = recorder.mimeType.split(';')[0] || 'audio/webm'
        const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'
        const file = new File(chunks, `voice-${Date.now()}.${extension}`, { type: mime })
        setVoiceFile(file)
        setVoicePreviewUrl(url => { if (url) URL.revokeObjectURL(url); return URL.createObjectURL(file) })
      }
      recorderRef.current = recorder
      setMessageSendError('')
      clearVoice()
      setRecordingSeconds(0)
      recordingStartedRef.current = Date.now()
      recorder.start()
      setRecording(true)
    } catch (error) {
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      const kind = error instanceof DOMException ? error.name : (error as { name?: string } | null)?.name
      const details = error instanceof Error ? error.message : String(error)
      console.error('[voice] microphone failed', { name: kind, message: details, secureContext: window.isSecureContext, embedded: window.self !== window.top })
      if (kind === 'NotAllowedError' || kind === 'PermissionDeniedError' || kind === 'SecurityError') {
        const embedded = window.self !== window.top
        const policy = (document as Document & { permissionsPolicy?: { allowsFeature: (name: string) => boolean }; featurePolicy?: { allowsFeature: (name: string) => boolean } }).permissionsPolicy ?? (document as Document & { featurePolicy?: { allowsFeature: (name: string) => boolean } }).featurePolicy
        const policyAllowsMic = policy?.allowsFeature('microphone')
        let permissionState = 'unknown'
        try { permissionState = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state } catch { /* unsupported */ }
        console.info('[voice] microphone diagnostics', { permissionState, policyAllowsMic, embedded, origin: window.location.origin })
        if (policyAllowsMic === false) {
          setMessageSendError('Microphone is blocked by this page’s Permissions-Policy. The website deployment must allow microphone=(self).')
          return
        }
        if (permissionState === 'denied') {
          setMessageSendError('Chrome reports microphone permission DENIED for ' + window.location.origin + '. Click the site controls icon beside the address bar → Site settings → Microphone → Allow, then close and reopen this tab.')
          return
        }
        setMessageSendError(embedded
          ? 'Microphone blocked by the embedded browser or iframe. Open whatsapp.myticketom.com in a normal Chrome tab and allow microphone access.'
          : 'Chrome blocked microphone access (NotAllowedError). Open Chrome Site settings for this website, reset microphone permission, then reload. If already allowed, check chrome://settings/content/microphone and your Windows microphone privacy settings.')
      } else if (kind === 'NotFoundError' || kind === 'DevicesNotFoundError') {
        setMessageSendError('No microphone was detected. Connect or enable a microphone, then try again.')
      } else if (kind === 'NotReadableError' || kind === 'TrackStartError') {
        setMessageSendError('The microphone is busy or unavailable. Close other recording apps and try again.')
      } else {
        setMessageSendError(`Microphone error (${kind || 'unknown'}): ${details}`)
      }
    }
  }
  const stopVoiceRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }
  const sendVoiceMessage = async () => {
    if (!voiceFile || !selected || sendInProgress.current) return
    sendInProgress.current = true
    setSendingMessage(true)
    setMessageSendError('')
    try {
      setVoiceProcessing(true)
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      const { toBlobURL, fetchFile } = await import('@ffmpeg/util')
      const ffmpeg = new FFmpeg()
      const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        const inputName = voiceFile.name.endsWith('.ogg') ? 'input.ogg' : voiceFile.name.endsWith('.m4a') ? 'input.m4a' : 'input.webm'
        await ffmpeg.writeFile(inputName, await fetchFile(voiceFile))
        const exitCode = await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', 'voice.ogg'])
        if (exitCode !== 0) throw new Error('Audio conversion failed. Please try recording again.')
        const converted = await ffmpeg.readFile('voice.ogg')
        if (!(converted instanceof Uint8Array) || converted.byteLength < 128) throw new Error('Audio conversion produced an invalid file.')
        // Verify that FFmpeg can demux and fully decode the generated Ogg/Opus stream.
        // -xerror makes decoding warnings fatal; -f null checks all audio packets.
        const decodeExit = await ffmpeg.exec(['-v', 'error', '-xerror', '-i', 'voice.ogg', '-map', '0:a:0', '-f', 'null', '-'])
        if (decodeExit !== 0) throw new Error('The converted voice recording cannot be decoded. Please record again.')
        // Verify decoded audio actually contains samples (a valid header alone is insufficient).
        const pcmExit = await ffmpeg.exec(['-v', 'error', '-xerror', '-i', 'voice.ogg', '-map', '0:a:0', '-t', '1', '-ac', '1', '-ar', '16000', '-f', 's16le', 'voice-check.pcm'])
        if (pcmExit !== 0) throw new Error('The voice recording contains invalid audio packets. Please record again.')
        const decodedSamples = await ffmpeg.readFile('voice-check.pcm')
        if (!(decodedSamples instanceof Uint8Array) || decodedSamples.byteLength < 3200) throw new Error('The recording is too short or contains no decodable audio.')
        const ogg = new File([new Uint8Array(converted)], 'voice.ogg', { type: 'audio/ogg' })
        const media = await uploadAttachment(ogg)
        if (!media.mediaId) throw new Error('Voice upload did not return a media ID.')
        setVoiceProcessing(false)
        const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, to: selected.phone, text: '', mediaId: media.mediaId }) })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Voice message could not be sent.')
        clearVoice()
        await load()
      } finally { ffmpeg.terminate() }
    } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Voice message could not be sent.') }
    finally { sendInProgress.current = false; setSendingMessage(false); setVoiceProcessing(false) }
  }

  const [isLoading, setIsLoading] = useState(true)
  const [sessionUser, setSessionUser] = useState<{ email?: string; role?: string; agentId?: string } | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [newConversationBusy, setNewConversationBusy] = useState(false)
  const [newConversationError, setNewConversationError] = useState('')
  const [newConversationName, setNewConversationName] = useState('')
  const [newConversationPhone, setNewConversationPhone] = useState('')
  const [newConversationCountry, setNewConversationCountry] = useState('+968')
  const [newConversationMessage, setNewConversationMessage] = useState('')
  const [newConversationTemplate, setNewConversationTemplate] = useState('')
  const [teamOpen, setTeamOpen] = useState(false)
  const [teamAgents, setTeamAgents] = useState<Agent[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [teamError, setTeamError] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [selfAvailability, setSelfAvailability] = useState<'available' | 'away' | 'offline'>('available')
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([])
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false)
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false)
  const [savedReplySearch, setSavedReplySearch] = useState('')
  const [savedReplyBusy, setSavedReplyBusy] = useState(false)
  const [savedReplyError, setSavedReplyError] = useState('')
  const [savedReplyTitle, setSavedReplyTitle] = useState('')
  const [savedReplyBody, setSavedReplyBody] = useState('')
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)
  const [newAgentTemporaryPassword, setNewAgentTemporaryPassword] = useState('')
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentEmail, setNewAgentEmail] = useState('')
  const attachmentInput = useRef<HTMLInputElement>(null)
  const messageInput = useRef<HTMLTextAreaElement>(null)
  const selected = selectedId ? conversations.find((item) => item.id === selectedId) : undefined

  const load = async () => {
    const response = await fetch('/api/inbox', { cache: 'no-store' })
    if (!response.ok) throw new Error('Inbox unavailable')
    const payload = await response.json()
    const rows: Conversation[] = (payload.conversations ?? []).map((row: any, index: number) => {
      const contact = Array.isArray(row.whatsapp_contacts) ? row.whatsapp_contacts[0] : row.whatsapp_contacts
      const messages = [...(row.whatsapp_messages ?? [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const notes = [...(Array.isArray(row.whatsapp_internal_notes) ? row.whatsapp_internal_notes : [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = messages.at(-1)
      const rawName = typeof contact?.display_name === 'string' ? contact.display_name.trim() : ''
      const name = rawName && rawName !== '.' ? rawName : (displayPhone(contact?.phone || '') || 'WhatsApp contact')
      const assignedAgent = Array.isArray(row.whatsapp_agents) ? row.whatsapp_agents[0] : row.whatsapp_agents
      return { id: row.id, name, initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(), color: colors[index % colors.length], type: contact?.contact_type === 'supplier' ? 'Supplier' : 'Customer', phone: contact?.phone || '', preview: last?.body || last?.attachment_name || '', time: last?.created_at ? new Date(last.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', unread: Number(row.unread_count) || 0, status: row.status, assignedTo: row.assigned_agent_id, agentName: assignedAgent?.display_name, messages: messages.map((message: any) => ({ id: message.id, from: message.direction === 'outbound' ? 'agent' : 'customer', text: message.body || (message.attachment_name ? '' : 'Message'), time: new Date(message.created_at || message.sent_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: message.status, attachmentUrl: message.attachment_url, attachmentName: message.attachment_name })), notes: notes.map((note: any) => { const noteAgent = Array.isArray(note.whatsapp_agents) ? note.whatsapp_agents[0] : note.whatsapp_agents; return { id: note.id, body: note.body, time: new Date(note.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), agentName: noteAgent?.display_name || 'Agent' } }) }
    })
    setConversations(rows)
    setAgents(payload.agents ?? [])
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null)
  }

  useEffect(() => {
    let active = true
    const supabase = createBrowserSupabaseClient()
    if (!supabase) { setIsLoading(false); return }
    let channel: ReturnType<ReturnType<typeof createBrowserSupabaseClient>['channel']> | undefined
    const loadAuthenticatedInbox = async (user: { id: string; email?: string }) => {
      const agentResponse = await fetch('/api/inbox', { cache: 'no-store' })
      const agentPayload = agentResponse.ok ? await agentResponse.json() : { agents: [] }
      const agent = (agentPayload.agents ?? []).find((item: Agent) => item.auth_user_id === user.id || item.email?.toLowerCase() === user.email?.toLowerCase())
      if (!active) return
      setSessionUser({ email: user.email, agentId: agent?.id, role: agent?.role || 'agent' })
      setSelfAvailability(agent?.availability === 'away' ? 'away' : 'available')
      await load()
      if (!active) return
      try { channel = supabase.channel('whatsapp-inbox').on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations' }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_internal_notes' }, () => void load()).subscribe() } catch (error) { console.error('[v0] realtime failed', error) }
    }
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      if (data.user) await loadAuthenticatedInbox(data.user)
    }).catch((error) => { console.error('[v0] auth load failed', error) }).finally(() => { if (active) setIsLoading(false) })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session?.user) void loadAuthenticatedInbox(session.user).finally(() => { if (active) setIsLoading(false) })
      else { setSessionUser(null); setConversations([]); setSelectedId(null); setIsLoading(false); if (channel) void channel.unsubscribe() }
    })
    return () => { active = false; if (channel) void channel.unsubscribe() }
  }, [])

  // Keep incoming WhatsApp messages visible even when Supabase Realtime is unavailable.
  useEffect(() => {
    if (!sessionUser) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load().catch((error) => console.error('[inbox] refresh failed', error))
    }, 5000)
    return () => window.clearInterval(interval)
  }, [sessionUser?.email])

  const counts = useMemo(() => ({ all: conversations.length, unassigned: conversations.filter((item) => !item.assignedTo).length, open: conversations.filter((item) => item.status === 'open').length, pending: conversations.filter((item) => item.status === 'pending').length, closed: conversations.filter((item) => item.status === 'closed').length }), [conversations])
  const visible = useMemo(() => conversations.filter((item) => { const matchesFilter = filter === 'all' || (filter === 'unassigned' ? !item.assignedTo : item.status === filter); return matchesFilter && `${item.name} ${item.phone} ${item.preview}`.toLowerCase().includes(query.toLowerCase()) }), [conversations, filter, query])
  const filteredSavedReplies = useMemo(() => savedReplies.filter((reply) => `${reply.title} ${reply.body}`.toLowerCase().includes(savedReplySearch.toLowerCase())), [savedReplies, savedReplySearch])
  const updateConversation = async (patch: Record<string, string | null>) => { if (!selected) return; const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, patch }) }); if (!response.ok) throw new Error('Conversation update failed'); await load() }
  const startContactEdit = () => { if (!selected) return; setContactNameDraft(selected.name); setContactTypeDraft(selected.type.toLowerCase() as 'customer' | 'supplier'); setEditingContact(true) }
  const saveContact = async () => { if (!selected || !contactNameDraft.trim()) return; setContactSaveBusy(true); try { const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, contactPatch: { display_name: contactNameDraft, contact_type: contactTypeDraft } }) }); if (!response.ok) throw new Error('Contact update failed'); setEditingContact(false); await load() } finally { setContactSaveBusy(false) } }
  const loadSavedReplies = async () => { const response = await fetch('/api/saved-replies', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Saved replies unavailable'); setSavedReplies(payload.replies ?? []) }
  const openSavedReplies = async () => { setActiveNav('replies'); setSavedRepliesOpen(true); setQuickRepliesOpen(false); setSavedReplyError(''); try { await loadSavedReplies() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Saved replies unavailable') } }
  const openQuickReplies = async () => { const next = !quickRepliesOpen; setQuickRepliesOpen(next); setSavedReplySearch(''); if (next) { setSavedReplyError(''); try { await loadSavedReplies() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Saved replies unavailable') } } }
  const saveSavedReply = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setSavedReplyBusy(true); setSavedReplyError(''); try { const response = await fetch('/api/saved-replies', { method: editingReplyId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(editingReplyId ? { id: editingReplyId } : {}), title: savedReplyTitle, body: savedReplyBody }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Reply could not be saved.'); await loadSavedReplies(); setSavedReplyTitle(''); setSavedReplyBody(''); setEditingReplyId(null) } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Reply could not be saved.') } finally { setSavedReplyBusy(false) } }
  const beginEditSavedReply = (reply: SavedReply) => { setEditingReplyId(reply.id); setSavedReplyTitle(reply.title); setSavedReplyBody(reply.body) }
  const cancelEditSavedReply = () => { setEditingReplyId(null); setSavedReplyTitle(''); setSavedReplyBody('') }
  const deleteSavedReply = async (id: string) => { setSavedReplyBusy(true); try { const response = await fetch('/api/saved-replies', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!response.ok) throw new Error('Reply could not be deleted.'); setSavedReplies((current) => current.filter((reply) => reply.id !== id)); if (editingReplyId === id) cancelEditSavedReply() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Reply could not be deleted.') } finally { setSavedReplyBusy(false) } }
  const useSavedReply = (reply: SavedReply) => { setDraft(reply.body); setQuickRepliesOpen(false); setSavedReplySearch('') }

  const emojiCategories = [
    { id: 'recent', icon: '◷', label: 'Frequently used', emojis: ['👍','🙏','😀','😍','😘','💜','😆','😅','😜','➕','😊','💯','↗️','💌','🕺','🌍','👋','😂','👌','🥰','🙁','😋'] },
    { id: 'smileys', icon: '☺', label: 'Smileys & People', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😋','😛','😜','🤪','🤗','🤭','🫡','🤔','🫶','👏','🙌','🤝'] },
    { id: 'nature', icon: '♧', label: 'Animals & Nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐸','🐵','🌸','🌹','🌺','🌻','🌴','🌿','🍀','🌍','☀️','🌙','⭐'] },
    { id: 'food', icon: '♨', label: 'Food & Drink', emojis: ['🍏','🍎','🍊','🍋','🍉','🍇','🍓','🍒','🥭','🍕','🍔','🍟','🌮','🍰','🎂','☕','🧃','🥤','🍽️'] },
    { id: 'activity', icon: '◉', label: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🎾','🏐','🎯','🎮','🎨','🎤','🎧','🎬','🎟️','🏆','🥇','🎉','🎊'] },
    { id: 'travel', icon: '✈', label: 'Travel & Places', emojis: ['🚗','🚕','🚌','🚎','🏎️','🚓','🚑','🚒','✈️','🚀','🚁','⛵','🏖️','🏝️','🏕️','🏨','📍','🗺️'] },
    { id: 'objects', icon: '♢', label: 'Objects', emojis: ['⌚','📱','💻','⌨️','🖥️','📷','💡','📞','☎️','📌','📎','✂️','🔒','🔑','🎁','💬','📩','📦'] },
    { id: 'symbols', icon: '♡', label: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💯','✅','❌','⚠️','❓','❗','➕','✨','🔥'] },
  ]
  const emojiSearchPool = emojiCategories.flatMap((category) => category.emojis)
  const shownEmojiCategories = emojiSearch.trim()
    ? [{ id: 'search', icon: '⌕', label: 'Search results', emojis: [...new Set(emojiSearchPool)] }]
    : emojiCategories.filter((category) => emojiCategory === 'recent' ? category.id === 'recent' || category.id === 'smileys' : category.id === emojiCategory)

  const insertEmoji = (emoji: string) => {
    const input = messageInput.current
    if (!input) { setDraft((current) => current + emoji); setEmojiOpen(false); return }
    const start = input.selectionStart ?? draft.length
    const end = input.selectionEnd ?? draft.length
    setDraft(draft.slice(0, start) + emoji + draft.slice(end))
    setEmojiOpen(false)
    requestAnimationFrame(() => { input.focus(); const next = start + emoji.length; input.setSelectionRange(next, next) })
  }

  const uploadAttachment = async (file: File) => { const form = new FormData(); form.append('file', file); const response = await fetch('/api/media', { method: 'POST', body: form }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Media upload failed'); return payload }
  const sendMessage = async () => {
    if (sendInProgress.current || !selected || (!draft.trim() && !attachment)) return
    sendInProgress.current = true
    setSendingMessage(true)
    setMessageSendError('')
    const conversationId = selected.id
    const recipient = selected.phone
    const text = draft.trim()
    const file = attachment
    try {
      let media: any = null
      if (file) media = await uploadAttachment(file)
      const response = await fetch('/api/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, to: recipient, text: text || file?.name || 'Attachment', attachmentUrl: media?.url, attachmentName: media?.name, attachmentType: media?.type })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || payload.message || 'Message could not be sent. Please try again.')
      setDraft((current) => current === text ? '' : current)
      setAttachment((current) => current === file ? null : current)
      setQuickRepliesOpen(false)
      await load()
    } catch (error) {
      setMessageSendError(error instanceof Error ? error.message : 'Message could not be sent. Please try again.')
      console.error('[send] failed', error)
    } finally {
      sendInProgress.current = false
      setSendingMessage(false)
    }
  }
  useEffect(() => {
    const thread = threadRef.current
    if (!thread || !selected) return
    const previous = previousThread.current
    const switched = previous?.id !== selected.id
    const hasNewMessages = !previous || selected.messages.length > previous.count
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140
    if (switched || (hasNewMessages && nearBottom)) {
      requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight })
    }
    previousThread.current = { id: selected.id, count: selected.messages.length }
  }, [selectedId, selected?.messages.length])
  useEffect(() => { setMessageSendError('') }, [selectedId])

  const addNote = async () => { if (!selected || !noteDraft.trim()) return; const response = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, body: noteDraft, agentId: sessionUser?.agentId }) }); if (!response.ok) throw new Error('Note could not be saved'); setNoteDraft(''); await load() }
  const createConversation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNewConversationBusy(true); setNewConversationError('')
    try { const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newConversationName, phone: newConversationCountry + newConversationPhone.replace(/\D/g, '').replace(/^0+/, ''), message: newConversationMessage, template: newConversationTemplate.trim() ? { name: newConversationTemplate.trim() } : undefined }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Conversation could not be created.'); await load(); setSelectedId(payload.conversationId); setDetailsOpen(true); setNewConversationOpen(false); setNewConversationName(''); setNewConversationPhone(''); setNewConversationMessage(''); setNewConversationTemplate('') } catch (error) { setNewConversationError(error instanceof Error ? error.message : 'Conversation could not be created.') } finally { setNewConversationBusy(false) }
  }

  const loadTeam = async () => { const response = await fetch('/api/team', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Team unavailable'); setTeamAgents(payload.agents ?? []) }
  const openTeam = async () => { setActiveNav('team'); setTeamOpen(true); setTeamError(''); try { await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Team unavailable') } }
  const addAgent = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setTeamBusy(true); setTeamError(''); try { const response = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: newAgentName, email: newAgentEmail }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Agent could not be added.'); setNewAgentTemporaryPassword(payload.temporaryPassword || ''); setNewAgentName(''); setNewAgentEmail(''); await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Agent could not be added.') } finally { setTeamBusy(false) } }
  const updateAgent = async (id: string, patch: Record<string, string | boolean>) => { setTeamBusy(true); try { const response = await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Agent could not be updated.'); await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Agent could not be updated.') } finally { setTeamBusy(false) } }
  const updateSelfAvailability = async (availability: 'available' | 'away') => { if (!sessionUser?.agentId) return; const response = await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionUser.agentId, availability }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Availability could not be updated.'); setSelfAvailability(availability); setProfileMenuOpen(false) }
  const signOut = async () => { const supabase = createBrowserSupabaseClient(); if (sessionUser?.agentId) await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionUser.agentId, availability: 'offline' }) }); await supabase?.auth.signOut(); setSessionUser(null); setProfileMenuOpen(false) }

  const signIn = async () => { setAuthBusy(true); setAuthError(''); const supabase = createBrowserSupabaseClient(); if (!supabase) { setAuthError('Supabase authentication is not configured in this preview.'); setAuthBusy(false); return } const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword }); if (error || !data.user) setAuthError(error?.message || 'Invalid email or password.'); else { const agent = agents.find((item) => item.email?.toLowerCase() === data.user.email?.toLowerCase()); setSessionUser({ email: data.user.email, agentId: agent?.id, role: data.user.app_metadata?.role || (agent ? 'agent' : 'admin') }) } setAuthBusy(false) }

  if (isLoading) return <main className="auth-loading-shell" aria-label="Loading inbox"><img className="auth-loading-wordmark" src="/brand/myticket-wordmark.png" alt="Myticket" /><span className="auth-loading-spinner" aria-hidden="true" /></main>
  if (!sessionUser) return <main className="login-shell"><div className="login-bg-orb login-bg-orb-orange" aria-hidden="true" /><div className="login-bg-orb login-bg-orb-green" aria-hidden="true" /><section className="login-card"><div className="login-brand-lockup"><img className="login-brand-lockup-image" src="/brand/myticket-whatsapp-login-logo.png" alt="Myticket" /><div className="login-brand-subtitle">WHATSAPP SHARED INBOX</div></div><div className="login-copy"><div className="login-title-spacer" aria-hidden="true">&nbsp;</div><p className="login-relocated-title">Welcome back</p></div><form className="login-form" onSubmit={(event) => { event.preventDefault(); void signIn() }}><label htmlFor="login-email">EMAIL</label><div className="login-input-wrap"><span className="login-field-icon" aria-hidden="true">✉</span><input id="login-email" aria-label="Email" type="email" placeholder="you@example.com" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required /></div><label htmlFor="login-password">PASSWORD</label><div className="login-input-wrap"><span className="login-field-icon login-lock" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg></span><input id="login-password" aria-label="Password" type="password" placeholder="Enter your password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required /></div><button className="send-btn login-submit" type="submit" disabled={authBusy}>{authBusy ? 'Signing in…' : <>Sign in <span aria-hidden="true">→</span></>}</button></form>{authError && <p className="login-error" role="alert">{authError}</p>}<div className="login-security"><span className="login-check">✓</span><span>Secure shared messaging workspace<br/>for your support team.</span></div></section><p className="login-help">Trouble logging in? <strong>Contact Organization Administrator</strong></p><p className="login-privacy-link"><a href="/privacy">Privacy Policy</a></p><footer className="login-page-footer"><span>© 2026 Myticket. All rights reserved.</span><span>WhatsApp Shared Inbox · Secure team access</span></footer></main>
  return <main className="app-shell">
    <aside className={`rail ${sidebarOpen ? 'rail-open' : ''}`}><div className="brand-mark"><img src="/brand/myticket-whatsapp-login-logo.png" alt="Myticket WhatsApp" /></div><nav aria-label="Primary navigation" className="rail-nav"><button className={`rail-item ${activeNav === 'inbox' ? 'active' : ''}`} aria-label="Inbox" onClick={() => setActiveNav('inbox')}><Inbox size={20} /><span>Inbox</span><b>{conversations.length}</b></button><button className={`rail-item ${activeNav === 'team' ? 'active' : ''}`} aria-label="Team" onClick={() => void openTeam()}><Users size={20} /><span>Team</span></button><button className={`rail-item ${activeNav === 'replies' ? 'active' : ''}`} aria-label="Saved replies" onClick={() => void openSavedReplies()}><FileText size={20} /><span>Replies</span></button><button className={`rail-item ${activeNav === 'tags' ? 'active' : ''}`} aria-label="Tags" onClick={() => setActiveNav('tags')}><Tag size={20} /><span>Tags</span></button></nav><div className="rail-bottom"><button className="rail-item" aria-label="Help"><CircleHelp size={20} /></button><button className="rail-item" aria-label="Settings"><Settings size={20} /></button><div className="profile-menu-wrap"><button className="mini-avatar" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-label="Open agent menu">{sessionUser?.email?.slice(0, 2).toUpperCase() || agents[0]?.display_name?.slice(0, 2).toUpperCase() || 'AG'}</button>{profileMenuOpen && <div className="profile-menu"><strong>{sessionUser?.email || 'Agent'}</strong><span className={`availability-pill ${selfAvailability}`}>{selfAvailability === 'available' ? 'Available' : 'Away'}</span><button onClick={() => void updateSelfAvailability(selfAvailability === 'available' ? 'away' : 'available')}>{selfAvailability === 'available' ? 'Set away' : 'Set available'}</button><button className="logout-button" onClick={() => void signOut()}>Log out</button></div>}</div></div></aside>
    <section className="inbox-pane"><header className="pane-header"><div className="pane-brand-heading"><h1>WHATSAPP SHARED INBOX</h1></div><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button><button className="icon-btn" aria-label="Notifications"><Bell size={18} /><i /></button></header><div className="inbox-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><button className="new-conversation-btn" onClick={() => { setNewConversationOpen(true); setNewConversationError('') }}><span>+</span> New conversation</button></div><div className="filter-tabs" role="tablist"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All <span>{counts.all}</span></button><button className={filter === 'unassigned' ? 'selected' : ''} onClick={() => setFilter('unassigned')}>Unassigned <span>{counts.unassigned}</span></button><button className={filter === 'open' ? 'selected' : ''} onClick={() => setFilter('open')}>Open <span>{counts.open}</span></button></div><div className="conversation-list">{visible.length === 0 ? <p className="empty-list">No conversations yet.</p> : visible.map((conversation) => <button className={`conversation ${conversation.id === selectedId ? 'conversation-selected' : ''}`} data-conversation-id={conversation.id} key={conversation.id} onClick={() => { setSelectedId(conversation.id); setDetailsOpen(true) }}><ContactAvatar phone={conversation.phone} /><div className="conversation-copy"><div className="conversation-top"><strong>{conversation.name}</strong><time>{conversation.time}</time></div><p className="conversation-preview">{conversation.messages.at(-1)?.from === 'agent' && <span className="conversation-preview-ticks" title={conversation.messages.at(-1)?.status || 'sent'} aria-label={conversation.messages.at(-1)?.status || 'sent'}>{conversation.messages.at(-1)?.status === 'read' || conversation.messages.at(-1)?.status === 'delivered' ? <svg width="15" height="11" viewBox="0 0 20 14" fill="none" aria-hidden="true" style={{ color: conversation.messages.at(-1)?.status === 'read' ? '#53b7ef' : '#8896a8', flexShrink: 0 }}><path d="M1.5 7.5 5.4 11.3 12.3 3.2M7.5 7.5 11.4 11.3 18.3 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : conversation.messages.at(-1)?.status === 'failed' ? <span style={{ color: '#c93b35', fontSize: 11 }}>!</span> : <Check size={11} color="#8896a8" aria-hidden="true" />}</span>}<span className="conversation-preview-text">{conversation.preview}</span></p><div className="conversation-bottom"><span className={`status-dot ${conversation.status}`} /><span className={`type-badge ${conversation.type.toLowerCase()}`}>{conversation.type}</span>{conversation.agentName && <span className="assigned-label">{conversation.agentName}</span>}</div></div></button>)}</div></section>
    <section className="chat-pane">{selected ? <><header className="chat-header"><div className="chat-person"><ContactAvatar phone={selected.phone} className="large" /><div><h2>{selected.name}</h2><p><span className="online-dot" /> WhatsApp</p></div></div><div className="chat-actions"><button className="status-select" onClick={() => void updateConversation({ status: selected.status === 'open' ? 'pending' : 'open' })}><span className={`status-dot ${selected.status}`} /> {selected.status}<ChevronDown size={13} /></button><button className="icon-btn" onClick={() => setDetailsOpen(true)} aria-label="Open contact details"><Users size={18} /></button><button className="icon-btn" aria-label="More options"><MoreHorizontal size={18} /></button></div></header><div className="thread" ref={threadRef}><div className="day-divider"><span>Conversation</span></div>{selected.messages.map((message) => <div className={`message-row ${message.from === 'agent' ? 'message-agent' : ''}`} key={message.id}><div className="message-bubble">{message.attachmentUrl && message.attachmentName?.toLowerCase().includes('voice') && <audio controls preload="none" src={message.attachmentUrl} aria-label="Voice message" style={{ maxWidth: '100%', width: 230 }} />}{message.attachmentUrl && !message.attachmentName?.toLowerCase().includes('voice') && <a className="message-attachment" href={message.attachmentUrl} target="_blank" rel="noreferrer">{message.attachmentName || 'Open attachment'}</a>}{message.text && <div>{message.text}</div>}<small>{message.time} {message.from === 'agent' && <span className="message-delivery-status" title={message.status || 'sent'} aria-label={message.status || 'sent'}>{message.status === 'read' || message.status === 'delivered' ? <svg width="15" height="11" viewBox="0 0 20 14" fill="none" aria-hidden="true" style={{ color: message.status === 'read' ? '#53b7ef' : '#8896a8', verticalAlign: 'middle' }}><path d="M1.5 7.5 5.4 11.3 12.3 3.2M7.5 7.5 11.4 11.3 18.3 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : message.status === 'failed' ? <span style={{ color: '#c93b35' }}>Failed</span> : <Check size={11} color="#8896a8" aria-hidden="true" />}</span>}</small></div></div>)}</div><div className="composer-wrap"><div className="composer">{(recording || voiceFile) ? <div className="voice-inline" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '2px 4px', width: '100%' }}>{recording ? <><span style={{ color: '#d92d20', fontSize: 13, flex: 1 }}>● Recording {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span><button type="button" onClick={stopVoiceRecording} aria-label="Stop recording" title="Stop recording"><Square size={16} /></button></> : <><audio controls preload="metadata" src={voicePreviewUrl || undefined} style={{ flex: 1, minWidth: 0, height: 36, width: '100%' }} /><button type="button" onClick={clearVoice} aria-label="Discard recording" title="Discard recording"><X size={16} /></button></>}</div> : <textarea ref={messageInput} aria-label="Message" placeholder="Type a message..." value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!sendingMessage) void sendMessage() } }} />}{attachment && <div className="attachment-chip"><Paperclip size={14} /><span>{attachment.name}</span><button onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={12} /></button></div>}<div className="composer-tools"><div className="composer-left-tools"><input ref={attachmentInput} type="file" hidden onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><button aria-label="Attach file" onClick={() => attachmentInput.current?.click()}><Paperclip size={17} /></button><button type="button" aria-label={recording ? "Stop voice recording" : "Record voice message"} title={recording ? "Stop recording" : "Record voice message"} onClick={() => recording ? stopVoiceRecording() : void startVoiceRecording()} disabled={sendingMessage}><Mic size={17} color={recording ? "#d92d20" : undefined} /></button><div className="emoji-picker-wrap"><button className={emojiOpen ? 'tool-active' : ''} aria-label="Emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((open) => !open)}><Smile size={17} /></button>{emojiOpen && <div className="emoji-picker" role="dialog" aria-label="Emoji picker"><div className="emoji-category-tabs">{emojiCategories.map((category) => <button type="button" key={category.id} className={emojiCategory === category.id ? 'active' : ''} title={category.label} onClick={() => { setEmojiCategory(category.id); setEmojiSearch('') }}>{category.icon}</button>)}</div><div className="emoji-search"><Search size={14}/><input value={emojiSearch} onChange={(event) => setEmojiSearch(event.target.value)} placeholder="Search emoji" aria-label="Search emoji"/></div><div className="emoji-scroll">{shownEmojiCategories.map((category) => <section className="emoji-section" key={category.id}><strong>{category.label}</strong><div className="emoji-grid">{category.emojis.map((emoji, index) => <button type="button" key={emoji + index} onClick={() => insertEmoji(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div></section>)}</div></div>}</div><div className="quick-reply-wrap"><button className={quickRepliesOpen ? 'tool-active' : ''} aria-label="Saved replies" onClick={() => void openQuickReplies()}><FileText size={17} /></button>{quickRepliesOpen && <div className="quick-reply-menu"><div className="quick-reply-heading"><strong>Saved replies</strong><button onClick={() => setQuickRepliesOpen(false)} aria-label="Close saved replies"><X size={14} /></button></div><div className="quick-reply-search"><Search size={13} /><input value={savedReplySearch} onChange={(event) => setSavedReplySearch(event.target.value)} placeholder="Search replies" /></div><div className="quick-reply-options">{filteredSavedReplies.length === 0 ? <p className="quick-reply-empty">No saved replies found.</p> : filteredSavedReplies.map((reply) => <button key={reply.id} onClick={() => useSavedReply(reply)}><strong>{reply.title}</strong><span>{reply.body}</span></button>)}</div><button className="manage-replies-link" onClick={() => void openSavedReplies()}>Manage saved replies</button></div>}</div></div><button className="send-btn" onClick={() => void (voiceFile ? sendVoiceMessage() : sendMessage())} disabled={sendingMessage || recording || (!voiceFile && !draft.trim() && !attachment)} aria-label={sendingMessage ? "Sending message" : "Send"} title={sendingMessage ? "Sending…" : "Send message"}><Send size={16} /></button></div></div>{messageSendError && <p role="alert" style={{ color: "#b42318", fontSize: 12, margin: "6px 12px" }}>{messageSendError}</p>}<p className="composer-hint">Messages are sent through Meta WhatsApp Cloud API.</p></div></> : <div className="empty-thread">Select a conversation</div>}</section>
    {detailsOpen && <aside className="details-pane">{selected ? <><div className="details-title"><p className="eyebrow">CONTACT DETAILS</p><button className="icon-btn" onClick={() => setDetailsOpen(false)} aria-label="Close details" title="Close contact details"><X size={17} /></button></div><div className="profile"><ContactAvatar phone={selected.phone} className="profile-avatar" /><h2>{selected.name}</h2><span className={`type-badge large-badge ${selected.type.toLowerCase()}`}>{selected.type}</span></div><div className="detail-section contact-card"><div className="section-heading"><h3>CONTACT</h3><button onClick={startContactEdit}>Edit</button></div><dl><dt>Phone</dt><dd>{displayPhone(selected.phone)}</dd><dt>Channel</dt><dd><span className="whatsapp-channel-dot" />WhatsApp</dd><dt>Type</dt><dd>{selected.type}</dd></dl></div><div className="detail-section assignment-card"><div className="section-heading"><h3>ASSIGNED TEAM</h3><button><MoreHorizontal size={16} /></button></div><label className="field-label" htmlFor="assignee">Assigned to</label><select id="assignee" value={selected.assignedTo || ''} onChange={(event) => void updateConversation({ assigned_agent_id: event.target.value || null })}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.display_name}</option>)}</select><label className="field-label" htmlFor="status">Conversation status</label><select id="status" value={selected.status} onChange={(event) => void updateConversation({ status: event.target.value })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div><div className="detail-section notes"><div className="section-heading"><h3>Internal notes</h3><button onClick={() => void addNote()}>Add note</button></div><textarea aria-label="Internal note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Keep private context for the support team here." rows={3} />{selected.notes.map((note) => <p key={note.id} className="note-item"><strong>{note.agentName}</strong> · {note.time}<br />{note.body}</p>)}</div><div className="detail-row"><Archive size={16} /><span>Independent WhatsApp inbox</span></div></> : <div className="empty-details">No contact selected</div>}</aside>}
    {savedRepliesOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSavedRepliesOpen(false) }}><section className="conversation-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="saved-replies-title"><div className="modal-header"><div><p className="eyebrow">TEAM LIBRARY</p><h2 id="saved-replies-title">Saved replies</h2></div><button className="icon-btn" onClick={() => { setSavedRepliesOpen(false); cancelEditSavedReply() }} aria-label="Close saved replies"><X size={18} /></button></div><form className="team-add-form saved-reply-form" onSubmit={(event) => void saveSavedReply(event)}><input value={savedReplyTitle} onChange={(event) => setSavedReplyTitle(event.target.value)} placeholder="Title" required /><input value={savedReplyBody} onChange={(event) => setSavedReplyBody(event.target.value)} placeholder="Reply text" required /><button className="send-btn saved-reply-save" type="submit" disabled={savedReplyBusy}>{editingReplyId ? 'Update' : 'Save'}</button>{editingReplyId && <button className="secondary-btn" type="button" onClick={cancelEditSavedReply}>Cancel</button>}</form>{savedReplyError && <p className="login-error" role="alert">{savedReplyError}</p>}<div className="saved-reply-list">{savedReplies.map((reply) => <article className="saved-reply-row" key={reply.id}><div><strong>{reply.title}</strong><p>{reply.body}</p></div><div><button className="secondary-btn" type="button" onClick={() => { setDraft(reply.body); setSavedRepliesOpen(false); cancelEditSavedReply() }}>Use in composer</button><button className="secondary-btn" type="button" disabled={savedReplyBusy} onClick={() => beginEditSavedReply(reply)}>Edit</button><button className="team-toggle" type="button" disabled={savedReplyBusy} onClick={() => void deleteSavedReply(reply.id)}>Delete</button></div></article>)}</div></section></div>}
    {teamOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTeamOpen(false) }}><section className="conversation-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-title"><div className="modal-header"><div><p className="eyebrow">WORKSPACE</p><h2 id="team-title">Team</h2></div><button className="icon-btn" onClick={() => setTeamOpen(false)} aria-label="Close team"><X size={18} /></button></div>{sessionUser?.role === 'admin' && <form className="team-add-form" onSubmit={(event) => void addAgent(event)}><input value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} placeholder="Agent name" required /><input type="email" value={newAgentEmail} onChange={(event) => setNewAgentEmail(event.target.value)} placeholder="Agent email" required /><button className="send-btn" type="submit" disabled={teamBusy}>Add agent</button></form>}{teamError && <p className="login-error" role="alert">{teamError}</p>}{newAgentTemporaryPassword && <p className="temporary-password" role="status">Agent created. Temporary password: <code>{newAgentTemporaryPassword}</code> — copy it now and share it securely.<button onClick={() => setNewAgentTemporaryPassword('')} aria-label="Dismiss temporary password">Dismiss</button></p>}<div className="team-list">{teamAgents.map((agent) => { const assigned = agent.whatsapp_conversations ?? []; return <article className="team-row" key={agent.id}><div className="team-avatar">{agent.display_name.slice(0, 2).toUpperCase()}</div><div className="team-info"><strong>{agent.display_name}</strong><span>{agent.email}</span><small>{assigned.length} assigned conversation{assigned.length === 1 ? '' : 's'}</small></div><select value={agent.availability ?? 'offline'} disabled={sessionUser?.role !== 'admin' || teamBusy} onChange={(event) => void updateAgent(agent.id, { availability: event.target.value })}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select><select value={agent.role ?? 'agent'} disabled={sessionUser?.role !== 'admin' || teamBusy} onChange={(event) => void updateAgent(agent.id, { role: event.target.value })}><option value="agent">Agent</option><option value="admin">Admin</option></select><button className="team-toggle" disabled={sessionUser?.role !== 'admin' || teamBusy} onClick={() => void updateAgent(agent.id, { is_active: !agent.is_active })}>{agent.is_active ? 'Deactivate' : 'Activate'}</button></article> })}</div></section></div>}
    {editingContact && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingContact(false) }}><section className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title"><div className="modal-header"><div><p className="eyebrow">CONTACT DETAILS</p><h2 id="edit-contact-title">Edit contact</h2></div><button className="icon-btn" onClick={() => setEditingContact(false)} aria-label="Close edit contact"><X size={18} /></button></div><div className="conversation-form"><label htmlFor="edit-contact-name">Contact name</label><input id="edit-contact-name" value={contactNameDraft} onChange={(event) => setContactNameDraft(event.target.value)} required /><label htmlFor="edit-contact-type">Type</label><select id="edit-contact-type" value={contactTypeDraft} onChange={(event) => setContactTypeDraft(event.target.value as 'customer' | 'supplier')}><option value="customer">Customer</option><option value="supplier">Supplier</option></select><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setEditingContact(false)}>Cancel</button><button className="send-btn" type="button" disabled={contactSaveBusy} onClick={() => void saveContact()}>{contactSaveBusy ? 'Saving…' : 'Save contact'}</button></div></div></section></div>}
    {newConversationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewConversationOpen(false) }}><section className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title"><div className="modal-header"><div><p className="eyebrow">WHATSAPP</p><h2 id="new-conversation-title">New conversation</h2></div><button className="icon-btn" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation"><X size={18} /></button></div><form className="conversation-form" onSubmit={(event) => void createConversation(event)}><label htmlFor="new-contact-name">Contact name</label><input id="new-contact-name" value={newConversationName} onChange={(event) => setNewConversationName(event.target.value)} placeholder="Contact name" required /><label htmlFor="new-contact-phone">WhatsApp number</label><div className="international-phone-field"><div className="country-code-control"><select aria-label="Country dialing code" value={newConversationCountry} onChange={(event) => setNewConversationCountry(event.target.value)}>{dialingCountries.map(([flag, name, code]) => <option key={name} value={code}>{flag} {code}</option>)}</select><ChevronDown size={15} className="country-code-chevron" aria-hidden="true" /></div><div className="international-phone-input"><span className="phone-input-symbol" aria-hidden="true">☎</span><input id="new-contact-phone" value={newConversationPhone} onChange={(event) => setNewConversationPhone(event.target.value.replace(/[^0-9\s()-]/g, ""))} placeholder="Phone number" inputMode="tel" required /></div></div><label htmlFor="new-first-message">First message</label><textarea id="new-first-message" value={newConversationMessage} onChange={(event) => setNewConversationMessage(event.target.value)} placeholder="Write the first message" rows={4} disabled={Boolean(newConversationTemplate)} required={!newConversationTemplate} /><label htmlFor="new-template">Approved template name <span>(optional)</span></label><input id="new-template" value={newConversationTemplate} onChange={(event) => setNewConversationTemplate(event.target.value)} placeholder="example_template_name" /><p className="form-help">To message someone who has not contacted Myticket in the last 24 hours, you must enter the exact name of an approved Meta WhatsApp template. A normal first message will be rejected. Templates requiring variables are not yet supported by this form.</p>{newConversationError && <p className="login-error" role="alert">{newConversationError}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setNewConversationOpen(false)}>Cancel</button><button className="send-btn" type="submit" disabled={newConversationBusy}>{newConversationBusy ? 'Creating…' : 'Create and send'}</button></div></form></section></div>}
  </main>
}
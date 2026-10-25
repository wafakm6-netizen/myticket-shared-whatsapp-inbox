'use client'

import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { WhatsAppTemplatePicker, type TemplateSelection } from '@/components/whatsapp-template-picker'
import { Archive, Bell, Check, ChevronDown, FileText, MessageSquareCheck, Inbox, Menu, Mic, Pause, Play, Square, MoreHorizontal, Paperclip, Search, Send, Settings, Smile, Tag, Trash2, Users, X } from 'lucide-react'

// Apple-style emoji sprites for a WhatsApp-like picker; Unicode text remains unchanged.
// Keep the original Unicode character for messages; only the picker appearance changes.
function emojiArtworkUrl(emoji: string) {
  const codepoints = Array.from(emoji).map((char) => char.codePointAt(0)!).filter((point) => point !== 0xfe0f)
  return `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/${codepoints.map((point) => point.toString(16)).join('-')}.png`
}

function EmojiArtwork({ emoji }: { emoji: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [emoji])
  return failed ? <span className="emoji-native-fallback">{emoji}</span> : <img className="emoji-artwork" src={emojiArtworkUrl(emoji)} alt="" loading="lazy" onError={() => setFailed(true)} />
}

// Rich-text composer: emoji images are visual only; outgoing messages remain Unicode text.
function EmojiComposer({ value, onChange, onSend, editorRef }: { value: string; onChange: (value: string) => void; onSend: () => void; editorRef: RefObject<HTMLDivElement | null> }) {
  const read = (root: HTMLElement) => {
    let result = ''
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { result += node.textContent || ''; return }
      if (!(node instanceof HTMLElement)) return
      if (node.tagName === 'IMG') { result += node.dataset.emoji || node.getAttribute('alt') || ''; return }
      if (node.tagName === 'BR') { result += '\n'; return }
      const block = node !== root && (node.tagName === 'DIV' || node.tagName === 'P')
      if (block && result && !result.endsWith('\n')) result += '\n'
      node.childNodes.forEach(walk)
    }
    root.childNodes.forEach(walk)
    return result
  }
  const render = (root: HTMLElement, text: string) => {
    root.replaceChildren()
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.segment)
    for (const segment of segments) {
      if (segment === '\n') { root.append(document.createElement('br')); continue }
      if (/\p{Extended_Pictographic}/u.test(segment) || /[\u{1F1E6}-\u{1F1FF}]/u.test(segment)) {
        const img = document.createElement('img')
        img.src = emojiArtworkUrl(segment)
        img.alt = segment
        img.dataset.emoji = segment
        img.className = 'composer-emoji'
        img.draggable = false
        img.addEventListener('error', () => { img.replaceWith(document.createTextNode(segment)) }, { once: true })
        root.append(img)
      } else root.append(document.createTextNode(segment))
    }
  }
  useEffect(() => {
    const root = editorRef.current
    if (root && read(root) !== value) render(root, value)
  }, [value, editorRef])
  const sync = () => { if (editorRef.current) onChange(read(editorRef.current)) }
  return <div ref={editorRef} className="emoji-composer-editor" role="textbox" aria-label="Message" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder="Type a message..." onInput={sync} onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend() } }} />
}

type Status = 'open' | 'pending' | 'closed'
type Agent = { departments?: string[]; id: string; display_name: string; email?: string; auth_user_id?: string; role?: 'admin' | 'agent'; availability?: 'available' | 'away' | 'offline'; is_active?: boolean; whatsapp_conversations?: { id: string; status: Status; whatsapp_contacts?: { display_name?: string; phone?: string } }[] }
type Message = { date: string; id: string; from: 'customer' | 'agent'; text: string; time: string; status?: string; failureReason?: string; attachmentUrl?: string; attachmentName?: string }
type Conversation = { id: string; name: string; initials: string; color: string; type: 'Customer' | 'Supplier'; phone: string; preview: string; time: string; lastMessageAt: string | null; unread: number; status: Status; assignedTo: string | null; agentName?: string; messages: Message[]; notes: { id: string; body: string; time: string; agentName: string }[] }
type SavedReply = { id: string; title: string; body: string }

const colors = ['#ff5a1f', '#d9774a', '#ff8b5c', '#b94d25']

const avatarPalettes = [
  ['#0e624a', '#30dc82'], ['#214f98', '#8bc5ff'], ['#6639aa', '#d5b2ff'],
  ['#9a3d52', '#ffb5c4'], ['#995315', '#ffcf83'], ['#087f83', '#8cf4e6'],
  ['#3e5976', '#b3d7f8'], ['#8e3b29', '#ffbaa0'],
]

function formatConversationListDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMessage = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const daysAgo = Math.round((startOfToday.getTime() - startOfMessage.getTime()) / 86400000)
  if (daysAgo === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (daysAgo === 1) return 'Yesterday'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

function formatChatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function EmojiMessageSegment({ text }: { text: string }) {
  // Keep ordinary text as continuous DOM text nodes. Splitting Arabic into
  // individual grapheme React fragments breaks contextual letter shaping on Safari.
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
  const runs: { text: string; emoji: boolean }[] = []
  for (const segment of graphemes) {
    const emoji = /\p{Extended_Pictographic}/u.test(segment) || /[\u{1F1E6}-\u{1F1FF}]/u.test(segment)
    if (!emoji && runs.length && !runs[runs.length - 1].emoji) runs[runs.length - 1].text += segment
    else runs.push({ text: segment, emoji })
  }
  return <>{runs.map((run, index) => run.emoji
    ? <span className="message-emoji" key={index}><EmojiArtwork emoji={run.text} /></span>
    : <Fragment key={index}>{run.text}</Fragment>)}</>
}

function LinkedMessageText({ text }: { text: string }) {
  const urlPattern = /https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi
  const parts = text.split(/(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi)
  return <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', unicodeBidi: 'plaintext' }}>{parts.map((part, index) => {
    if (!part.match(/^(https?:\/\/|www\.)/i)) return <EmojiMessageSegment key={index} text={part} />
    const trailing = part.match(/[.,!?;:)}\]]+$/)?.[0] || ''
    const urlText = trailing ? part.slice(0, -trailing.length) : part
    let href: string
    try {
      const parsed = new URL(urlText.startsWith('www.') ? 'https://' + urlText : urlText)
      if (!['http:', 'https:'].includes(parsed.protocol)) return part
      href = parsed.href
    } catch { return part }
    return <span key={index}><a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#1767c2', textDecoration: 'underline', textUnderlineOffset: 2, overflowWrap: 'anywhere' }} onClick={(event) => event.stopPropagation()}>{urlText}</a>{trailing}</span>
  })}</div>
}

function VoiceNotePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [speed, setSpeed] = useState(1)
  const bars = useMemo(() => Array.from({ length: 47 }, (_, index) => 5 + Math.round(Math.abs(Math.sin(index * 2.17) * Math.cos(index * 0.61)) * 21)), [])
  const format = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'
  const toggle = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try { await audio.play() } catch { setPlaying(false) }
    } else audio.pause()
  }
  const changeSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }
  const seek = (fraction: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration
    setPosition(audio.currentTime)
  }
  const progress = duration > 0 ? position / duration : 0
  return <div className="myticket-voice-player" style={{ width: 278, maxWidth: '100%', padding: '9px 10px 6px', borderRadius: 13, background: 'transparent', color: '#59616b', boxSizing: 'border-box' }}>
    <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onDurationChange={(event) => setDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(0) }} aria-label="Voice recording" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'} style={{ border: 0, background: 'transparent', color: '#6c747c', width: 29, height: 33, padding: 0, fontSize: 19, cursor: 'pointer', flexShrink: 0 }}>{playing ? '❚❚' : '▶'}</button>
      <div role="slider" tabIndex={0} aria-label="Voice playback position" aria-valuemin={0} aria-valuemax={Math.max(1, Math.floor(duration))} aria-valuenow={Math.floor(position)} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); seek(progress + 5 / (duration || 1)) } if (event.key === 'ArrowLeft') { event.preventDefault(); seek(progress - 5 / (duration || 1)) } }} onClick={(event) => seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2, height: 34, cursor: 'pointer', position: 'relative' }}>
        {bars.map((height, index) => <span key={index} style={{ flex: 1, minWidth: 1, height, borderRadius: 3, background: index / bars.length <= progress ? '#55b5ee' : '#b7bcc1' }} />)}
        <span style={{ position: 'absolute', left: `${progress * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 11, height: 11, borderRadius: '50%', background: '#43b8f5', pointerEvents: 'none' }} />
      </div>
      <button type="button" onClick={changeSpeed} aria-label={`Playback speed ${speed} times. Click to change`} style={{ border: 0, borderRadius: 20, background: '#85898d', color: 'white', fontSize: 11, fontWeight: 700, padding: '5px 9px', cursor: 'pointer', flexShrink: 0 }}>{speed}×</button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 37, paddingRight: 45, fontSize: 11, color: '#879098', lineHeight: '14px' }}><span>{format(position)}</span><span>{format(duration)}</span></div>
  </div>
}

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
  const raw = (phone || '').trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return raw
  // Format for display only. Keep the original E.164 digits for API requests and storage.
  if (/^968[0-9]{8}$/.test(digits)) return `+968 ${digits.slice(3, 7)} ${digits.slice(7)}`
  if (/^49[1-9][0-9]{7,12}$/.test(digits)) return `+49 ${digits.slice(2, 5)} ${digits.slice(5)}`
  if (/^1[0-9]{10}$/.test(digits)) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  if (/^[79][0-9]{7}$/.test(digits)) return `+968 ${digits.slice(0, 4)} ${digits.slice(4)}`
  // Other international numbers: show a clear international prefix without guessing grouping.
  if (digits.length >= 10 && digits.length <= 15) return '+' + digits
  return raw
}

function contactDisplayName(name: string, phone: string) {
  const cleanName = (name || '').trim()
  return !cleanName || cleanName.replace(/\D/g, '') === (phone || '').replace(/\D/g, '')
    ? displayPhone(phone)
    : cleanName
}


const dialingCountries = [["🇴🇲","Oman","+968"],["🇦🇪","United Arab Emirates","+971"],["🇸🇦","Saudi Arabia","+966"],["🇶🇦","Qatar","+974"],["🇧🇭","Bahrain","+973"],["🇰🇼","Kuwait","+965"],["🇺🇸","United States","+1"],["🇨🇦","Canada","+1"],["🇬🇧","United Kingdom","+44"],["🇮🇳","India","+91"],["🇵🇰","Pakistan","+92"],["🇪🇬","Egypt","+20"],["🇯🇴","Jordan","+962"],["🇱🇧","Lebanon","+961"],["🇲🇦","Morocco","+212"],["🇩🇪","Germany","+49"],["🇫🇷","France","+33"],["🇹🇷","Türkiye","+90"],["🇵🇭","Philippines","+63"],["🇧🇩","Bangladesh","+880"],["🇮🇩","Indonesia","+62"],["🇲🇾","Malaysia","+60"],["🇦🇺","Australia","+61"],["🇨🇳","China","+86"],["🇯🇵","Japan","+81"],["🇿🇦","South Africa","+27"],["🇳🇵","Nepal","+977"],["🇱🇰","Sri Lanka","+94"],["🇸🇬","Singapore","+65"],["🇮🇹","Italy","+39"],["🇪🇸","Spain","+34"],["🇳🇱","Netherlands","+31"],["🇧🇷","Brazil","+55"],["🇲🇽","Mexico","+52"]]

export default function Page() {
  // iPadOS Safari keeps the layout viewport tall when the software keyboard
  // appears. Size the fixed inbox to the visible viewport while editing.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const shell = document.documentElement
    const update = () => {
      const editing = document.activeElement instanceof HTMLElement &&
        (document.activeElement.isContentEditable || ['INPUT','TEXTAREA'].includes(document.activeElement.tagName))
      const keyboardVisible = editing && window.innerHeight - viewport.height > 120
      if (keyboardVisible) {
        shell.style.setProperty('--inbox-visual-height', Math.round(viewport.height) + 'px')
        shell.style.setProperty('--inbox-visual-top', Math.round(viewport.offsetTop) + 'px')
      } else {
        shell.style.removeProperty('--inbox-visual-height')
        shell.style.removeProperty('--inbox-visual-top')
      }
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', update)
    update()
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('focusin', update)
      window.removeEventListener('focusout', update)
      shell.style.removeProperty('--inbox-visual-height')
      shell.style.removeProperty('--inbox-visual-top')
    }
  }, [])
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
  const [deleteTarget, setDeleteTarget] = useState<{ conversationId: string; messageId?: string; name: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const sendInProgress = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const previousThread = useRef<{ id: string; count: number } | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiSearch, setEmojiSearch] = useState('')
  const [emojiCategory, setEmojiCategory] = useState('recent')
  const [noteDraft, setNoteDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [openMessageMenu, setOpenMessageMenu] = useState<string | null>(null)
  // Only one transient popover may be open at a time.
  const closeTransientMenus = () => {
    setOpenMessageMenu(null)
    setProfileMenuOpen(false)
    setEmojiOpen(false)
    setQuickRepliesOpen(false)
    setChatTemplateOpen(false)
    setChatTemplateSelection(null)
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-inbox-popover]')) closeTransientMenus()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeTransientMenus() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [])

  const [activeNav, setActiveNav] = useState<'inbox' | 'team' | 'replies' | 'tags'>('inbox')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!attachment || !attachment.type.startsWith('image/')) { setAttachmentPreviewUrl(null); return }
    const url = URL.createObjectURL(attachment)
    setAttachmentPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [attachment])
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingPaused, setRecordingPaused] = useState(false)
  const discardRecordingRef = useRef(false)
  const recordingPauseStartedRef = useRef(0)
  const recordingPausedMsRef = useRef(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recordingStartedRef = useRef(0)
  useEffect(() => { if (!recording) return; const timer = window.setInterval(() => setRecordingSeconds(Math.floor(((recordingPaused ? recordingPauseStartedRef.current : Date.now()) - recordingStartedRef.current - recordingPausedMsRef.current) / 1000)), 500); return () => window.clearInterval(timer) }, [recording, recordingPaused])
  useEffect(() => () => { if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()) }, [])
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
      recorder.onpause = () => setRecordingPaused(true)
      recorder.onresume = () => setRecordingPaused(false)
      recorder.onerror = () => { setRecording(false); setRecordingPaused(false); setMessageSendError('Audio recording failed. Please try again.') }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setRecording(false)
        if (discardRecordingRef.current) { discardRecordingRef.current = false; return }
        if (!chunks.length) { setMessageSendError('No audio was captured. Please record again.'); return }
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
      setRecordingPaused(false)
      discardRecordingRef.current = false
      recordingPausedMsRef.current = 0
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
  const stopVoiceRecording = () => {
    const recorder = recorderRef.current
    if (!recorder) { setMessageSendError('No active recording was found. Please record again.'); setRecording(false); return }
    try {
      if (recorder.state === 'inactive') {
        setRecording(false)
        return
      }
      // Update the interface immediately; MediaRecorder.onstop asynchronously finalizes the preview.
      setRecording(false)
      setRecordingPaused(false)
      recorder.stop()
    } catch (error) {
      console.error('[voice] failed to stop recording', error)
      setMessageSendError('Unable to stop the recording. Please discard it and try again.')
    }
  }
  const discardVoiceRecording = () => {
    discardRecordingRef.current = true
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    setRecording(false)
    setRecordingPaused(false)
    clearVoice()
  }
  const toggleRecordingPause = () => {
    const recorder = recorderRef.current
    if (!recorder) return
    try {
      if (recorder.state === 'recording') {
        recorder.pause()
        recordingPauseStartedRef.current = Date.now()
        setRecordingPaused(true)
        setRecordingSeconds(Math.max(0, Math.floor((recordingPauseStartedRef.current - recordingStartedRef.current - recordingPausedMsRef.current) / 1000)))
      } else if (recorder.state === 'paused') {
        recordingPausedMsRef.current += Date.now() - recordingPauseStartedRef.current
        recorder.resume()
        setRecordingPaused(false)
      }
    } catch (error) {
      console.error('[voice] pause/resume failed', { state: recorder.state, error })
      setMessageSendError('Could not pause or resume this recording. Please stop and retry.')
    }
  }
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
        // Diagnostic: encode the same browser recording as MP3 instead of Ogg/Opus.
        // Keep the rest of the recording, upload, and message-send flow unchanged.
        const exitCode = await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', 'voice.mp3'])
        if (exitCode !== 0) throw new Error('MP3 audio conversion failed. Please try recording again.')
        const converted = await ffmpeg.readFile('voice.mp3')
        if (!(converted instanceof Uint8Array) || converted.byteLength < 128) throw new Error('Audio conversion produced an invalid MP3 file.')
        const decodeExit = await ffmpeg.exec(['-v', 'error', '-xerror', '-i', 'voice.mp3', '-map', '0:a:0', '-f', 'null', '-'])
        if (decodeExit !== 0) throw new Error('The converted MP3 recording cannot be decoded. Please record again.')
        const pcmExit = await ffmpeg.exec(['-v', 'error', '-xerror', '-i', 'voice.mp3', '-map', '0:a:0', '-t', '1', '-ac', '1', '-ar', '16000', '-f', 's16le', 'voice-check.pcm'])
        if (pcmExit !== 0) throw new Error('The MP3 recording contains invalid audio packets. Please record again.')
        const decodedSamples = await ffmpeg.readFile('voice-check.pcm')
        if (!(decodedSamples instanceof Uint8Array) || decodedSamples.byteLength < 3200) throw new Error('The recording is too short or contains no decodable audio.')
        const ogg = new File([new Uint8Array(converted)], 'voice.mp3', { type: 'audio/mpeg' })
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
  const [newConversationTemplate, setNewConversationTemplate] = useState<TemplateSelection | null>(null)
  const [newConversationTemplateActive, setNewConversationTemplateActive] = useState(false)
  const [chatTemplateOpen, setChatTemplateOpen] = useState(false)
  const [chatTemplateSelection, setChatTemplateSelection] = useState<TemplateSelection | null>(null)
  const [chatTemplateActive, setChatTemplateActive] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [teamAgents, setTeamAgents] = useState<Agent[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [teamError, setTeamError] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false)
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)
  const [accountPassword, setAccountPassword] = useState('')
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('')
  const [accountPasswordBusy, setAccountPasswordBusy] = useState(false)
  const [accountPasswordFeedback, setAccountPasswordFeedback] = useState('')
  const [pushFeedback, setPushFeedback] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushTestBusy, setPushTestBusy] = useState(false)
  const lastSoundEventRef = useRef<string | null>(null)
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
  const [teamNotice, setTeamNotice] = useState('')
  const [newAgentRole, setNewAgentRole] = useState<'admin' | 'agent'>('agent')
  const [newAgentDepartments, setNewAgentDepartments] = useState<string[]>(['customer_support'])
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentEmail, setNewAgentEmail] = useState('')
  const attachmentInput = useRef<HTMLInputElement>(null)
  const messageInput = useRef<HTMLDivElement>(null)
  const selected = selectedId ? conversations.find((item) => item.id === selectedId) : undefined

  const replyWindowOpen = !!selected?.messages.some(message => message.from === 'customer' && Date.now() - new Date(message.date).getTime() < 24 * 60 * 60 * 1000)

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
      return { id: row.id, name, initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(), color: colors[index % colors.length], type: contact?.contact_type === 'supplier' ? 'Supplier' : 'Customer', phone: contact?.phone || '', preview: last?.body || last?.attachment_name || '', time: last?.created_at ? new Date(last.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', lastMessageAt: last?.sent_at || last?.created_at || null, unread: Number(row.unread_count) || 0, status: row.status, assignedTo: row.assigned_agent_id, agentName: assignedAgent?.display_name, messages: messages.map((message: any) => ({ date: message.sent_at || message.created_at || new Date().toISOString(), id: message.id, from: message.direction === 'outbound' ? 'agent' : 'customer', text: message.body || (message.attachment_name ? '' : 'Message'), time: new Date(message.created_at || message.sent_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: message.status, failureReason: message.failure_reason || undefined, attachmentUrl: message.attachment_url, attachmentName: message.attachment_name })), notes: notes.map((note: any) => { const noteAgent = Array.isArray(note.whatsapp_agents) ? note.whatsapp_agents[0] : note.whatsapp_agents; return { id: note.id, body: note.body, time: new Date(note.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), agentName: noteAgent?.display_name || 'Agent' } }) }
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
  const markConversationRead = async (conversationId: string) => {
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation))
    try {
      const response = await fetch('/api/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conversationId, patch: { unread_count: 0 } })
      })
      if (!response.ok) throw new Error('Unable to mark conversation as read')
    } catch (error) {
      console.error('[inbox] mark read failed', error)
      void load()
    }
  }
  useEffect(() => {
    if (!selectedId || !conversations.some((conversation) => conversation.id === selectedId && conversation.unread > 0)) return
    void markConversationRead(selectedId)
  }, [selectedId, conversations])

  const updateConversation = async (patch: Record<string, string | null>) => { if (!selected) return; const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, patch }) }); if (!response.ok) throw new Error('Conversation update failed'); await load() }
  const deleteInboxContent = async (conversationId: string, messageId?: string) => {
    const chat = conversations.find((item) => item.id === conversationId)
    if (!chat) return
    setDeleteTarget({ conversationId, messageId, name: chat.name })
  }
  const confirmInboxDeletion = async () => {
    if (!deleteTarget || deleteBusy) return
    const { conversationId, messageId } = deleteTarget
    setDeleteBusy(true)
    setMessageSendError('')
    try {
      const response = await fetch('/api/inbox', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, ...(messageId ? { messageId } : {}) }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Deletion failed.')
      if (!messageId && selectedId === conversationId) setSelectedId(null)
      await load()
      setDeleteTarget(null)
    } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Deletion failed.') }
    finally { setDeleteBusy(false) }
  }
  const startContactEdit = () => { if (!selected) return; setContactNameDraft(selected.name.replace(/\D/g, '') === selected.phone.replace(/\D/g, '') ? '' : selected.name); setContactTypeDraft(selected.type.toLowerCase() as 'customer' | 'supplier'); setEditingContact(true) }
  const saveContact = async () => { if (!selected || !contactNameDraft.trim()) return; setContactSaveBusy(true); setMessageSendError(''); try { const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, contactPatch: { display_name: contactNameDraft.trim(), contact_type: contactTypeDraft } }) }); if (!response.ok) throw new Error('Contact update failed'); setEditingContact(false); await load() } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Could not save contact name.') } finally { setContactSaveBusy(false) } }
  const loadSavedReplies = async () => { const response = await fetch('/api/saved-replies', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Saved replies unavailable'); setSavedReplies(payload.replies ?? []) }
  const openSavedReplies = async () => { setActiveNav('replies'); setSavedRepliesOpen(true); setQuickRepliesOpen(false); setSavedReplyError(''); try { await loadSavedReplies() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Saved replies unavailable') } }
  const openQuickReplies = async () => { const next = !quickRepliesOpen; setChatTemplateOpen(false); setChatTemplateSelection(null); setEmojiOpen(false); setOpenMessageMenu(null); setQuickRepliesOpen(next); setSavedReplySearch(''); if (next) { setSavedReplyError(''); try { await loadSavedReplies() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Saved replies unavailable') } } }
  const saveSavedReply = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setSavedReplyBusy(true); setSavedReplyError(''); try { const response = await fetch('/api/saved-replies', { method: editingReplyId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(editingReplyId ? { id: editingReplyId } : {}), title: savedReplyTitle, body: savedReplyBody }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Reply could not be saved.'); await loadSavedReplies(); setSavedReplyTitle(''); setSavedReplyBody(''); setEditingReplyId(null) } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Reply could not be saved.') } finally { setSavedReplyBusy(false) } }
  const beginEditSavedReply = (reply: SavedReply) => { setEditingReplyId(reply.id); setSavedReplyTitle(reply.title); setSavedReplyBody(reply.body) }
  const cancelEditSavedReply = () => { setEditingReplyId(null); setSavedReplyTitle(''); setSavedReplyBody('') }
  const deleteSavedReply = async (id: string) => { setSavedReplyBusy(true); try { const response = await fetch('/api/saved-replies', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!response.ok) throw new Error('Reply could not be deleted.'); setSavedReplies((current) => current.filter((reply) => reply.id !== id)); if (editingReplyId === id) cancelEditSavedReply() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Reply could not be deleted.') } finally { setSavedReplyBusy(false) } }
  const useSavedReply = (reply: SavedReply) => { setDraft(reply.body); setQuickRepliesOpen(false); setSavedReplySearch('') }

  const emojiCategories = [
    { id: 'recent', icon: '◷', label: 'Frequently used', emojis: ['👍','🙏','😀','😍','😘','💜','😆','😅','😜','➕','😊','💯','↗️','💌','🕺','🌍','👋','😂','👌','🥰','🙁','😋'] },
    { id: 'smileys', icon: '☺', label: 'Smileys & People', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😋','😛','😜','🤪','🤗','🤭','🫡','🤔','🫶','👏','🙌','🤝','😌','😏','😒','😞','😔','😟','😕','🙁','☹','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤤','😴','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','🥳','🥸','😎','🤓','🧐','😮','😯','😲','😧','😦','💨','😬','🙄','😑','😐','🤨','🤫','🤥','😶','🌫','😈','👿','💀','☠','👻','👽','🤖','💩','👋','🤚','🖐','✋','🖖','🫱','🫲','🫳','🫴','🫰','🤞','✌','🤟','🤘','🤙','👈','👉','👆','👇','☝','✊','👊','🤛','🤜','🤲','👐','🤷','🙋','💁','🙆','🙅','🤦','🧑','👩','👨','👶','👧','👦','👵','👴'] },
    { id: 'nature', icon: '♧', label: 'Animals & Nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐸','🐵','🌸','🌹','🌺','🌻','🌴','🌿','🍀','🌍','☀️','🌙','⭐','❄','🐷','🐮','🐴','🦄','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐝','🦋','🐛','🐌','🐞','🐜','🪲','🦟','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦀','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦦','🦥','🐿','🦔','🌵','🎄','🌲','🌳','🌷','🌼','🌾','🍁','🍂','🍃','🌱'] },
    { id: 'food', icon: '♨', label: 'Food & Drink', emojis: ['🍏','🍎','🍊','🍋','🍉','🍇','🍓','🍒','🥭','🍕','🍔','🍟','🌮','🍰','🎂','☕','🧃','🥤','🍽️','🍌','🍍','🥥','🥝','🍑','🍐','🍈','🫐','🥑','🍆','🥔','🥕','🌽','🌶','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🌰','🍞','🥐','🥖','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🥚','🍳','🥘','🍲','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦪','🍦','🍧','🍨','🍩','🍪','🍫','🍬','🍭','🍮','🍯','🍼','🥛','🫖','🍵','🍶','🍾','🍷','🍸','🍹','🍺','��','🥂','🥃','🧋','🧊'] },
    { id: 'activity', icon: '◉', label: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🎾','🏐','🎯','🎮','🎨','🎤','🎧','🎬','🎟️','🏆','🥇','🎉','🎊','🎃','🎄','🎆','🎇','🧨','🎈','🎀','🎁','��','🎟','🎫','🎖','🏅','🥈','🥉','🥎','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸','🥌','🎿','⛷','🏂','🏋','🤸','⛹','🤺','🤾','🏌','🏇','🧘','🏄','🏊','🚣','🧗','🚴','🚵','🎲','♟','🎭','🎪','🎼','🎹','🥁','🎷','🎺','🎸','🎻'] },
    { id: 'travel', icon: '✈', label: 'Travel & Places', emojis: ['🚗','🚕','🚌','🚎','🏎️','🚓','🚑','🚒','✈️','🚀','🚁','⛵','🏖️','🏝️','🏕️','🏨','📍','🗺️','🚙','🛻','🚚','🚛','🚜','🛵','🏍','🛺','🚲','🛴','🚏','🛣','🛤','🚥','🚦','🛑','🚧','⚓','🛟','⛽','🚢','🛳','⛴','🛥','🚤','🛶','🚟','🚠','🚡','🚂','🚆','🚇','🚊','🚉','🚞','🚝','🚄','🚅','🚈','🚋','🚃','🚍','🚐','🚖','🚘','🚔','🚨','🛬','🛫','🛰','🪂','🏟','🏛','🏗','🧱','🪨','🪵','🏘','🏠','🏡','🏢','🏣','🏤','����','🏦','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🕍','⛩','🕋','⛲','⛺','🌋','🗻','🏔','⛰','🌅','🌄','🌠','🎇','🌆','🌇','🌃','🌉'] },
    { id: 'objects', icon: '♢', label: 'Objects', emojis: ['⌚','📱','💻','⌨️','🖥️','📷','💡','📞','☎️','📌','📎','��️','🔒','🔑','🎁','💬','📩','📦','🖱','🖨','🕹','💽','💾','💿','📀','📼','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🪫','🔌','🧮','🪙','💰','💴','💵','💶','💷','💸','💳','🧾','💎','⚖','🪜','🧰','🪛','🔧','🔨','⚒','🛠','⛏','🪚','🔩','⚙','🗜','🧲','🧪','🧫','🧬','🔬','🔭','📿','💊','🩹','🩺','🚪','🪑','🛏','🛋','🚽','🚿','🛁','🧼','🪥','🧴','🧹','🧺','🧻','🪣','🧯','🛒','🚬','⚰','🪦','⚱','🗿','🪧'] },
    { id: 'symbols', icon: '♡', label: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💯','✅','❌','⚠️','❓','❗','➕','✨','🔥','💖','💗','💓','💘','💝','💟','☮','✝','☪','🕉','☸','✡','🔯','🕎','☯','☦','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛','🉑','☢','☣','📴','📳','🈶','🈚','🈸','🈺','🈷','✴','🆚','💮','🉐','㊙','㊗','🈴','🈵','🈹','🈲','🅰','🅱','🆎','🆑','🅾','🆘','⛔','📛','🚫','💢','♨','🚷','🚯','🚳','🚱','🔞','📵','🚭','❕','❔','‼','⁉','🔅','🔆','〽','⚜','🔱','⚕','♻','💠','🌐','Ⓜ','🌀','💤','🏧','🚾','♿','🅿','🛗'] },
  ]
  const emojiSearchPool = emojiCategories.flatMap((category) => category.emojis)
  const shownEmojiCategories = emojiSearch.trim()
    ? [{ id: 'search', icon: '⌕', label: 'Search results', emojis: [...new Set(emojiSearchPool)] }]
    : emojiCategories.filter((category) => emojiCategory === 'recent' ? category.id === 'recent' || category.id === 'smileys' : category.id === emojiCategory)

  const insertEmoji = (emoji: string) => {
    const input = messageInput.current
    if (!input) { setDraft(current => current + emoji); return }
    input.focus()
    const selection = window.getSelection()
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null
    if (range && input.contains(range.commonAncestorContainer)) {
      range.deleteContents()
      const img = document.createElement('img')
      img.src = emojiArtworkUrl(emoji)
      img.alt = emoji
      img.dataset.emoji = emoji
      img.className = 'composer-emoji'
      img.draggable = false
      img.addEventListener('error', () => img.replaceWith(document.createTextNode(emoji)), { once: true })
      range.insertNode(img)
      range.setStartAfter(img)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      setDraft(Array.from(input.childNodes).map(function collect(node: ChildNode): string { if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''; if (!(node instanceof HTMLElement)) return ''; if (node.tagName === 'IMG') return node.dataset.emoji || node.getAttribute('alt') || ''; if (node.tagName === 'BR') return '\\n'; return Array.from(node.childNodes).map(collect).join('') }).join(''))
    } else setDraft(current => current + emoji)
  }

  const uploadAttachment = async (file: File) => { const form = new FormData(); form.append('file', file); const response = await fetch('/api/media', { method: 'POST', body: form }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Media upload failed'); return payload }
  const sendMessage = async () => {
    if (sendInProgress.current || !selected || (!draft.trim() && !attachment)) return
    sendInProgress.current = true
    setSendingMessage(true)
    setMessageSendError('')
    const conversationId = selected.id
    const recipient = selected.phone
    const originalDraft = draft
    const text = originalDraft.trim()
    const file = attachment
    try {
      let media: any = null
      if (file) media = await uploadAttachment(file)
      const response = await fetch('/api/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, to: recipient, text, mediaId: media?.mediaId, attachmentUrl: media?.mediaId ? undefined : media?.url, attachmentName: media?.name, attachmentType: media?.type })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || payload.message || 'Message could not be sent. Please try again.')
      setDraft((current) => current === originalDraft ? '' : current)
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
    event.preventDefault(); if (newConversationTemplateActive && !newConversationTemplate) { setNewConversationError('Fill in all template variables before sending.'); return }; setNewConversationBusy(true); setNewConversationError('')
    try { const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newConversationName, phone: newConversationCountry + newConversationPhone.replace(/\D/g, '').replace(/^0+/, ''), message: newConversationMessage, template: newConversationTemplate || undefined }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Conversation could not be created.'); await load(); setSelectedId(payload.conversationId); setDetailsOpen(true); setNewConversationOpen(false); setNewConversationName(''); setNewConversationPhone(''); setNewConversationMessage(''); setNewConversationTemplate(null); setNewConversationTemplateActive(false) } catch (error) { setNewConversationError(error instanceof Error ? error.message : 'Conversation could not be created.') } finally { setNewConversationBusy(false) }
  }

  const loadTeam = async () => { const response = await fetch('/api/team', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Team unavailable'); setTeamAgents(payload.agents ?? []) }
  const openTeam = async () => { setActiveNav('team'); setTeamOpen(true); setTeamError(''); try { await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Team unavailable') } }
  const addAgent = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setTeamBusy(true); setTeamError(''); try { const response = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: newAgentName, email: newAgentEmail, role: newAgentRole, departments: newAgentDepartments }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Agent could not be added.'); setTeamNotice('Invitation sent. The employee will set their own password using the email link.'); setNewAgentName(''); setNewAgentEmail(''); await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Agent could not be added.') } finally { setTeamBusy(false) } }
  const updateAgent = async (id: string, patch: Record<string, string | boolean>) => { setTeamBusy(true); try { const response = await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Agent could not be updated.'); await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Agent could not be updated.') } finally { setTeamBusy(false) } }
  const updateSelfAvailability = async (availability: 'available' | 'away') => { if (!sessionUser?.agentId) return; const response = await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionUser.agentId, availability }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Availability could not be updated.'); setSelfAvailability(availability); setProfileMenuOpen(false) }
  const playIncomingSound = () => {
    try {
      const context = new window.AudioContext()
      const now = context.currentTime
      for (const [index,frequency] of [740,980].entries()) {
        const oscillator=context.createOscillator(),gain=context.createGain()
        oscillator.type='sine';oscillator.frequency.value=frequency
        gain.gain.setValueAtTime(0.0001,now+index*0.17)
        gain.gain.exponentialRampToValueAtTime(0.16,now+index*0.17+0.025)
        gain.gain.exponentialRampToValueAtTime(0.0001,now+index*0.17+0.16)
        oscillator.connect(gain);gain.connect(context.destination)
        oscillator.start(now+index*0.17);oscillator.stop(now+index*0.17+0.17)
      }
      window.setTimeout(()=>void context.close(),700)
    }catch(error){console.warn('[notifications] sound unavailable',error)}
  }
  const testBrowserNotification = async () => {
    setPushTestBusy(true);setPushFeedback('')
    try{
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push notifications are not available in this browser. On iPhone, install and open Myticket from the Home Screen.')
      const registration=await navigator.serviceWorker.getRegistration('/myticket-push-sw.js')
      const subscription=await registration?.pushManager.getSubscription()
      if (!subscription) throw new Error('This device is not subscribed. Tap Enable browser notifications here first.')
      playIncomingSound()
      const response=await fetch('/api/notifications/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})})
      const result=await response.json()
      if(!response.ok)throw new Error(result.error || result.results?.map((r:{reason?:string,status:string})=>r.reason||r.status).join(', ') || 'Push provider rejected the test.')
      setPushFeedback('Push provider accepted the test for this device. Check this device for the notification banner; acceptance does not guarantee display.')
    }catch(error){setPushFeedback(error instanceof Error?error.message:'Test failed.')}
    finally{setPushTestBusy(false)}
  }
  useEffect(()=>{
    if(!sessionUser?.agentId){lastSoundEventRef.current=null;return}
    let cancelled=false
    const check=async()=>{
      try{
        const response=await fetch('/api/notifications/events',{cache:'no-store'})
        if(!response.ok)return
        const data=await response.json()
        if(cancelled)return
        const newest=data.latestId as string|null
        if(lastSoundEventRef.current===null){lastSoundEventRef.current=newest||'';return}
        if(newest&&newest!==lastSoundEventRef.current){lastSoundEventRef.current=newest;playIncomingSound()}
      }catch{}
    }
    void check()
    const timer=window.setInterval(()=>void check(),5000)
    return()=>{cancelled=true;window.clearInterval(timer)}
  },[sessionUser?.agentId])
  const configureBrowserPush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { const isIPad = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); setPushFeedback(isIPad ? 'On iPad, open Myticket in Safari, tap Share → Add to Home Screen, then launch Myticket from its Home Screen icon to enable push notifications (iPadOS 16.4+).' : 'This browser does not support push notifications.'); return }
      const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isAppleMobile && !window.matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & {standalone?: boolean}).standalone) { setPushFeedback('On iPad, install Myticket from Safari using Share → Add to Home Screen, then open it from the Home Screen to enable notifications.'); return }
      const configResponse = await fetch('/api/notifications/push')
      if (!configResponse.ok) throw new Error('Please sign in again.')
      const config = await configResponse.json()
      if (!config.enabled) { setPushFeedback('Browser push is not configured by the administrator yet.'); return }
      const registration = await navigator.serviceWorker.register('/myticket-push-sw.js')
      const existing = await registration.pushManager.getSubscription()
      if (existing && pushEnabled) {
        const result = await fetch('/api/notifications/push',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:existing.endpoint})})
        if (!result.ok) throw new Error('Could not disable browser notifications.')
        await existing.unsubscribe()
        setPushEnabled(false);setPushFeedback('Browser notifications disabled on this device.');return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushFeedback('Allow notifications in your browser settings to enable alerts.');return }
      const key = config.publicKey.replace(/-/g,'+').replace(/_/g,'/')
      const raw = atob(key.padEnd(Math.ceil(key.length/4)*4,'='))
      const applicationServerKey = Uint8Array.from(raw,c=>c.charCodeAt(0))
      const subscription = existing || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey})
      const response = await fetch('/api/notifications/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON()})})
      if (!response.ok) throw new Error('Could not save notification permission.')
      setPushEnabled(true);setPushFeedback('Browser push enabled on this device.')
    } catch(error){setPushFeedback(error instanceof Error?error.message:'Could not configure browser notifications.')}
  }
  const changeOwnPassword = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setAccountPasswordFeedback(''); if (accountPassword.length < 12 || accountPassword !== accountPasswordConfirm) { setAccountPasswordFeedback('Use at least 12 characters and ensure both passwords match.'); return } const supabase = createBrowserSupabaseClient(); if (!supabase) { setAccountPasswordFeedback('Authentication is unavailable.'); return } setAccountPasswordBusy(true); const { error } = await supabase.auth.updateUser({ password: accountPassword }); setAccountPasswordBusy(false); if (error) { setAccountPasswordFeedback(error.message); return } setAccountPassword(''); setAccountPasswordConfirm(''); setAccountPasswordFeedback('Password updated successfully.') }
  const signOut = async () => { const supabase = createBrowserSupabaseClient(); if (sessionUser?.agentId) await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionUser.agentId, availability: 'offline' }) }); await supabase?.auth.signOut(); setSessionUser(null); setProfileMenuOpen(false); setAccountSettingsOpen(false); setWorkspaceSettingsOpen(false); setPushFeedback(''); setPushEnabled(false) }

  const signIn = async () => { setAuthBusy(true); setAuthError(''); const supabase = createBrowserSupabaseClient(); if (!supabase) { setAuthError('Supabase authentication is not configured in this preview.'); setAuthBusy(false); return } const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword }); if (error || !data.user) setAuthError(error?.message || 'Invalid email or password.'); else { const agent = agents.find((item) => item.email?.toLowerCase() === data.user.email?.toLowerCase()); setSessionUser({ email: data.user.email, agentId: agent?.id, role: data.user.app_metadata?.role || (agent ? 'agent' : 'admin') }) } setAuthBusy(false) }

  if (isLoading) return <main className="auth-loading-shell" aria-label="Loading inbox"><img className="auth-loading-wordmark" src="/brand/myticket-wordmark.png" alt="Myticket" /><span className="auth-loading-spinner" aria-hidden="true" /></main>
  if (!sessionUser) return <main className="login-shell"><div className="login-bg-orb login-bg-orb-orange" aria-hidden="true" /><div className="login-bg-orb login-bg-orb-green" aria-hidden="true" /><section className="login-card"><div className="login-brand-lockup"><img className="login-brand-lockup-image" src="/brand/myticket-whatsapp-login-logo.png" alt="Myticket" /><div className="login-brand-subtitle">WHATSAPP SHARED INBOX</div></div><div className="login-copy"><div className="login-title-spacer" aria-hidden="true">&nbsp;</div><p className="login-relocated-title">Welcome back</p></div><form className="login-form" onSubmit={(event) => { event.preventDefault(); void signIn() }}><label htmlFor="login-email">EMAIL</label><div className="login-input-wrap"><span className="login-field-icon" aria-hidden="true">✉</span><input id="login-email" aria-label="Email" type="email" placeholder="you@example.com" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required /></div><label htmlFor="login-password">PASSWORD</label><div className="login-input-wrap"><span className="login-field-icon login-lock" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg></span><input id="login-password" aria-label="Password" type="password" placeholder="Enter your password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required /></div><button className="send-btn login-submit" type="submit" disabled={authBusy}>{authBusy ? 'Signing in…' : <>Sign in <span aria-hidden="true">→</span></>}</button></form>{authError && <p className="login-error" role="alert">{authError}</p>}<div className="login-security"><span className="login-check">✓</span><span>Secure shared messaging workspace<br/>for your support team.</span></div></section><p className="login-help">Trouble logging in? <strong>Contact Organization Administrator</strong></p><p className="login-privacy-link"><a href="/privacy">Privacy Policy</a></p><footer className="login-page-footer"><span>© 2026 Myticket. All rights reserved.</span><span>WhatsApp Shared Inbox · Secure team access</span></footer></main>
  return <main className="app-shell">
    <aside className={`rail ${sidebarOpen ? 'rail-open' : ''}`}><div className="brand-mark"><img src="/brand/myticket-whatsapp-login-logo.png" alt="Myticket WhatsApp" /></div><nav aria-label="Primary navigation" className="rail-nav"><button className={`rail-item ${activeNav === 'inbox' ? 'active' : ''}`} aria-label="Inbox" onClick={() => setActiveNav('inbox')}><Inbox size={20} /><span>Inbox</span><b>{conversations.length}</b></button><button className={`rail-item ${activeNav === 'team' ? 'active' : ''}`} aria-label="Team" onClick={() => void openTeam()}><Users size={20} /><span>Team</span></button><button className={`rail-item ${activeNav === 'replies' ? 'active' : ''}`} aria-label="Saved replies" onClick={() => void openSavedReplies()}><FileText size={20} /><span>Replies</span></button><button className={`rail-item ${activeNav === 'tags' ? 'active' : ''}`} aria-label="Tags" onClick={() => setActiveNav('tags')}><Tag size={20} /><span>Tags</span></button></nav><div className="rail-bottom">{sessionUser?.role === 'admin' && <button className="rail-item" aria-label="Workspace settings" title="Workspace settings" onClick={() => { setProfileMenuOpen(false); setWorkspaceSettingsOpen(true) }}><Settings size={20} /></button>}<div className="profile-menu-wrap" data-inbox-popover><button className="mini-avatar" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-label="Open agent menu">{sessionUser?.email?.slice(0, 2).toUpperCase() || agents[0]?.display_name?.slice(0, 2).toUpperCase() || 'AG'}</button>{profileMenuOpen && <div className="profile-menu"><strong>{sessionUser?.email || 'Agent'}</strong><span className={`availability-pill ${selfAvailability}`}>{selfAvailability === 'available' ? 'Available' : 'Away'}</span><button onClick={() => void updateSelfAvailability(selfAvailability === 'available' ? 'away' : 'available')}>{selfAvailability === 'available' ? 'Set away' : 'Set available'}</button><button onClick={() => { setProfileMenuOpen(false); setAccountSettingsOpen(true); setAccountPasswordFeedback('') }}>My account &amp; password</button><button className="logout-button" onClick={() => void signOut()}>Log out</button></div>}</div></div></aside>
    <section className="inbox-pane"><header className="pane-header"><div className="pane-brand-heading"><h1>WHATSAPP SHARED INBOX</h1></div><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button><button className="icon-btn" aria-label="Notifications" title="Notifications"><Bell size={18} /></button></header><div className="inbox-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><button className="new-conversation-btn" onClick={() => { setNewConversationOpen(true); setNewConversationError('') }}><span>+</span> New conversation</button></div><div className="filter-tabs" role="tablist"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All <span>{counts.all}</span></button><button className={filter === 'unassigned' ? 'selected' : ''} onClick={() => setFilter('unassigned')}>Unassigned <span>{counts.unassigned}</span></button><button className={filter === 'open' ? 'selected' : ''} onClick={() => setFilter('open')}>Open <span>{counts.open}</span></button></div><div className="conversation-list">{visible.length === 0 ? <p className="empty-list">No conversations yet.</p> : visible.map((conversation) => <button className={`conversation ${conversation.id === selectedId ? 'conversation-selected' : ''}`} data-conversation-id={conversation.id} key={conversation.id} onClick={() => { setSelectedId(conversation.id); setDetailsOpen(true) }}><ContactAvatar phone={conversation.phone} /><div className="conversation-copy"><div className="conversation-top"><strong>{contactDisplayName(conversation.name, conversation.phone)}</strong><time title={conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : undefined}>{formatConversationListDate(conversation.lastMessageAt)}</time></div><p className="conversation-preview">{conversation.messages.at(-1)?.from === 'agent' && <span className="conversation-preview-ticks" title={conversation.messages.at(-1)?.status || 'sent'} aria-label={conversation.messages.at(-1)?.status || 'sent'}>{conversation.messages.at(-1)?.status === 'read' || conversation.messages.at(-1)?.status === 'delivered' ? <svg width="15" height="11" viewBox="0 0 20 14" fill="none" aria-hidden="true" style={{ color: conversation.messages.at(-1)?.status === 'read' ? '#53b7ef' : '#8896a8', flexShrink: 0 }}><path d="M1.5 7.5 5.4 11.3 12.3 3.2M7.5 7.5 11.4 11.3 18.3 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : conversation.messages.at(-1)?.status === 'failed' ? <span style={{ color: '#c93b35', fontSize: 11 }}>!</span> : <Check size={11} color="#8896a8" aria-hidden="true" />}</span>}<span className="conversation-preview-text"><EmojiMessageSegment text={conversation.preview} /></span></p><div className="conversation-bottom"><span className={`status-dot ${conversation.status}`} /><span className={`type-badge ${conversation.type.toLowerCase()}`}>{conversation.type}</span>{conversation.agentName && <span className="assigned-label">{conversation.agentName}</span>}</div></div></button>)}</div></section>
    <section className="chat-pane">{selected ? <><header className="chat-header"><div className="chat-person"><ContactAvatar phone={selected.phone} className="large" /><div><h2>{contactDisplayName(selected.name, selected.phone)}</h2><p><span className="online-dot" /> WhatsApp</p></div></div><div className="chat-actions"><button className="status-select" onClick={() => void updateConversation({ status: selected.status === 'open' ? 'pending' : 'open' })}><span className={`status-dot ${selected.status}`} /> {selected.status}</button><button className="icon-btn" onClick={() => setDetailsOpen(true)} aria-label="Open contact details"><Users size={18} /></button><button className="icon-btn" type="button" onClick={() => void deleteInboxContent(selected.id)} aria-label="Delete chat" title="Delete chat from inbox" style={{ color: "#c93b35" }}><Trash2 size={18} /></button></div></header><div className="thread" ref={threadRef}>{selected.messages.map((message, index) => <Fragment key={message.id}>{(index === 0 || new Date(selected.messages[index - 1].date).toDateString() !== new Date(message.date).toDateString()) && <div className="day-divider"><span>{formatChatDate(message.date)}</span></div>}<div className={`message-row ${message.from === 'agent' ? 'message-agent' : ''}`} key={message.id}><div className={`message-bubble hover-message-bubble ${message.attachmentUrl && message.attachmentName?.toLowerCase().includes("voice") ? "voice-message-bubble" : "text-message-bubble"}`} style={{ position: "relative", overflow: "visible", boxSizing: "border-box" }}><div data-inbox-popover className={`hover-message-options ${openMessageMenu === message.id ? "message-options-open" : ""}`} style={{ position: "absolute", right: 4, top: 4, zIndex: openMessageMenu === message.id ? 30 : 1 }}><button type="button" onClick={() => { setEmojiOpen(false); setQuickRepliesOpen(false); setOpenMessageMenu(openMessageMenu === message.id ? null : message.id) }} aria-label="Message options" aria-expanded={openMessageMenu === message.id} title="Message options" style={{ display: "grid", placeItems: "center", width: 23, height: 25, padding: 0, border: "none", borderRadius: 7, background: "transparent", color: "#6b7787", cursor: "pointer" }}><ChevronDown size={15} /></button>{openMessageMenu === message.id && <div role="menu" aria-label="Message actions" style={{ position: "absolute", top: 28, right: 0, minWidth: 143, padding: 5, background: "#fff", border: "1px solid #dce4ee", borderRadius: 10, boxShadow: "0 8px 24px #102a4329", zIndex: 40 }}><button type="button" role="menuitem" onClick={() => { setOpenMessageMenu(null); void deleteInboxContent(selected.id, message.id) }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", border: 0, borderRadius: 6, background: "transparent", color: "#c93b35", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", textAlign: "left" }}><Trash2 size={14} /> Delete message</button></div>}</div>{message.attachmentUrl && message.attachmentName?.toLowerCase().includes('voice') && <VoiceNotePlayer src={message.attachmentUrl} />}{message.attachmentUrl && !message.attachmentName?.toLowerCase().includes('voice') && (/\.(png|jpe?g|webp|gif|bmp)$/i.test(message.attachmentName || '') ? <a className="message-image-link" href={message.attachmentUrl} target="_blank" rel="noopener noreferrer" title="Open full image"><img className="message-image" src={message.attachmentUrl} alt={message.attachmentName || 'Attached image'} loading="lazy" /></a> : <a className="message-attachment" href={message.attachmentUrl} target="_blank" rel="noreferrer">{message.attachmentName || 'Open attachment'}</a>)}{message.text && <LinkedMessageText text={message.text} />}<small>{message.time} {message.from === 'agent' && <span className="message-delivery-status" title={message.status || 'sent'} aria-label={message.status || 'sent'}>{message.status === 'read' || message.status === 'delivered' ? <svg width="15" height="11" viewBox="0 0 20 14" fill="none" aria-hidden="true" style={{ color: message.status === 'read' ? '#53b7ef' : '#8896a8', verticalAlign: 'middle' }}><path d="M1.5 7.5 5.4 11.3 12.3 3.2M7.5 7.5 11.4 11.3 18.3 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : message.status === 'failed' ? <span style={{ color: '#c93b35' }} title={message.failureReason || 'WhatsApp delivery failed'}>Failed</span> : <Check size={11} color="#8896a8" aria-hidden="true" />}</span>}</small></div></div></Fragment>)}</div><div className="composer-wrap"><div className="composer">{(recording || voiceFile) ? <div className="voice-inline" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '2px 4px', width: '100%' }}>{recording ? <div className="voice-recording-bar"><button type="button" className="voice-recording-finish" onClick={stopVoiceRecording} aria-label="Stop recording and preview" title="Stop recording and preview"><Square size={16} /></button><button type="button" className="voice-recording-pause" onClick={toggleRecordingPause} aria-label={recordingPaused ? "Resume recording" : "Pause recording"} title={recordingPaused ? "Resume recording" : "Pause recording"}>{recordingPaused ? <Play size={17} fill="currentColor" strokeWidth={1.8} /> : <Pause size={18} fill="currentColor" strokeWidth={1.8} />}</button><div className="voice-recording-wave" aria-label={recordingPaused ? "Recording paused" : "Recording in progress"}>{Array.from({ length: 35 }, (_, i) => <span key={i} style={{ height: `${4 + Math.round(Math.abs(Math.sin(i * 1.89) * Math.cos(i * 0.71)) * 17)}px` }} />)}</div><span className="voice-recording-time">{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span><span className="voice-recording-dot" /><button type="button" className="voice-recording-discard" onClick={discardVoiceRecording} aria-label="Discard recording" title="Discard recording"><Trash2 size={18} /></button></div> : <><VoiceNotePlayer src={voicePreviewUrl || ""} /><button type="button" onClick={clearVoice} aria-label="Discard recording" title="Discard recording"><Trash2 size={16} /></button></>}</div> : <EmojiComposer editorRef={messageInput} value={draft} onChange={setDraft} onSend={() => { if (!sendingMessage) void sendMessage() }} />}{attachment && <div className="composer-attachment-preview">{attachmentPreviewUrl && <img className="composer-image-preview" src={attachmentPreviewUrl} alt={`Preview of ${attachment.name}`} /> }<div className="attachment-chip"><Paperclip size={14} /><span title={attachment.name}>{attachment.name}</span><button type="button" onClick={() => { setAttachment(null); if (attachmentInput.current) attachmentInput.current.value = ''; }} aria-label="Remove attachment"><X size={12} /></button></div></div>}{chatTemplateOpen && <div className="chat-template-panel" data-inbox-popover><div className="chat-template-panel-head"><strong>Send approved Meta template</strong><button type="button" onClick={() => { setChatTemplateOpen(false); setChatTemplateSelection(null) }} aria-label="Close template picker"><X size={16}/></button></div><WhatsAppTemplatePicker onChange={setChatTemplateSelection} onActiveChange={setChatTemplateActive} disabled={sendingMessage}/><button type="button" className="chat-template-send" disabled={!chatTemplateSelection || sendingMessage} onClick={async () => { if (!selected || !chatTemplateSelection || sendingMessage) return; setSendingMessage(true); setMessageSendError(''); try { const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, to: selected.phone, text: '', template: chatTemplateSelection }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Template could not be sent.'); setChatTemplateOpen(false); setChatTemplateSelection(null); await load() } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Template could not be sent.') } finally { setSendingMessage(false) } }}>Send template</button></div>}<div className="composer-tools"><div className="composer-left-tools"><button type="button" className={chatTemplateOpen ? 'tool-active' : ''} data-inbox-popover aria-label="Meta templates" title="Send approved Meta template" onClick={() => { setChatTemplateOpen((open) => !open); setChatTemplateSelection(null); setQuickRepliesOpen(false); setEmojiOpen(false) }}><MessageSquareCheck size={18} color="#e35a20"/></button><input ref={attachmentInput} type="file" hidden onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><button aria-label="Attach file" onClick={() => attachmentInput.current?.click()}><Paperclip size={17} /></button><button type="button" aria-label={recording ? "Stop voice recording" : "Record voice message"} title={recording ? "Stop recording" : "Record voice message"} onClick={() => recording ? stopVoiceRecording() : void startVoiceRecording()} disabled={sendingMessage}><Mic size={17} color={recording ? "#d92d20" : undefined} /></button><div className="emoji-picker-wrap" data-inbox-popover><button className={emojiOpen ? 'tool-active' : ''} aria-label="Emoji" aria-expanded={emojiOpen} onClick={() => { setOpenMessageMenu(null); setQuickRepliesOpen(false); setEmojiOpen((open) => !open) }}><Smile size={17} /></button>{emojiOpen && <div className="emoji-picker" role="dialog" aria-label="Emoji picker"><div className="emoji-category-tabs">{emojiCategories.map((category) => <button type="button" key={category.id} className={emojiCategory === category.id ? 'active' : ''} title={category.label} onClick={() => { setEmojiCategory(category.id); setEmojiSearch('') }}>{category.icon}</button>)}</div><div className="emoji-search"><Search size={14}/><input value={emojiSearch} onChange={(event) => setEmojiSearch(event.target.value)} placeholder="Search emoji" aria-label="Search emoji"/></div><div className="emoji-scroll">{shownEmojiCategories.map((category) => <section className="emoji-section" key={category.id}><strong>{category.label}</strong><div className="emoji-grid">{category.emojis.map((emoji, index) => <button type="button" key={emoji + index} onClick={() => insertEmoji(emoji)} aria-label={`Insert ${emoji}`}><EmojiArtwork emoji={emoji} /></button>)}</div></section>)}</div></div>}</div><div className="quick-reply-wrap" data-inbox-popover><button className={quickRepliesOpen ? 'tool-active' : ''} aria-label="Saved replies" onClick={() => void openQuickReplies()}><FileText size={17} /></button>{quickRepliesOpen && <div className="quick-reply-menu"><div className="quick-reply-heading"><strong>Saved replies</strong><button onClick={() => setQuickRepliesOpen(false)} aria-label="Close saved replies"><X size={14} /></button></div><div className="quick-reply-search"><Search size={13} /><input value={savedReplySearch} onChange={(event) => setSavedReplySearch(event.target.value)} placeholder="Search replies" /></div><div className="quick-reply-options">{filteredSavedReplies.length === 0 ? <p className="quick-reply-empty">No saved replies found.</p> : filteredSavedReplies.map((reply) => <button key={reply.id} onClick={() => useSavedReply(reply)}><strong>{reply.title}</strong><span>{reply.body}</span></button>)}</div><button className="manage-replies-link" onClick={() => void openSavedReplies()}>Manage saved replies</button></div>}</div></div><button className="send-btn" onClick={() => void (voiceFile ? sendVoiceMessage() : sendMessage())} disabled={sendingMessage || recording || (!voiceFile && !draft.trim() && !attachment)} aria-label={sendingMessage ? "Sending message" : "Send"} title={sendingMessage ? "Sending…" : "Send message"}><Send size={16} /></button></div></div>{!replyWindowOpen && <p role="status" style={{ color: '#9a5700', background: '#fff5e6', borderRadius: 8, padding: '9px 12px', fontSize: 12, margin: '8px 0' }}>WhatsApp’s 24-hour reply window is closed. Send an approved template to reopen the conversation.</p>}{messageSendError && <p role="alert" style={{ color: "#b42318", fontSize: 12, margin: "6px 12px" }}>{messageSendError}</p>}<p className="composer-hint">Messages are sent through Meta WhatsApp Cloud API.</p></div></> : <div className="empty-thread">Select a conversation</div>}</section>
    {detailsOpen && <aside className="details-pane">{selected ? <><div className="details-title"><p className="eyebrow">CONTACT DETAILS</p><button className="icon-btn" onClick={() => setDetailsOpen(false)} aria-label="Close details" title="Close contact details"><X size={17} /></button></div><div className="profile"><ContactAvatar phone={selected.phone} className="profile-avatar" /><h2>{contactDisplayName(selected.name, selected.phone)}</h2><span className={`type-badge large-badge ${selected.type.toLowerCase()}`}>{selected.type}</span><button type="button" onClick={startContactEdit} aria-label="Name or rename customer" title="Name or rename customer" style={{ display: "block", alignSelf: "center", border: "1px solid #d9e3ee", borderRadius: 8, padding: "6px 13px", background: "#f7fafc", color: "#375e83", fontSize: 12, fontWeight: 600, cursor: "pointer", margin: "12px auto 0" }}>Edit contact</button></div><div className="detail-section contact-card"><div className="section-heading"><h3>CONTACT</h3><button onClick={startContactEdit}>Edit</button></div><dl><dt>Phone</dt><dd>{displayPhone(selected.phone)}</dd><dt>Channel</dt><dd><span className="whatsapp-channel-dot" />WhatsApp</dd><dt>Type</dt><dd>{selected.type}</dd></dl></div><div className="detail-section assignment-card"><div className="section-heading"><h3>ASSIGNED TEAM</h3><button><MoreHorizontal size={16} /></button></div><label className="field-label" htmlFor="assignee">Assigned to</label><select id="assignee" value={selected.assignedTo || ''} onChange={(event) => void updateConversation({ assigned_agent_id: event.target.value || null })}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.display_name}</option>)}</select><label className="field-label" htmlFor="status">Conversation status</label><select id="status" value={selected.status} onChange={(event) => void updateConversation({ status: event.target.value })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div><div className="detail-section notes"><div className="section-heading"><h3>Internal notes</h3><button onClick={() => void addNote()}>Add note</button></div><textarea aria-label="Internal note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Keep private context for the support team here." rows={3} />{selected.notes.map((note) => <p key={note.id} className="note-item"><strong>{note.agentName}</strong> · {note.time}<br />{note.body}</p>)}</div><div className="detail-row"><Archive size={16} /><span>Independent WhatsApp inbox</span></div></> : <div className="empty-details">No contact selected</div>}</aside>}
    {savedRepliesOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSavedRepliesOpen(false) }}><section className="conversation-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="saved-replies-title"><div className="modal-header"><div><p className="eyebrow">TEAM LIBRARY</p><h2 id="saved-replies-title">Saved replies</h2></div><button className="icon-btn" onClick={() => { setSavedRepliesOpen(false); cancelEditSavedReply() }} aria-label="Close saved replies"><X size={18} /></button></div><form className="team-add-form saved-reply-form" onSubmit={(event) => void saveSavedReply(event)}><input value={savedReplyTitle} onChange={(event) => setSavedReplyTitle(event.target.value)} placeholder="Title" required /><input value={savedReplyBody} onChange={(event) => setSavedReplyBody(event.target.value)} placeholder="Reply text" required /><button className="send-btn saved-reply-save" type="submit" disabled={savedReplyBusy}>{editingReplyId ? 'Update' : 'Save'}</button>{editingReplyId && <button className="secondary-btn" type="button" onClick={cancelEditSavedReply}>Cancel</button>}</form>{savedReplyError && <p className="login-error" role="alert">{savedReplyError}</p>}<div className="saved-reply-list">{savedReplies.map((reply) => <article className="saved-reply-row" key={reply.id}><div><strong>{reply.title}</strong><p>{reply.body}</p></div><div><button className="secondary-btn" type="button" onClick={() => { setDraft(reply.body); setSavedRepliesOpen(false); cancelEditSavedReply() }}>Use in composer</button><button className="secondary-btn" type="button" disabled={savedReplyBusy} onClick={() => beginEditSavedReply(reply)}>Edit</button><button className="team-toggle" type="button" disabled={savedReplyBusy} onClick={() => void deleteSavedReply(reply.id)}>Delete</button></div></article>)}</div></section></div>}
    {workspaceSettingsOpen && sessionUser?.role === 'admin' && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setWorkspaceSettingsOpen(false) }}><section className="conversation-modal workspace-settings-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title"><div className="modal-header"><div><p className="eyebrow">ADMINISTRATION</p><h2 id="workspace-settings-title">Workspace settings</h2></div><button className="icon-btn" aria-label="Close settings" onClick={() => setWorkspaceSettingsOpen(false)}><X size={18}/></button></div><div className="workspace-settings-content"><section><h3>Workspace</h3><p>Myticket WhatsApp Shared Inbox</p><p>Manage your employees, administrator privileges, and department assignments.</p><button className="secondary-btn" onClick={() => { setWorkspaceSettingsOpen(false); void openTeam() }}>Manage team and departments</button></section><section><h3>WhatsApp integration</h3><p>Messages are sent through Meta WhatsApp Cloud API. Phone number, webhook credentials, and API tokens are managed securely in server configuration, not in this interface.</p></section><section><h3>Security</h3><p>Only Administrators can invite or manage members. Each employee must use their own account.</p><p>For your personal password, open the account menu below the Settings icon.</p></section><section><h3>Notifications &amp; audit logs</h3><p>Workspace-wide notification controls and audit log management are not configured yet.</p></section></div></section></div>}
    {accountSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAccountSettingsOpen(false) }}><section className="conversation-modal workspace-settings-modal" role="dialog" aria-modal="true" aria-labelledby="account-settings-title"><div className="modal-header"><div><p className="eyebrow">MY ACCOUNT</p><h2 id="account-settings-title">Account settings</h2></div><button className="icon-btn" aria-label="Close account settings" onClick={() => setAccountSettingsOpen(false)}><X size={18}/></button></div><div className="workspace-settings-content"><section><h3>Profile</h3><p><strong>Email:</strong> {sessionUser?.email}</p><p><strong>Role:</strong> {sessionUser?.role === 'admin' ? 'Administrator' : 'Team Member'}</p><p><strong>Availability:</strong> {selfAvailability}</p><div className="account-availability-actions"><button className="secondary-btn" onClick={() => void updateSelfAvailability('available')}>Set available</button><button className="secondary-btn" onClick={() => void updateSelfAvailability('away')}>Set away</button></div></section><section><h3>Browser notifications</h3><p>Receive one notification per customer or supplier until you reply. Email alerts go to your account email when configured by the administrator.</p><button className="secondary-btn" type="button" onClick={() => void configureBrowserPush()}>{pushEnabled ? 'Disable browser notifications' : 'Enable browser notifications'}</button><button className="secondary-btn" type="button" disabled={pushTestBusy} onClick={() => void testBrowserNotification()}>{pushTestBusy ? 'Testing…' : 'Test notification & sound'}</button>{pushFeedback && <p role="status">{pushFeedback}</p>}</section><section><h3>Change password</h3><form className="account-password-form" onSubmit={event => void changeOwnPassword(event)}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={accountPassword} onChange={event => setAccountPassword(event.target.value)} /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={accountPasswordConfirm} onChange={event => setAccountPasswordConfirm(event.target.value)} /></label>{accountPasswordFeedback && <p role="status">{accountPasswordFeedback}</p>}<button className="send-btn" type="submit" disabled={accountPasswordBusy || accountPassword.length < 12 || accountPassword !== accountPasswordConfirm}>{accountPasswordBusy ? 'Updating…' : 'Update password'}</button></form></section><section><button className="secondary-btn logout-button" onClick={() => void signOut()}>Log out</button></section></div></section></div>}
    {teamOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTeamOpen(false) }}><section className="conversation-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-title"><div className="modal-header"><div><p className="eyebrow">WORKSPACE</p><h2 id="team-title">Team</h2></div><button className="icon-btn" onClick={() => setTeamOpen(false)} aria-label="Close team"><X size={18} /></button></div>{sessionUser?.role === 'admin' && <form className="team-add-form" onSubmit={(event) => void addAgent(event)}><input value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} placeholder="Agent name" required /><input type="email" value={newAgentEmail} onChange={(event) => setNewAgentEmail(event.target.value)} placeholder="Agent email" required /><select aria-label="Account role" value={newAgentRole} onChange={e=>setNewAgentRole(e.target.value as "admin"|"agent")}><option value="agent">Team Member</option><option value="admin">Administrator</option></select>{newAgentRole==="agent"&&<fieldset className="team-departments"><legend>Departments</legend>{[["customer_support","Customer Support"],["supplier_relations","Supplier Relations"],["booking_operations","Booking Operations"]].map(([id,label])=><label key={id}><input type="checkbox" checked={newAgentDepartments.includes(id)} onChange={e=>setNewAgentDepartments(current=>e.target.checked?[...current,id]:current.filter(x=>x!==id))}/>{label}</label>)}</fieldset>}<button className="send-btn" type="submit" disabled={teamBusy||(newAgentRole==="agent"&&!newAgentDepartments.length)}>Send invitation</button></form>}{teamError && <p className="login-error" role="alert">{teamError}</p>}{teamNotice && <p className="temporary-password" role="status">{teamNotice}<button onClick={() => setTeamNotice('')} aria-label="Dismiss notice">Dismiss</button></p>}<div className="team-list">{teamAgents.map((agent) => { const assigned = agent.whatsapp_conversations ?? []; return <article className="team-row" key={agent.id}><div className="team-avatar">{agent.display_name.slice(0, 2).toUpperCase()}</div><div className="team-info"><strong>{agent.display_name}</strong><span>{agent.email}</span><small>{assigned.length} assigned conversation{assigned.length === 1 ? '' : 's'}</small></div><select value={agent.availability ?? 'offline'} disabled={sessionUser?.role !== 'admin' || teamBusy} onChange={(event) => void updateAgent(agent.id, { availability: event.target.value })}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select><select value={agent.role ?? 'agent'} disabled={sessionUser?.role !== 'admin' || teamBusy} onChange={(event) => void updateAgent(agent.id, { role: event.target.value })}><option value="agent">Team Member</option><option value="admin">Administrator</option></select>{sessionUser?.role==='admin'&&agent.role!=='admin'&&<div className="team-departments"><small>Departments</small>{[["customer_support","Customer Support"],["supplier_relations","Supplier Relations"],["booking_operations","Booking Operations"]].map(([id,label])=><label key={id}><input type="checkbox" checked={(agent.departments??[]).includes(id)} disabled={teamBusy} onChange={event=>{const departments=event.target.checked?[...(agent.departments??[]),id]:(agent.departments??[]).filter(x=>x!==id);if(departments.length)void updateAgent(agent.id,{departments} as unknown as Record<string,string|boolean>)}}/>{label}</label>)}</div>}<button className="team-toggle" disabled={sessionUser?.role !== 'admin' || teamBusy} onClick={() => void updateAgent(agent.id, { is_active: !agent.is_active })}>{agent.is_active ? 'Deactivate' : 'Activate'}</button></article> })}</div></section></div>}
    {editingContact && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingContact(false) }}><section className="conversation-modal contact-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title"><div className="modal-header"><div><p className="eyebrow">CONTACT DETAILS</p><h2 id="edit-contact-title">Edit contact</h2></div><button className="icon-btn" onClick={() => setEditingContact(false)} aria-label="Close edit contact"><X size={18} /></button></div><div className="conversation-form contact-edit-form"><label htmlFor="edit-contact-name">{selected && (selected.name === selected.phone || selected.name === displayPhone(selected.phone)) ? "Name this customer" : "Customer name"}</label><input id="edit-contact-name" autoFocus placeholder="Enter customer name" value={contactNameDraft} onChange={(event) => setContactNameDraft(event.target.value)} required /><p style={{ margin: "0 0 8px", color: "#738398", fontSize: 12 }}>Phone: {selected ? displayPhone(selected.phone) : ""} — unchanged</p><label htmlFor="edit-contact-type">Type</label><select id="edit-contact-type" value={contactTypeDraft} onChange={(event) => setContactTypeDraft(event.target.value as 'customer' | 'supplier')}><option value="customer">Customer</option><option value="supplier">Supplier</option></select><div className="modal-actions contact-edit-actions"><button type="button" className="secondary-btn" onClick={() => setEditingContact(false)}>Cancel</button><button className="send-btn" type="button" disabled={contactSaveBusy} onClick={() => void saveContact()}>{contactSaveBusy ? 'Saving…' : 'Save contact'}</button></div></div></section></div>}
    {newConversationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewConversationOpen(false) }}><section className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title"><div className="modal-header"><div><p className="eyebrow">WHATSAPP</p><h2 id="new-conversation-title">New conversation</h2></div><button className="icon-btn" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation"><X size={18} /></button></div><form className="conversation-form" onSubmit={(event) => void createConversation(event)}><label htmlFor="new-contact-name">Contact name</label><input id="new-contact-name" value={newConversationName} onChange={(event) => setNewConversationName(event.target.value)} placeholder="Contact name" required /><label htmlFor="new-contact-phone">WhatsApp number</label><div className="international-phone-field"><div className="country-code-control"><select aria-label="Country dialing code" value={newConversationCountry} onChange={(event) => setNewConversationCountry(event.target.value)}>{dialingCountries.map(([flag, name, code]) => <option key={name} value={code}>{flag} {code}</option>)}</select><ChevronDown size={15} className="country-code-chevron" aria-hidden="true" /></div><div className="international-phone-input"><span className="phone-input-symbol" aria-hidden="true">☎</span><input id="new-contact-phone" value={newConversationPhone} onChange={(event) => setNewConversationPhone(event.target.value.replace(/[^0-9\s()-]/g, ""))} placeholder="Phone number" inputMode="tel" required /></div></div><label htmlFor="new-first-message">First message</label><textarea id="new-first-message" value={newConversationMessage} onChange={(event) => setNewConversationMessage(event.target.value)} placeholder="Write the first message" rows={4} disabled={newConversationTemplateActive} required={!newConversationTemplateActive} /><WhatsAppTemplatePicker onChange={setNewConversationTemplate} onActiveChange={setNewConversationTemplateActive} disabled={newConversationBusy}/><p className="form-help">For a new contact or a conversation outside the 24-hour window, select an approved Meta template. Fill in any variables before sending.</p>{newConversationError && <p className="login-error" role="alert">{newConversationError}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setNewConversationOpen(false)}>Cancel</button><button className="send-btn" type="submit" disabled={newConversationBusy || (newConversationTemplateActive && !newConversationTemplate)}>{newConversationBusy ? 'Creating…' : 'Create and send'}</button></div></form></section></div>}
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteBusy) setDeleteTarget(null) }}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" style={{ background: '#fff', width: 'min(350px, calc(100vw - 32px))', borderRadius: 14, padding: 20, boxShadow: '0 20px 65px #14283a35' }}><div style={{ width: 34, height: 34, borderRadius: 10, background: '#fff1ef', color: '#d8493d', display: 'grid', placeItems: 'center', marginBottom: 12 }}><Trash2 size={17}/></div><h2 id="delete-dialog-title" style={{ margin: '0 0 7px', fontSize: 17, color: '#17263c' }}>{deleteTarget.messageId ? 'Delete message?' : 'Delete conversation?'}</h2><p id="delete-dialog-description" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#657386' }}>{deleteTarget.messageId ? 'This message will be permanently removed from Myticket Shared Inbox.' : `The conversation with ${deleteTarget.name} and its message history will be permanently removed from Myticket Shared Inbox.`} It will remain visible in the customer's WhatsApp. This action cannot be undone.</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}><button type="button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)} style={{ padding: '8px 12px', border: '1px solid #dbe2ea', borderRadius: 9, background: '#fff', color: '#344054', cursor: 'pointer', fontWeight: 600 }}>Cancel</button><button type="button" disabled={deleteBusy} onClick={() => void confirmInboxDeletion()} style={{ padding: '8px 12px', border: 0, borderRadius: 9, background: '#d94338', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: deleteBusy ? .6 : 1 }}>{deleteBusy ? 'Deleting…' : deleteTarget.messageId ? 'Delete message' : 'Delete conversation'}</button></div></section></div>}
  </main>
}

'use client'

import { Fragment, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import '@/lib/stress-test'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { WhatsAppTemplatePicker, type TemplateSelection } from '@/components/whatsapp-template-picker'
import { TagManager } from '@/components/tag-manager'
import { ConversationTags } from '@/components/conversation-tags'
import { SmartReplyBar } from '@/components/smart-reply-bar'
import { QuickReplyList, parseReplyTitle } from '@/components/quick-reply-list'
import { ZoomableImage } from '@/components/zoomable-image'
import { DocumentViewer } from '@/components/document-viewer'
import { GroupMessage } from '@/components/group-message'
import { AutoReplySettings } from '@/components/auto-reply-settings'
import { detectLanguage, normalize as normalizeReplyText } from '@/lib/replies/intents'
import { Archive, Bell, Camera, Check, CheckCircle2, Clock, ChevronDown, ChevronRight, Copy, Forward, KeyRound, Keyboard, LogOut, FileText, MessageCircle, MessageSquareCheck, Inbox, Lock, Menu, Mic, Pause, Play, Square, MoreHorizontal, Paperclip, Plus, Reply, Search, Send, Settings, Smile, Tag, Trash2, Users, X } from 'lucide-react'

// Apple-style emoji sprites for a WhatsApp-like picker; Unicode text remains unchanged.
// Keep the original Unicode character for messages; only the picker appearance changes.
// The Apple set names some files with the FE0F selector (❤️ → 2764-fe0f.png) and others without, so try both.
function emojiArtworkUrls(emoji: string) {
  const base = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/'
  const bare = Array.from(emoji).map((char) => char.codePointAt(0)!).filter((point) => point !== 0xfe0f).map((point) => point.toString(16)).join('-')
  return [...new Set([`${base}${bare}.png`, `${base}${bare}-fe0f.png`])]
}
function emojiArtworkUrl(emoji: string) { return emojiArtworkUrls(emoji)[0] }
// Image elements built outside React (composer): walk the candidates, then fall back to the text emoji.
function attachEmojiFallback(img: HTMLImageElement, emoji: string) {
  const urls = emojiArtworkUrls(emoji)
  let attempt = 0
  img.addEventListener('error', function retry() { attempt += 1; if (attempt < urls.length) img.src = urls[attempt]; else { img.removeEventListener('error', retry); img.replaceWith(document.createTextNode(emoji)) } })
}

function EmojiArtwork({ emoji }: { emoji: string }) {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => setAttempt(0), [emoji])
  const urls = emojiArtworkUrls(emoji)
  return attempt >= urls.length ? <span className="emoji-native-fallback">{emoji}</span> : <img className="emoji-artwork" src={urls[attempt]} alt="" loading="lazy" onError={() => setAttempt((current) => current + 1)} />
}

// Rich-text composer: emoji images are visual only; outgoing messages remain Unicode text.
function EmojiComposer({ value, onChange, onSend, onFile, editorRef, placeholder = 'Type a message...' }: { value: string; onChange: (value: string) => void; onSend: () => void; onFile?: (file: File) => void; editorRef: RefObject<HTMLDivElement | null>; placeholder?: string }) {
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
    // Keep runs of plain text in one text node: Safari draws Arabic letters split across text nodes with gaps
    // between them ("المشـكلة"), even though the sent text is correct.
    let run = ''
    const flush = () => { if (run) { root.append(document.createTextNode(run)); run = '' } }
    for (const segment of segments) {
      if (segment === '\n') { flush(); root.append(document.createElement('br')); continue }
      if (/\p{Extended_Pictographic}/u.test(segment) || /[\u{1F1E6}-\u{1F1FF}]/u.test(segment)) {
        flush()
        const img = document.createElement('img')
        img.src = emojiArtworkUrl(segment)
        img.alt = segment
        img.dataset.emoji = segment
        img.className = 'composer-emoji'
        img.draggable = false
        attachEmojiFallback(img, segment)
        root.append(img)
      } else run += segment
    }
    flush()
  }
  useEffect(() => {
    const root = editorRef.current
    if (root && read(root) !== value) render(root, value)
  }, [value, editorRef])
  const sync = () => { if (editorRef.current) onChange(read(editorRef.current)) }
  return <div ref={editorRef} className="emoji-composer-editor" dir="auto" role="textbox" aria-label="Message" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder={placeholder} onInput={sync} onPaste={event => { event.preventDefault(); const file = event.clipboardData.files?.[0]; if (file && onFile) { onFile(file); return } const text = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend() } }} />
}

type Status = 'open' | 'pending' | 'closed'
type Agent = { invitation_status?: 'pending' | 'accepted' | 'active' | 'unknown'; invited_at?: string | null; departments?: string[]; id: string; display_name: string; email?: string; auth_user_id?: string; role?: 'admin' | 'agent'; availability?: 'available' | 'away' | 'offline'; is_active?: boolean; whatsapp_conversations?: { id: string; status: Status; whatsapp_contacts?: { display_name?: string; phone?: string } }[] }
type Message = { date: string; id: string; from: 'customer' | 'agent'; text: string; time: string; status?: string; failureReason?: string; attachmentUrl?: string; attachmentName?: string; externalId?: string; replyToExternalId?: string; senderName?: string }
type Conversation = { id: string; name: string; initials: string; color: string; type: 'Customer' | 'Vendor' | 'Team'; phone: string; preview: string; time: string; lastMessageAt: string | null; unread: number; status: Status; assignedTo: string | null; agentName?: string; messages: Message[]; notes: Note[] }
type Note = { id: string; body: string; time: string; date: string; agentName: string; agentId?: string; mentions: string[] }
type SavedReply = { id: string; title: string; body: string }

const colors = ['#ff5a1f', '#d9774a', '#ff8b5c', '#b94d25']

// [dark background, dark letters colour, light background, light letters colour]: soft pastel circles in light mode, deeper ones in dark mode.
const avatarPalettes = [
  ['#0e624a', '#30dc82', '#dff3ea', '#13795b'], ['#214f98', '#8bc5ff', '#e3ecfb', '#2f5bb7'], ['#6639aa', '#d5b2ff', '#efe7fb', '#6b3fc4'],
  ['#9a3d52', '#ffb5c4', '#fbe5ea', '#b0344f'], ['#995315', '#ffcf83', '#fdeedd', '#b5620f'], ['#087f83', '#8cf4e6', '#dcf3f2', '#0f7f7f'],
  ['#3e5976', '#b3d7f8', '#e6edf4', '#3e5976'], ['#8e3b29', '#ffbaa0', '#fbe6e1', '#b23a2a'],
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
  if (daysAgo > 1 && daysAgo < 7) return date.toLocaleDateString('en-GB', { weekday: 'short' })
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

// Mentions are stored inside an internal note as @[Display Name](agent-id), so they survive edits to agents' names.
const mentionTokenPattern = /@\[([^\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)/g
function noteMentions(body: string) {
  return Array.from(body.matchAll(mentionTokenPattern), (match) => match[2])
}
function notePlainText(body: string) {
  return body.replace(mentionTokenPattern, (_match, name) => `@${name}`)
}
function NoteBody({ body, myAgentId }: { body: string; myAgentId?: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of body.matchAll(mentionTokenPattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push(body.slice(last, index))
    parts.push(<span key={index} className={`note-mention ${match[2] === myAgentId ? 'note-mention-me' : ''}`}>@{match[1]}</span>)
    last = index + match[0].length
  }
  if (last < body.length) parts.push(body.slice(last))
  return <span dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{parts}</span>
}

// Inbox-shaped placeholders that shimmer while a signed-in agent's chats load.
function InboxSkeleton({ shown = false }: { shown?: boolean }) {
  const rows = Array.from({ length: 7 })
  return <main className={shown ? 'inbox-skeleton is-shown' : 'inbox-skeleton'} aria-label="Loading inbox" role="status">
    <aside className="sk-rail"><img src="/brand/myticket-mark.png" alt="" className="sk-logo" /><i /><i /><i /><i /></aside>
    <section className="sk-list">
      <div className="sk-list-head"><b className="sk w55" /><b className="sk dot" /></div>
      <b className="sk sk-search" />
      <div className="sk-tabs"><b className="sk" /><b className="sk" /><b className="sk" /></div>
      {rows.map((_, index) => <div className="sk-row" key={index}><b className="sk sk-avatar" /><div><b className="sk" style={{ width: `${55 + (index * 13) % 30}%` }} /><b className="sk" style={{ width: `${70 + (index * 7) % 25}%` }} /></div></div>)}
    </section>
    <section className="sk-chat">
      <div className="sk-chat-head"><b className="sk sk-avatar" /><b className="sk w30" /></div>
      <div className="sk-thread"><b className="sk in w45" /><b className="sk in w60 tall" /><b className="sk out w40" /><b className="sk in w35" /><b className="sk out w50 tall" /></div>
      <b className="sk sk-composer" />
    </section>
    <nav className="sk-tabbar"><i /><i /><i /><i /><i /></nav>
  </main>
}

// A WhatsApp-style document card: first-page preview for PDFs, then a file icon, name and "pages · size · type".
function documentKind(name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return { ext, label: 'PDF', color: '#d93a3a' }
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return { ext, label: 'DOC', color: '#2b6cd8' }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { ext, label: 'XLS', color: '#1f8a4c' }
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return { ext, label: 'PPT', color: '#d9661f' }
  if (['zip', 'rar', '7z'].includes(ext)) return { ext, label: 'ZIP', color: '#6b6f7a' }
  return { ext, label: (ext || 'FILE').slice(0, 4).toUpperCase(), color: '#6b7a90' }
}
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function DocumentCard({ url, name }: { url: string; name: string }) {
  const kind = documentKind(name)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [size, setSize] = useState<number | null>(null)
  const [preview, setPreview] = useState<'loading' | 'ready' | 'none'>(kind.ext === 'pdf' ? 'loading' : 'none')
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error('unavailable')
        const data = await response.arrayBuffer()
        if (cancelled) return
        setSize(data.byteLength)
        if (kind.ext !== 'pdf') return
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
        if (cancelled) return
        setPages(pdf.numPages)
        const page = await pdf.getPage(1)
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = (card.clientWidth || 280) * Math.min(2, window.devicePixelRatio || 1) / base.width
        const viewport = page.getViewport({ scale })
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        await page.render({ canvas, viewport }).promise
        if (!cancelled) setPreview('ready')
      } catch { if (!cancelled) setPreview('none') }
    }
    // Only download when the card scrolls into view.
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); void load() } }, { rootMargin: '200px' })
    observer.observe(card)
    return () => { cancelled = true; observer.disconnect() }
  }, [url, kind.ext])
  const meta = [pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : null, size !== null ? formatFileSize(size) : null, kind.ext || null].filter(Boolean).join(' · ')
  // The iOS app ignores links that open a new tab, so documents open in an in-app viewer there.
  const [viewerOpen, setViewerOpen] = useState(false)
  return <><a ref={cardRef} className="document-card" href={url} target="_blank" rel="noreferrer" onClick={(event) => { event.stopPropagation(); if ((window as any).Capacitor?.isNativePlatform?.()) { event.preventDefault(); setViewerOpen(true) } }}>
    {kind.ext === 'pdf' && preview !== 'none' && <span className={`document-preview ${preview}`}><canvas ref={canvasRef} aria-hidden="true" /></span>}
    <span className="document-info">
      <span className="document-icon" style={{ background: kind.color }} aria-hidden="true">{kind.label}</span>
      <span className="document-text"><span className="document-name" dir="auto">{name}</span><span className="document-meta">{meta || kind.label}</span></span>
    </span>
  </a>{viewerOpen && <DocumentViewer url={url} name={name} pdf={kind.ext === 'pdf'} onClose={() => setViewerOpen(false)} />}</>
}

function VoiceNotePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [speed, setSpeed] = useState(1)
  // A speech-like waveform: quiet start, louder middle, varied per message so notes don't all look the same.
  const bars = useMemo(() => {
    let seed = Array.from(src || 'voice').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17)
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    return Array.from({ length: 34 }, (_, index) => {
      const envelope = index < 4 ? 0.18 + index * 0.08 : index > 30 ? 0.35 : 0.55 + 0.45 * Math.abs(Math.sin(index * 0.42))
      return Math.max(3, Math.round(24 * envelope * (0.45 + random() * 0.55)))
    })
  }, [src])
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
  // The audio element only reports its time about four times a second, which made the dot jump in steps;
  // while playing, read the time on every frame so it glides.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) {
        setPosition(audio.currentTime)
        // Some browsers never fire a usable durationchange for streamed voice notes; keep asking while playing.
        const known = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audio.seekable.length ? audio.seekable.end(audio.seekable.length - 1) : 0
        if (Number.isFinite(known) && known > 0) setDuration((current) => Number.isFinite(current) && current >= known ? current : known)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])
  const progress = duration > 0 ? Math.min(1, position / duration) : 0
  const knownDuration = Number.isFinite(duration) && duration > 0
  return <div className={`myticket-voice-player ${playing ? 'is-playing' : ''}`}>
    <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={(event) => {
      const audio = event.currentTarget
      setDuration(audio.duration)
      // Recorded WebM/Ogg files often report an unknown length until the end is read; jump there once to learn it.
      if (!Number.isFinite(audio.duration)) { const reset = () => { audio.removeEventListener('timeupdate', reset); setDuration(audio.duration); audio.currentTime = 0; setPosition(0) }; audio.addEventListener('timeupdate', reset); audio.currentTime = 1e101 }
    }} onDurationChange={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration) }} onTimeUpdate={(event) => { if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.currentTime <= event.currentTarget.duration) setPosition(event.currentTarget.currentTime) }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(0) }} aria-label="Voice recording" />
    <button type="button" className="voice-play" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>{playing
      ? <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7.5 4.8v14.4c0 .9 1 1.4 1.7.9l10.3-7.2c.6-.4.6-1.4 0-1.8L9.2 3.9c-.7-.5-1.7 0-1.7.9Z" fill="currentColor" /></svg>}</button>
    <div className="voice-wave" role="slider" tabIndex={0} aria-label="Voice playback position" aria-valuemin={0} aria-valuemax={Math.max(1, Math.floor(knownDuration ? duration : 0))} aria-valuenow={Math.floor(position)} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); seek(progress + 5 / (duration || 1)) } if (event.key === 'ArrowLeft') { event.preventDefault(); seek(progress - 5 / (duration || 1)) } }} onClick={(event) => seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width)}>
      {bars.map((height, index) => <span key={index} className={(index + 0.5) / bars.length <= progress ? 'played' : ''} style={{ height }} />)}
      <i className="voice-dot" style={{ left: `calc(${progress.toFixed(4)} * (100% - 12px))` }} aria-hidden="true" />
    </div>
    <span className="voice-time">{playing || position > 0 ? format(position) : knownDuration ? format(duration) : '0:00'}</span>
    {(playing || speed !== 1) && <button type="button" className="voice-speed" onClick={changeSpeed} aria-label={`Playback speed ${speed} times. Click to change`}>{speed}×</button>}
  </div>
}

// Search: case-insensitive, NFKC, and Arabic spelling variants treated alike (أ/إ/آ→ا, ة→ه, ى→ي, no tashkeel).
function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim()
}

// Highlight every occurrence of the search words inside a piece of text.
function SearchHighlight({ text, query }: { text: string; query: string }) {
  const needle = normalizeSearch(query)
  if (!needle) return <>{text}</>
  // Map positions of the normalized text back to the original so Arabic variants still highlight.
  const chars = Array.from(text)
  const normalizedChars = chars.map((char) => normalizeSearch(char) || (/\s/.test(char) ? ' ' : ''))
  const joined = normalizedChars.join('')
  const parts: React.ReactNode[] = []
  let cursor = 0, from = 0, offset = 0
  const starts: number[] = []
  normalizedChars.forEach((piece) => { starts.push(offset); offset += piece.length })
  while (true) {
    const found = joined.indexOf(needle, from)
    if (found < 0) break
    const startChar = starts.findIndex((start, index) => start + normalizedChars[index].length > found)
    let endChar = startChar
    while (endChar < chars.length && starts[endChar] < found + needle.length) endChar++
    if (startChar > cursor) parts.push(chars.slice(cursor, startChar).join(''))
    parts.push(<mark key={found} className="search-hit">{chars.slice(startChar, endChar).join('')}</mark>)
    cursor = endChar
    from = found + Math.max(1, needle.length)
  }
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(''))
  return <>{parts}</>
}

// A short piece of a message around the first search hit, so the matching word is visible in the list.
function searchSnippet(text: string, query: string) {
  const needle = normalizeSearch(query)
  const chars = Array.from(text.replace(/\s+/g, ' '))
  let offset = 0
  const starts = chars.map((char) => { const at = offset; offset += (normalizeSearch(char) || (char === ' ' ? ' ' : '')).length; return at })
  const found = chars.map((char) => normalizeSearch(char) || (char === ' ' ? ' ' : '')).join('').indexOf(needle)
  if (found < 0 || chars.length <= 60) return chars.join('')
  const hit = Math.max(0, starts.findIndex((start) => start >= found))
  const from = Math.max(0, hit - 22)
  return (from > 0 ? '…' : '') + chars.slice(from).join('')
}

// A tidy dropdown for the Contact details rows (Assigned to, Conversation status): the current choice with a chevron,
// opening a small list with icons and a tick on the current option.
function DetailPicker({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; hint?: string; icon?: React.ReactNode }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const current = options.find((option) => option.value === value) ?? options[0]
  return <div className="detail-picker" ref={ref}>
    <button type="button" className="detail-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label}`} onClick={() => setOpen(!open)}><span dir="auto">{current?.label}</span><ChevronDown size={15} aria-hidden="true" /></button>
    {open && <div className="detail-picker-menu" role="listbox" aria-label={label}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value || 'none'} className={option.value === value ? 'is-current' : ''} onClick={() => { setOpen(false); if (option.value !== value) onChange(option.value) }}>{option.icon}<span className="detail-picker-label" dir="auto">{option.label}{option.hint && <small>{option.hint}</small>}</span>{option.value === value && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}</button>)}</div>}
  </div>
}

// The voice-note converter (about 30 MB) is downloaded once per app session and starts downloading as soon as
// recording begins, so pressing Send no longer waits for it. Conversion itself is unchanged.
let ffmpegCorePromise: Promise<{ coreURL: string; wasmURL: string }> | null = null
function loadFfmpegCore(toBlobURL: (url: string, mimeType: string) => Promise<string>) {
  if (!ffmpegCorePromise) {
    const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
    ffmpegCorePromise = Promise.all([toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'), toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm')])
      .then(([coreURL, wasmURL]) => ({ coreURL, wasmURL }))
      .catch((error) => { ffmpegCorePromise = null; throw error })
  }
  return ffmpegCorePromise
}
function prefetchFfmpegCore() { void import('@ffmpeg/util').then(({ toBlobURL }) => loadFfmpegCore(toBlobURL)).catch(() => {}) }

const searchTextCache = new WeakMap<object, string>()
function searchableText(message: { text?: string; attachmentName?: string }) {
  let text = searchTextCache.get(message)
  if (text === undefined) { text = normalizeSearch(message.text || message.attachmentName || ''); searchTextCache.set(message, text) }
  return text
}

const THREAD_PAGE = 120
const LIST_PAGE = 60
const INBOX_CACHE_KEY = 'inbox-cache-v1'
function clearDeviceInboxData() { try { localStorage.removeItem(INBOX_CACHE_KEY); localStorage.removeItem('inbox-drafts') } catch {} }

function agentInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?'
}

function contactInitials(name: string, phone: string) {
  const shown = contactDisplayName(name, phone)
  if (shown === displayPhone(phone)) return ''
  const letters = shown.split(/\s+/).map((word) => word.match(/\p{L}/u)?.[0]).filter(Boolean) as string[]
  if (!letters.length) return ''
  // Arabic and other joining scripts read oddly as two loose letters, so use one there.
  if (/[\u0590-\u08FF]/.test(letters[0])) return letters[0]
  return (letters[0] + (letters.length > 1 ? letters[letters.length - 1] : '')).toUpperCase()
}

function ContactAvatar({ phone, name = '', className = '' }: { phone: string; name?: string; className?: string }) {
  const hash = Array.from(phone || 'unknown').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7)
  const [darkBackground, darkForeground, background, foreground] = avatarPalettes[hash % avatarPalettes.length]
  const initials = contactInitials(name, phone)
  return <div className={`avatar contact-avatar ${className}`} style={{ '--av-bg': background, '--av-fg': foreground, '--av-bg-dark': darkBackground, '--av-fg-dark': darkForeground } as React.CSSProperties} aria-label={initials ? `${contactDisplayName(name, phone)} profile image` : 'Default contact profile image'}>
    <svg viewBox="0 0 48 48" width={initials ? '100%' : '62%'} height={initials ? '100%' : '62%'} aria-hidden="true" focusable="false" style={{ display: 'block', margin: 'auto' }}>
      {initials
        ? <text x="24" y="25" textAnchor="middle" dominantBaseline="central" fontSize={initials.length > 1 ? 18 : 21} fontWeight="600" style={{ fontFamily: 'inherit', fill: 'var(--av-fg)' }}>{initials}</text>
        : <><circle cx="24" cy="16" r="8" style={{ fill: 'var(--av-fg)' }} /><path d="M9 39c0-8 6.7-13 15-13s15 5 15 13v2H9z" style={{ fill: 'var(--av-fg)' }} /></>}
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
  // Other international numbers: split off a known country code and space the rest into readable groups.
  if (digits.length >= 10 && digits.length <= 15) {
    const code = dialingCountries.map(([, , dial]) => dial.slice(1)).filter((dial) => digits.startsWith(dial)).sort((a, b) => b.length - a.length)[0]
    if (!code) return '+' + digits
    const rest = digits.slice(code.length)
    const groups = rest.length === 10 && code === '91' ? [5, 5] : rest.length === 8 ? [4, 4] : rest.length === 9 ? [3, 3, 3] : rest.length === 10 ? [3, 3, 4] : rest.length === 11 ? [3, 4, 4] : []
    if (!groups.length) return `+${code} ${rest}`
    let at = 0
    return `+${code} ` + groups.map((size) => rest.slice(at, at += size)).join(' ')
  }
  return raw
}

function contactDisplayName(name: string, phone: string) {
  const cleanName = (name || '').trim()
  return !cleanName || cleanName.replace(/\D/g, '') === (phone || '').replace(/\D/g, '')
    ? displayPhone(phone)
    : cleanName
}


const dialingCountries = [["🇴🇲","Oman","+968"],["🇦🇪","United Arab Emirates","+971"],["🇸🇦","Saudi Arabia","+966"],["🇶🇦","Qatar","+974"],["🇧🇭","Bahrain","+973"],["🇰🇼","Kuwait","+965"],["🇺🇸","United States","+1"],["🇨🇦","Canada","+1"],["🇬🇧","United Kingdom","+44"],["🇮🇳","India","+91"],["🇵🇰","Pakistan","+92"],["🇪🇬","Egypt","+20"],["🇯🇴","Jordan","+962"],["🇱🇧","Lebanon","+961"],["🇲🇦","Morocco","+212"],["🇩🇪","Germany","+49"],["🇫🇷","France","+33"],["🇹🇷","Türkiye","+90"],["🇵🇭","Philippines","+63"],["🇧🇩","Bangladesh","+880"],["🇮🇩","Indonesia","+62"],["🇲🇾","Malaysia","+60"],["🇦🇺","Australia","+61"],["🇨🇳","China","+86"],["🇯🇵","Japan","+81"],["🇿🇦","South Africa","+27"],["🇳🇵","Nepal","+977"],["🇱🇰","Sri Lanka","+94"],["🇸🇬","Singapore","+65"],["🇮🇹","Italy","+39"],["🇪🇸","Spain","+34"],["🇳🇱","Netherlands","+31"],["🇧🇷","Brazil","+55"],["🇲🇽","Mexico","+52"]]

// Chat list preview for a conversation whose latest activity is a reaction: "You reacted with ❤️ on "Hi"".
// Light tints: agent names sit on brand-orange bubbles, so each agent gets a pale colour that stays readable.
const senderNameColors = ['#ffffff', '#fff1a8', '#d4f1ff', '#dcffd0', '#ffe0f3', '#ece3ff', '#ffe2c4', '#c9fff1', '#fffbe6', '#e3ebff']
function senderNameColor(name: string) {
  let hash = 0
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return senderNameColors[hash % senderNameColors.length]
}

function reactionPreview(messages: any[]) {
  const last = messages.at(-1)
  if (last?.attachment_name !== 'reaction' || !last.body) return null
  const target = messages.find((message) => message.external_id && message.external_id === last.reply_to_external_id)
  const text = String(target?.body || (target?.attachment_name === 'sticker attachment' ? 'Sticker' : target?.attachment_name) || 'a message')
  const quoted = text.length > 40 ? text.slice(0, 40).trimEnd() + '…' : text
  return `${last.direction === 'outbound' ? 'You reacted' : 'Reacted'} with ${last.body} on "${quoted}"`
}

export default function Page() {
  // iPadOS Safari keeps the layout viewport tall when the software keyboard
  // appears. Size the fixed inbox to the visible viewport while editing.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const shell = document.documentElement
    // Newer iOS shrinks window.innerHeight together with the keyboard, so compare against the
    // tallest visible height seen at this width instead.
    let fullHeight = viewport.height
    let fullWidth = viewport.width
    // Phone sheets (+ menu, stickers) open at the keyboard's height so switching between them doesn't move the composer.
    try { const saved = Number(localStorage.getItem('inbox-keyboard-height')); if (saved > 0) shell.style.setProperty('--kb-height', saved + 'px') } catch {}
    const update = () => {
      const editing = document.activeElement instanceof HTMLElement &&
        (document.activeElement.isContentEditable || ['INPUT','TEXTAREA'].includes(document.activeElement.tagName))
      if (Math.abs(viewport.width - fullWidth) > 1) { fullWidth = viewport.width; fullHeight = viewport.height }
      if (!editing || viewport.height > fullHeight) fullHeight = Math.max(viewport.height, editing ? fullHeight : 0)
      // In the iOS app the keyboard height comes from the keyboard itself as it starts to open (NativeBridge),
      // so the composer moves with it instead of waiting for the viewport to shrink. It counts as open until
      // the keyboard starts to close (not when the field blurs a moment earlier), so closing slides too.
      let nativeKeyboard = Number(shell.dataset.nativeKb || 0)
      // iPad: iOS can report a full keyboard height when only the small shortcut bar shows (hardware keyboard,
      // or a minimised keyboard), which left a big empty gap under the composer. Trust the measured visible
      // area there whenever it clearly disagrees.
      if (nativeKeyboard && !window.matchMedia('(max-width: 900px)').matches) {
        const measured = Math.max(0, Math.round(Math.max(fullHeight, window.innerHeight) - viewport.height))
        if (measured >= 30 && nativeKeyboard - measured > 100) nativeKeyboard = measured
      }
      const keyboardVisible = nativeKeyboard > 0 ? true : editing && Math.max(fullHeight, window.innerHeight) - viewport.height > 120
      const thread = document.querySelector<HTMLElement>('.app-shell .thread')
      if (keyboardVisible && !shell.classList.contains('keyboard-open') && thread) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight })
      shell.classList.toggle('keyboard-open', keyboardVisible)
      shell.style.setProperty('--inbox-full-height', Math.round(fullHeight) + 'px')
      if (keyboardVisible) {
        const keyboardHeight = nativeKeyboard || Math.round(fullHeight - viewport.height)
        if (keyboardHeight > 200 && keyboardHeight < 520) {
          shell.style.setProperty('--kb-height', keyboardHeight + 'px')
          try { localStorage.setItem('inbox-keyboard-height', String(keyboardHeight)) } catch {}
        }
        shell.classList.remove('composer-sheet-hold')
      }
      // iOS also scrolls the document towards the focused composer, which pushes the chat header off screen.
      if (keyboardVisible && window.scrollY) window.scrollTo(0, 0)
      if (keyboardVisible) {
        shell.style.setProperty('--inbox-visual-height', Math.round(nativeKeyboard ? fullHeight - nativeKeyboard : viewport.height) + 'px')
        // iPadOS pans the visual viewport, so the fixed shell follows offsetTop there. On iPhone, offsetTop
        // spikes while the keyboard animates and following it pushed the chat header down and back up.
        const phone = window.matchMedia('(max-width: 900px)').matches
        shell.style.setProperty('--inbox-visual-top', phone ? '0px' : Math.max(0, Math.round(viewport.offsetTop - window.scrollY)) + 'px')
      } else {
        shell.style.removeProperty('--inbox-visual-height')
        shell.style.removeProperty('--inbox-visual-top')
      }
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', update)
    window.addEventListener('native-keyboard', update)
    update()
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('focusin', update)
      window.removeEventListener('focusout', update)
      window.removeEventListener('native-keyboard', update)
      shell.style.removeProperty('--inbox-visual-height')
      shell.style.removeProperty('--inbox-visual-top')
      shell.style.removeProperty('--inbox-full-height')
      shell.classList.remove('keyboard-open', 'composer-sheet-open', 'composer-sheet-hold')
    }
  }, [])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'unread' | 'open' | 'pending' | 'closed' | 'mentions'>('all')
  const [query, setQuery] = useState('')
  const [editingContact, setEditingContact] = useState(false)
  const [contactNameDraft, setContactNameDraft] = useState('')
  const [contactTypeDraft, setContactTypeDraft] = useState<'customer' | 'supplier' | 'team'>('customer')
  const [contactSaveBusy, setContactSaveBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageSendError, setMessageSendError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ conversationId: string; messageId?: string; name: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<Agent | null>(null)
  const sendInProgress = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const previousThread = useRef<{ id: string; count: number } | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiSearch, setEmojiSearch] = useState('')
  const [emojiCategory, setEmojiCategory] = useState('recent')
  // Composer can write to the customer (reply) or leave an internal note for the team (note).
  const [composerMode, setComposerMode] = useState<'reply' | 'note'>('reply')
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({})
  const [mentionPickerIndex, setMentionPickerIndex] = useState(0)
  const [mentionSeen, setMentionSeen] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('inbox-mention-seen') || '{}') } catch { return {} } })
  const [mentionToast, setMentionToast] = useState<{ conversationId: string; author: string; contact: string } | null>(null)
  const alertedMentionsRef = useRef<Set<string> | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1400px)').matches)
  const [openMessageMenu, setOpenMessageMenu] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [stickerOpen,setStickerOpen]=useState(false)
  const [composerMenuOpen, setComposerMenuOpen] = useState(false)
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false)
  const [mobileTagsOpen, setMobileTagsOpen] = useState(false)
  const [savedStickers,setSavedStickers]=useState<{id:string;media_id:string}[]>([])
  const loadStickers=async()=>{const r=await fetch('/api/stickers');if(r.ok){const p=await r.json();setSavedStickers(p.stickers??[])}}
  const saveSticker=async(id:string)=>{const r=await fetch('/api/stickers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:id})});if(r.ok){await loadStickers();setStickerOpen(true)}else alert((await r.json()).error||'Could not save sticker')}
  const sendSticker=async(mediaId:string)=>{if(!selected)return;setSendingMessage(true);try{const r=await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:selected.id,to:selected.phone,mediaId,attachmentType:'sticker'})});const p=await r.json();if(!r.ok)throw Error(p.error||'Could not send sticker');setStickerOpen(false);await load()}catch(e){setMessageSendError(e instanceof Error?e.message:'Could not send sticker')}finally{setSendingMessage(false)}}
  const [mediaPreview, setMediaPreview] = useState<{url:string;kind:'image'|'video';name:string}|null>(null)
  // Only one transient popover may be open at a time.
  const closeTransientMenus = () => {
    setOpenMessageMenu(null)
    setProfileMenuOpen(false)
    setEmojiOpen(false)
    setStickerOpen(false)
    setComposerMenuOpen(false)
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
  // Pressing send while recording stops the recording and sends it as soon as the file is ready (like WhatsApp).
  const sendAfterStopRef = useRef(false)
  // Whether the message field had the keyboard when send was pressed: the keyboard then stays up for the next message.
  const editorFocusedAtSendRef = useRef(false)
  const clearVoice = () => { setVoiceFile(null); setVoicePreviewUrl(url => { if (url) URL.revokeObjectURL(url); return null }) }
  const startVoiceRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Audio recording is not supported in this browser.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      prefetchFfmpegCore()
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
    sendAfterStopRef.current = false
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
  useEffect(() => {
    if (!voiceFile || !sendAfterStopRef.current) return
    sendAfterStopRef.current = false
    void sendVoiceMessage()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceFile])
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
      try {
        const core = await loadFfmpegCore(toBlobURL)
        await ffmpeg.load(core)
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
  // False until the signed-in agent's conversations have loaded once, so a fresh sign-in shows the skeleton, not an empty inbox.
  const [inboxReady, setInboxReady] = useState(false)
  const [sessionUser, setSessionUser] = useState<{ email?: string; role?: string; agentId?: string } | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  // The + button offers "Start a conversation" (one person) or "Group message" (a template to a list from Excel).
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [groupMessageOpen, setGroupMessageOpen] = useState(false)
  useEffect(() => {
    if (!newMenuOpen) return
    const close = (event: Event) => { if (!(event.target as HTMLElement | null)?.closest?.('.new-conversation-menu-wrap')) setNewMenuOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setNewMenuOpen(false) }
    document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', onKey) }
  }, [newMenuOpen])
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
  const [showPushPrompt, setShowPushPrompt] = useState(false)
  useEffect(() => {
    if (!sessionUser) { setShowPushPrompt(false); return }
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    if (sessionStorage.getItem('myticket-push-prompt-dismissed') === '1') return
    const timer = window.setTimeout(() => setShowPushPrompt(true), 1200)
    return () => window.clearTimeout(timer)
  }, [sessionUser?.email])
  const [pushTestBusy, setPushTestBusy] = useState(false)
  const lastSoundEventRef = useRef<string | null>(null)
  const [selfAvailability, setSelfAvailability] = useState<'available' | 'away' | 'offline'>('available')
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([])
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false)
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false)
  // While a phone sheet is open the chat keeps the keyboard-open layout. Closing it to type keeps that layout
  // until the keyboard reports in, so the composer doesn't drop to the bottom and jump back up.
  const composerSheetOpen = composerMenuOpen || stickerOpen || emojiOpen || chatTemplateOpen
  useEffect(() => {
    const root = document.documentElement
    if (composerSheetOpen) { root.classList.add('composer-sheet-open'); root.classList.remove('composer-sheet-hold'); return }
    if (!root.classList.contains('composer-sheet-open')) return
    root.classList.remove('composer-sheet-open')
    if (!(document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)) return
    root.classList.add('composer-sheet-hold')
    const release = window.setTimeout(() => root.classList.remove('composer-sheet-hold'), 900)
    return () => window.clearTimeout(release)
  }, [composerSheetOpen])
  const [savedReplySearch, setSavedReplySearch] = useState('')
  const [replyFormOpen, setReplyFormOpen] = useState(false)
  const [expandedReplyId, setExpandedReplyId] = useState<string | null>(null)
  const [deleteArmedReplyId, setDeleteArmedReplyId] = useState<string | null>(null)
  const [replyCopiedId, setReplyCopiedId] = useState<string | null>(null)
  const [savedReplyBusy, setSavedReplyBusy] = useState(false)
  const [savedReplyError, setSavedReplyError] = useState('')
  const [savedReplyTitle, setSavedReplyTitle] = useState('')
  const [savedReplyBody, setSavedReplyBody] = useState('')
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)
  const [teamNotice, setTeamNotice] = useState('')
  const [agentInvitationLink, setAgentInvitationLink] = useState('')
  const [newAgentRole, setNewAgentRole] = useState<'admin' | 'agent'>('agent')
  const [newAgentDepartments, setNewAgentDepartments] = useState<string[]>(['customer_support'])
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentEmail, setNewAgentEmail] = useState('')
  const attachmentInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const messageInput = useRef<HTMLDivElement>(null)
  const selected = selectedId ? conversations.find((item) => item.id === selectedId) : undefined
  // Reactions are stored as small rows pointing at the reacted message; show them as a badge, not a bubble.
  const isReactionRow = (message: Message) => message.attachmentName === 'reaction' || message.attachmentName === 'reaction attachment'
  const selectedVisibleMessages = selected ? selected.messages.filter((message) => !isReactionRow(message)) : []
  // Latest reaction from each side per message; an empty emoji means it was removed.
  const selectedReactions = new Map<string, string>()
  const latestReactions = new Map<string, { customer?: string; agent?: string }>()
  for (const message of selected?.messages ?? []) if (message.attachmentName === 'reaction' && message.replyToExternalId) latestReactions.set(message.replyToExternalId, { ...latestReactions.get(message.replyToExternalId), [message.from]: message.text })
  const myReaction = (message: Message) => (message.externalId && latestReactions.get(message.externalId)?.agent) || ''
  for (const [externalId, sides] of latestReactions) { const emojis = [sides.customer, sides.agent].filter(Boolean).join(''); if (emojis) selectedReactions.set(externalId, emojis) }

  const replyWindowOpen = !!selected?.messages.some(message => message.from === 'customer' && Date.now() - new Date(message.date).getTime() < 24 * 60 * 60 * 1000)

  // One API conversation row → the inbox's Conversation shape (used by the list and by single-chat refreshes).
  const mapConversationRow = (row: any, index: number): Conversation => {
      const contact = Array.isArray(row.whatsapp_contacts) ? row.whatsapp_contacts[0] : row.whatsapp_contacts
      const messages = [...(row.whatsapp_messages ?? [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const notes = [...(Array.isArray(row.whatsapp_internal_notes) ? row.whatsapp_internal_notes : [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = messages.at(-1)
      const lastContent = [...messages].reverse().find((message: any) => message.attachment_name !== 'reaction' && message.attachment_name !== 'reaction attachment')
      // NFKC turns decorative Unicode letters (𝐌𝐀𝐍𝐒𝐎𝐎𝐑, 𝓢𝓪𝓻𝓪) into plain ones so names use the app's font and are searchable.
      const rawName = typeof contact?.display_name === 'string' ? contact.display_name.normalize('NFKC').trim() : ''
      const name = rawName && rawName !== '.' ? rawName : (displayPhone(contact?.phone || '') || 'WhatsApp contact')
      const assignedAgent = Array.isArray(row.whatsapp_agents) ? row.whatsapp_agents[0] : row.whatsapp_agents
      return { id: row.id, name, initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(), color: colors[index % colors.length], type: contact?.contact_type === 'supplier' ? 'Vendor' : contact?.contact_type === 'team' ? 'Team' : 'Customer', phone: contact?.phone || '', preview: reactionPreview(messages) ?? (lastContent?.body || lastContent?.attachment_name || ''), time: last?.created_at ? new Date(last.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', lastMessageAt: last?.sent_at || last?.created_at || null, unread: Number(row.unread_count) || 0, status: row.status, assignedTo: row.assigned_agent_id, agentName: assignedAgent?.display_name, messages: messages.map((message: any) => ({ date: message.sent_at || message.created_at || new Date().toISOString(), id: message.id, from: message.direction === 'outbound' ? 'agent' : 'customer', text: message.body || (message.attachment_name ? '' : 'Unsupported WhatsApp message'), time: new Date(message.created_at || message.sent_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: message.status, failureReason: message.failure_reason || undefined, attachmentUrl: message.attachment_url, attachmentName: message.attachment_name, externalId: message.external_id, replyToExternalId: message.reply_to_external_id, senderName: message.sender_name || undefined })), notes: notes.map((note: any) => { const noteAgent = Array.isArray(note.whatsapp_agents) ? note.whatsapp_agents[0] : note.whatsapp_agents; return { id: note.id, body: note.body, time: new Date(note.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), date: note.created_at, agentName: noteAgent?.display_name || 'Agent', agentId: note.agent_id || undefined, mentions: noteMentions(note.body || '') } }) }
  }
  // The list only carries each chat's latest messages, so keep older ones already loaded (when a chat was opened), and
  // keep messages still on their way (shown optimistically) or that failed, so they don't vanish on reload.
  const mergeConversation = (incoming: Conversation, existing?: Conversation, fullHistory = false): Conversation => {
    if (!existing) return incoming
    const isLocal = (message: Message) => /^(pending|failed)-/.test(String(message.id))
    const pending = existing.messages.filter(isLocal)
    let messages = incoming.messages
    if (!fullHistory && messages.length) {
      const oldest = new Date(messages[0].date).getTime()
      const known = new Set(messages.map((message) => message.id))
      const older = existing.messages.filter((message) => !isLocal(message) && !known.has(message.id) && new Date(message.date).getTime() < oldest)
      if (older.length) messages = [...older, ...messages]
    }
    return { ...incoming, color: existing.color, messages: pending.length ? [...messages, ...pending] : messages }
  }

  const hydratedFromCacheRef = useRef(false)
  const cacheUserRef = useRef<string | null>(null)
  useEffect(() => {
    if (!inboxReady || !sessionUser || !cacheUserRef.current || !conversations.length || (window as any).__inboxStress) return
    const timer = window.setTimeout(() => {
      try {
        const trimmed = conversations.slice(0, 60).map((conversation) => ({ ...conversation, messages: conversation.messages.filter((message) => !/^(pending|failed)-/.test(String(message.id))).slice(-20) }))
        localStorage.setItem(INBOX_CACHE_KEY, JSON.stringify({ userId: cacheUserRef.current, agentId: sessionUser.agentId, role: sessionUser.role, savedAt: Date.now(), conversations: trimmed }))
      } catch {}
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [conversations, inboxReady, sessionUser])

  const load = async () => {
    const response = await fetch('/api/inbox', { cache: 'no-store' })
    if (!response.ok) throw new Error('Inbox unavailable')
    const payload = await response.json()
    const rows: Conversation[] = (payload.conversations ?? []).map(mapConversationRow)
    const fromCache = hydratedFromCacheRef.current
    hydratedFromCacheRef.current = false
    // The first load after showing saved chats replaces them (keeping only messages still being sent).
    setConversations((current) => rows.map((row) => { const existing = current.find((conversation) => conversation.id === row.id); return fromCache ? mergeConversation(row, existing ? { ...existing, messages: existing.messages.filter((message) => /^(pending|failed)-/.test(String(message.id))) } : undefined, true) : mergeConversation(row, existing) }))
    setAgents(payload.agents ?? [])
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null)
  }

  // Refresh one chat with its full history (opening a chat, or a realtime change in it) instead of the whole inbox.
  const loadConversation = async (id: string) => {
    const response = await fetch('/api/inbox?conversation=' + encodeURIComponent(id), { cache: 'no-store' })
    if (!response.ok) return
    const { conversation } = await response.json()
    if (!conversation) return
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === id)
      const merged = mergeConversation(mapConversationRow(conversation, index < 0 ? current.length : index), current[index], true)
      if (index < 0) return [merged, ...current]
      const next = [...current]
      next[index] = merged
      const at = (item: Conversation) => (item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : 0)
      if (index > 0 && at(merged) > at(next[0])) { next.splice(index, 1); next.unshift(merged) }
      return next
    })
  }

  useEffect(() => {
    let active = true
    const supabase = createBrowserSupabaseClient()
    if (!supabase) { setIsLoading(false); return }
    let channel: ReturnType<ReturnType<typeof createBrowserSupabaseClient>['channel']> | undefined
    // Realtime bursts (a message plus its status updates) are batched: changed chats refresh on their own after 300 ms,
    // and conversation-level changes (status, assignment, new chats) reload the list at most every 1.5 s.
    const chatTimers = new Map<string, number>()
    let listTimer = 0
    // A new customer message is shown straight from the realtime event, before the chat is fetched again,
    // so it appears together with (not after) the push notification. The fetch that follows fills in the rest.
    const appendRealtimeMessage = (row: any) => setConversations((current) => {
      const index = current.findIndex((item) => item.id === row.conversation_id)
      if (index < 0 || row.direction === 'outbound' || current[index].messages.some((message) => message.id === row.id)) return current
      const conversation = current[index]
      const reaction = row.attachment_name === 'reaction' || row.attachment_name === 'reaction attachment'
      const message: Message = { date: row.sent_at || row.created_at || new Date().toISOString(), id: row.id, from: 'customer', text: row.body || (row.attachment_name ? '' : 'Unsupported WhatsApp message'), time: new Date(row.created_at || row.sent_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: row.status, failureReason: row.failure_reason || undefined, attachmentUrl: row.attachment_url, attachmentName: row.attachment_name, externalId: row.external_id, replyToExternalId: row.reply_to_external_id, senderName: row.sender_name || undefined }
      const updated = { ...conversation, messages: [...conversation.messages, message], ...(reaction ? {} : { preview: row.body || row.attachment_name || conversation.preview, lastMessageAt: row.created_at || new Date().toISOString(), unread: conversation.unread + 1 }) }
      const next = [...current]
      if (reaction) { next[index] = updated; return next }
      next.splice(index, 1)
      return [updated, ...next]
    })
    const queueConversation = (id: string) => { window.clearTimeout(chatTimers.get(id)); chatTimers.set(id, window.setTimeout(() => { chatTimers.delete(id); void loadConversation(id).catch(() => {}) }, 150)) }
    const queueListReload = () => { if (listTimer) return; listTimer = window.setTimeout(() => { listTimer = 0; void load().catch(() => {}) }, 1500) }
    const loadAuthenticatedInbox = async (user: { id: string; email?: string }) => {
      // Instant open: show the chats saved on this device right away, then replace them with fresh data.
      if (!cacheUserRef.current) {
        try {
          const cached = JSON.parse(localStorage.getItem(INBOX_CACHE_KEY) || 'null')
          if (cached && cached.userId === user.id && Array.isArray(cached.conversations) && Date.now() - cached.savedAt < 7 * 24 * 3600 * 1000) {
            hydratedFromCacheRef.current = true
            setSessionUser({ email: user.email, agentId: cached.agentId, role: cached.role || 'agent' })
            setConversations(cached.conversations)
            setSelectedId((current) => current || cached.conversations[0]?.id || null)
            setInboxReady(true)
            setIsLoading(false)
          }
        } catch {}
      }
      cacheUserRef.current = user.id
      const agentResponse = await fetch('/api/inbox?agents=1', { cache: 'no-store' })
      const agentPayload = agentResponse.ok ? await agentResponse.json() : { agents: [] }
      const agent = (agentPayload.agents ?? []).find((item: Agent) => item.auth_user_id === user.id || item.email?.toLowerCase() === user.email?.toLowerCase())
      if (!active) return
      setSessionUser({ email: user.email, agentId: agent?.id, role: agent?.role || 'agent' })
      setSelfAvailability(agent?.availability === 'away' ? 'away' : 'available')
      try { await load() } finally { if (active) setInboxReady(true) }
      if (!active) return
      try { const onChatChange = (change: any) => { const id = change?.new?.conversation_id ?? change?.old?.conversation_id; if (change?.eventType === 'INSERT' && change?.table === 'whatsapp_messages' && change.new) appendRealtimeMessage(change.new); if (id) queueConversation(id); else queueListReload() }; channel = supabase.channel('whatsapp-inbox').on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, onChatChange).on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations' }, () => queueListReload()).on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_internal_notes' }, onChatChange).subscribe() } catch (error) { console.error('[v0] realtime failed', error) }
    }
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      if (data.user) await loadAuthenticatedInbox(data.user)
    }).catch((error) => { console.error('[v0] auth load failed', error) }).finally(() => { if (active) setIsLoading(false) })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session?.user) void loadAuthenticatedInbox(session.user).finally(() => { if (active) setIsLoading(false) })
      else { if (_event === 'SIGNED_OUT') clearDeviceInboxData(); cacheUserRef.current = null; setSessionUser(null); setInboxReady(false); setConversations([]); setSelectedId(null); setIsLoading(false); if (channel) void channel.unsubscribe() }
    })
    return () => { active = false; chatTimers.forEach((timer) => window.clearTimeout(timer)); window.clearTimeout(listTimer); if (channel) void channel.unsubscribe() }
  }, [])

  // Keep incoming WhatsApp messages visible even when Supabase Realtime is unavailable.
  useEffect(() => {
    if (!sessionUser) return
    // Realtime delivers changes instantly; this is only a safety net, so 30 s instead of 5 s (most of the data use).
    const refresh = () => { if (document.visibilityState === 'visible') void load().catch((error) => console.error('[inbox] refresh failed', error)) }
    const interval = window.setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [sessionUser?.email])

  // Opening a chat loads its full history (the list only holds the latest messages of each chat).
  useEffect(() => {
    if (sessionUser && selectedId) void loadConversation(selectedId).catch(() => {})
  }, [selectedId, sessionUser?.email])

  const myAgentId = sessionUser?.agentId
  const mentionNotesForMe = (conversation: Conversation) => myAgentId ? conversation.notes.filter((note) => note.mentions.includes(myAgentId) && note.agentId !== myAgentId) : []
  const hasUnseenMention = (conversation: Conversation) => mentionNotesForMe(conversation).some((note) => !mentionSeen[conversation.id] || new Date(note.date).getTime() > new Date(mentionSeen[conversation.id]).getTime())
  const counts = useMemo(() => ({ all: conversations.length, unassigned: conversations.filter((item) => !item.assignedTo).length, open: conversations.filter((item) => item.status === 'open').length, pending: conversations.filter((item) => item.status === 'pending').length, closed: conversations.filter((item) => item.status === 'closed').length, mentions: conversations.filter((item) => hasUnseenMention(item)).length, unread: conversations.filter((item) => item.unread > 0).length }), [conversations, mentionSeen, myAgentId])
  // Which chats match the search, and how: by name, by number, or by a message (kept to show a snippet).
  // Typing stays responsive with many chats: the search runs on a deferred copy of the query, and each
  // message's searchable text is normalised once and remembered.
  const deferredQuery = useDeferredValue(query)
  const searchMatches = useMemo(() => {
    const result = new Map<string, { by: 'name' | 'phone' | 'message'; message?: Message }>()
    const needle = normalizeSearch(deferredQuery)
    if (!needle) return result
    const digits = deferredQuery.replace(/\D/g, '').replace(/^00/, '')
    for (const item of conversations) {
      if (normalizeSearch(contactDisplayName(item.name, item.phone)).includes(needle) || normalizeSearch(item.name).includes(needle)) { result.set(item.id, { by: 'name' }); continue }
      if (digits.length >= 3 && item.phone.replace(/\D/g, '').includes(digits)) { result.set(item.id, { by: 'phone' }); continue }
      const message = [...item.messages].reverse().find((entry) => entry.attachmentName !== 'reaction' && searchableText(entry).includes(needle))
      if (message) result.set(item.id, { by: 'message', message })
    }
    return result
  }, [conversations, deferredQuery])
  const visible = useMemo(() => conversations.filter((item) => { const matchesFilter = filter === 'all' || (filter === 'mentions' ? mentionNotesForMe(item).length > 0 : filter === 'unread' ? item.unread > 0 : filter === 'unassigned' ? !item.assignedTo : item.status === filter); return matchesFilter && (!deferredQuery.trim() || searchMatches.has(item.id)) }), [conversations, filter, deferredQuery, myAgentId, searchMatches])
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
    // On phones the top chat is selected behind the list; only count it as read once it is actually opened.
    if (window.matchMedia('(max-width: 900px)').matches && !mobileChatOpen) return
    void markConversationRead(selectedId)
  }, [selectedId, conversations, mobileChatOpen])

  const markConversationUnread = async (conversationId: string) => {
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unread: Math.max(1, conversation.unread) } : conversation))
    try {
      const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: conversationId, patch: { unread_count: 1 } }) })
      if (!response.ok) throw new Error('Unable to mark conversation as unread')
    } catch (error) { console.error('[inbox] mark unread failed', error); void load().catch(() => {}) }
  }
  // Phone chat list: swipe a chat right to mark it read/unread, left to take it (when nobody has it), like WhatsApp.
  const conversationListRef = useRef<HTMLDivElement>(null)
  const swipeListRef = useRef({ conversations, myAgentId })
  const swipeClaimRef = useRef<(id: string) => void>(() => {})
  swipeListRef.current = { conversations, myAgentId }
  useEffect(() => {
    const list = conversationListRef.current
    if (!list) return
    let start: { x: number; y: number; row: HTMLElement; id: string } | null = null
    let dragging = false, offset = 0, suppressClick = false
    let hint: HTMLDivElement | null = null
    const actionFor = (id: string, dx: number) => {
      const { conversations: items, myAgentId: me } = swipeListRef.current
      const item = items.find((conversation) => conversation.id === id)
      if (!item) return null
      if (dx > 0) return item.unread > 0 ? { key: 'read', label: 'Read' } : { key: 'unread', label: 'Unread' }
      if (!item.assignedTo && me) return { key: 'take', label: 'Take it' }
      return null
    }
    const reset = (animate: boolean) => {
      if (!start) return
      const row = start.row
      row.style.transition = animate ? 'transform .2s ease-out' : 'none'
      row.style.transform = ''
      const old = hint; hint = null
      if (old) window.setTimeout(() => old.remove(), animate ? 200 : 0)
      window.setTimeout(() => { row.style.transition = ''; row.classList.remove('conversation-swiping') }, animate ? 220 : 0)
    }
    const onStart = (event: TouchEvent) => {
      if (!window.matchMedia('(max-width: 900px)').matches || event.touches.length !== 1) { start = null; return }
      const row = (event.target as HTMLElement).closest<HTMLElement>('.conversation[data-conversation-id]')
      if (!row) { start = null; return }
      const touch = event.touches[0]
      start = { x: touch.clientX, y: touch.clientY, row, id: row.dataset.conversationId || '' }
      dragging = false; offset = 0
    }
    const onMove = (event: TouchEvent) => {
      if (!start) return
      const touch = event.touches[0]
      const dx = touch.clientX - start.x, dy = touch.clientY - start.y
      if (!dragging) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
        if (Math.abs(dx) < Math.abs(dy) * 1.6 || !actionFor(start.id, dx)) { start = null; return }
        dragging = true
        start.row.classList.add('conversation-swiping')
        hint = document.createElement('div')
        hint.className = 'conversation-swipe-hint'
        list.appendChild(hint)
      }
      event.preventDefault()
      const action = actionFor(start.id, dx)
      offset = action ? Math.max(-110, Math.min(110, dx)) : 0
      start.row.style.transition = 'none'
      start.row.style.transform = `translateX(${offset}px)`
      if (hint) {
        hint.style.top = `${start.row.offsetTop}px`
        hint.style.height = `${start.row.offsetHeight}px`
        hint.dataset.side = offset > 0 ? 'left' : 'right'
        hint.dataset.action = action?.key || ''
        hint.dataset.ready = Math.abs(offset) > 70 ? '1' : ''
        hint.textContent = action?.label || ''
      }
    }
    const onEnd = () => {
      if (!start) return
      if (!dragging) { start = null; return }
      suppressClick = true
      window.setTimeout(() => { suppressClick = false }, 350)
      const action = Math.abs(offset) > 70 ? actionFor(start.id, offset) : null
      const id = start.id
      reset(true)
      start = null; dragging = false
      if (!action) return
      navigator.vibrate?.(10)
      if (action.key === 'read') void markConversationRead(id)
      else if (action.key === 'unread') void markConversationUnread(id)
      else if (action.key === 'take') swipeClaimRef.current(id)
    }
    const onClick = (event: MouseEvent) => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false } }
    list.addEventListener('touchstart', onStart, { passive: true })
    list.addEventListener('touchmove', onMove, { passive: false })
    list.addEventListener('touchend', onEnd)
    list.addEventListener('touchcancel', onEnd)
    list.addEventListener('click', onClick, true)
    return () => {
      list.removeEventListener('touchstart', onStart)
      list.removeEventListener('touchmove', onMove)
      list.removeEventListener('touchend', onEnd)
      list.removeEventListener('touchcancel', onEnd)
      list.removeEventListener('click', onClick, true)
      hint?.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxReady])

  const updateConversation = async (patch: Record<string, string | null>) => { if (!selected) return; const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, patch }) }); if (!response.ok) throw new Error('Conversation update failed'); await load() }
  // Phone press-and-hold menu on a message: reactions, Reply, Forward, Copy and Delete, like WhatsApp.
  const [messageActions, setMessageActions] = useState<Message | null>(null)
  // Where the pressed message sits, so the reactions and menu open right next to it.
  const [messageActionsAnchor, setMessageActionsAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null)
  const openMessageActions = (message: Message, element: Element | null) => {
    if (selectMode) return
    const rect = element?.getBoundingClientRect()
    setMessageActionsAnchor(rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null)
    setMessageActions(message)
  }
  const [forwardItems, setForwardItems] = useState<Message[] | null>(null)
  // Select mode (like WhatsApp): tick several messages, then forward or copy them together.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const exitSelectMode = () => { setSelectMode(false); setSelectedMessageIds([]) }
  useEffect(() => { setSelectMode(false); setSelectedMessageIds([]) }, [selectedId])
  const toggleSelectedMessage = (message: Message) => setSelectedMessageIds((current) => current.includes(String(message.id)) ? current.filter((id) => id !== String(message.id)) : [...current, String(message.id)])
  // Media can be forwarded when it is stored with WhatsApp (shown through /api/media) or at a public link.
  const canForwardMessage = (message: Message) => !/^(pending|failed)-/.test(String(message.id)) && (!!message.text.trim() || /^(\/api\/media\?mediaId=|https:\/\/)/.test(message.attachmentUrl || ''))
  // Forward sheet: pick up to 5 chats (like WhatsApp), search them, then forward in one go.
  const [forwardTargets, setForwardTargets] = useState<string[]>([])
  const [forwardQuery, setForwardQuery] = useState('')
  const [forwardBusy, setForwardBusy] = useState(false)
  const [forwardNotice, setForwardNotice] = useState('')
  useEffect(() => { if (forwardItems) { setForwardTargets([]); setForwardQuery('') } }, [forwardItems])
  useEffect(() => { if (!forwardNotice) return; const timer = window.setTimeout(() => setForwardNotice(''), 3500); return () => window.clearTimeout(timer) }, [forwardNotice])
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  const longPressFiredRef = useRef(false)
  // The hold menu only reacts to a tap that starts after it opened, so lifting the holding finger never picks an option.
  const menuArmedRef = useRef(false)
  const armed = (action: () => void) => () => { if (menuArmedRef.current) action() }
  const messageLongPress = (message: Message) => ({
    onTouchStart: (event: React.TouchEvent) => {
      if (!window.matchMedia('(max-width: 900px)').matches) return
      const touch = event.touches[0]
      const bubble = event.currentTarget
      longPressFiredRef.current = false
      const timer = window.setTimeout(() => { longPressRef.current = null; longPressFiredRef.current = true; menuArmedRef.current = false; messageInput.current?.blur(); closeTransientMenus(); openMessageActions(message, bubble); navigator.vibrate?.(10) }, 450)
      longPressRef.current = { timer, x: touch.clientX, y: touch.clientY }
    },
    onTouchMove: (event: React.TouchEvent) => {
      const press = longPressRef.current
      if (press && Math.hypot(event.touches[0].clientX - press.x, event.touches[0].clientY - press.y) > 8) { window.clearTimeout(press.timer); longPressRef.current = null }
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (longPressRef.current) { window.clearTimeout(longPressRef.current.timer); longPressRef.current = null }
      // Lifting the finger after the hold would "tap" the menu's backdrop and close it straight away.
      if (longPressFiredRef.current) { longPressFiredRef.current = false; event.preventDefault() }
    },
    onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); if (!window.matchMedia('(max-width: 900px)').matches) { closeTransientMenus(); openMessageActions(message, event.currentTarget) } },
  })
  const [reactionPickerFor, setReactionPickerFor] = useState<Message | null>(null)
  // Reactions just above the message and the menu just below it (flipped or clamped to stay on screen).
  const messageActionsLayout = (() => {
    if (!messageActions || !messageActionsAnchor || typeof window === 'undefined') return null
    const anchor = messageActionsAnchor
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight, gap = 8
    const barHeight = messageActions.externalId ? 58 : 0, barWidth = 380
    const menuHeight = (2 + (messageActions.text && !messageActions.attachmentUrl ? 1 : 0) + (messageActions.text ? 1 : 0)) * 50, menuWidth = 240
    let barTop = anchor.top - barHeight - gap
    let menuTop = anchor.bottom + gap
    if (menuTop + menuHeight > viewportHeight - gap) menuTop = (barHeight ? barTop : anchor.top) - menuHeight - gap
    if (barTop < gap) barTop = Math.min(viewportHeight - barHeight - gap, anchor.bottom + gap)
    if (barHeight && menuTop < barTop + barHeight + gap && menuTop + menuHeight > barTop) menuTop = barTop + barHeight + gap
    menuTop = Math.max(gap, Math.min(viewportHeight - menuHeight - gap, menuTop))
    const side = (width: number) => messageActions.from === 'agent'
      ? { left: Math.max(gap, Math.min(anchor.right, viewportWidth - gap) - width) }
      : { left: Math.max(gap, Math.min(anchor.left, viewportWidth - width - gap)) }
    return { bar: { top: barTop, ...side(barWidth) }, menu: { top: menuTop, ...side(menuWidth) } }
  })()
  // The full reaction list is a small box beside the message (about three messages tall), not a full sheet.
  const reactionPickerLayout = (() => {
    if (!reactionPickerFor || !messageActionsAnchor || typeof window === 'undefined') return null
    const anchor = messageActionsAnchor, gap = 8
    const width = Math.min(340, window.innerWidth - gap * 2), height = Math.min(280, window.innerHeight - gap * 2)
    let top = anchor.top - height - gap
    if (top < gap) top = Math.min(window.innerHeight - height - gap, anchor.bottom + gap)
    const left = reactionPickerFor.from === 'agent' ? Math.max(gap, Math.min(anchor.right, window.innerWidth - gap) - width) : Math.max(gap, Math.min(anchor.left, window.innerWidth - width - gap))
    return { top: Math.max(gap, top), left, width, height }
  })()
  const [fileDragOver, setFileDragOver] = useState(false)
  const reactToMessage = async (message: Message, emoji: string) => {
    setMessageActions(null)
    setReactionPickerFor(null)
    if (!selected) return
    // Show the reaction straight away; the next load replaces it with the stored row.
    const conversationId = selected.id
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: [...conversation.messages, { id: `reaction-${Date.now()}`, date: new Date().toISOString(), from: 'agent', text: emoji, time: '', attachmentName: 'reaction', replyToExternalId: message.externalId }] } : conversation))
    setMessageSendError('')
    try {
      const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, to: selected.phone, reaction: { emoji, messageId: message.id } }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Reaction could not be sent.')
      await load()
    } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Reaction could not be sent.') }
  }
  const windowOpenFor = (conversation: Conversation) => conversation.messages.some((message) => message.from === 'customer' && Date.now() - new Date(message.date).getTime() < 24 * 60 * 60 * 1000)
  const forwardMessage = async () => {
    const items = (forwardItems ?? []).filter(canForwardMessage).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const targets = conversations.filter((conversation) => forwardTargets.includes(conversation.id))
    if (!items.length || !targets.length) return
    setForwardBusy(true)
    const failed: string[] = []
    for (const target of targets) {
      let ok = true
      // Send in the original order; text goes as text, attachments are copied (with their caption).
      for (const item of items) {
        const payload = item.attachmentUrl ? { forwardAttachmentUrl: item.attachmentUrl, attachmentName: item.attachmentName, text: item.text } : { text: item.text }
        try {
          const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: target.id, to: target.phone, ...payload }) })
          if (!response.ok) ok = false
        } catch { ok = false }
      }
      if (!ok) failed.push(contactDisplayName(target.name, target.phone))
    }
    setForwardBusy(false)
    setForwardItems(null)
    exitSelectMode()
    const sent = targets.length - failed.length
    setForwardNotice(failed.length ? `${sent ? `Forwarded to ${sent} chat${sent === 1 ? '' : 's'}. ` : ''}Couldn't forward to ${failed.join(', ')}.` : `Forwarded to ${sent} chat${sent === 1 ? '' : 's'}`)
    void load()
  }
  // Agent typing indicator: while an agent types a reply, every other agent sees "<name> is typing…" on that
  // conversation, so two people don't answer the same customer at once. Broadcast only (nothing is stored),
  // sent at most every 2.5s while typing; an entry disappears 6s after its last signal or when they stop.
  const [agentsTyping, setAgentsTyping] = useState<Record<string, { agentId: string; name: string; at: number }>>({})
  const typingChannelRef = useRef<ReturnType<NonNullable<ReturnType<typeof createBrowserSupabaseClient>>['channel']> | null>(null)
  const typingSentRef = useRef<{ conversationId: string | null; at: number }>({ conversationId: null, at: 0 })
  // Who is typing: the team member record when this account has one, otherwise the signed-in email,
  // so admins and accounts without a matching agent row take part too.
  const typingIdentity = sessionUser?.agentId || sessionUser?.email?.toLowerCase() || ''
  useEffect(() => {
    if (!typingIdentity) return
    const supabase = createBrowserSupabaseClient()
    if (!supabase) return
    const myId = typingIdentity
    const channel = supabase.channel('inbox-agent-typing', { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: 'typing' }, ({ payload }: { payload?: unknown }) => {
      const { conversationId, agentId, name, typing } = (payload ?? {}) as { conversationId?: string; agentId?: string; name?: string; typing?: boolean }
      if (!conversationId || !agentId || agentId === myId) return
      setAgentsTyping((current) => {
        const next = { ...current }
        if (typing) next[conversationId] = { agentId, name: name || 'Another agent', at: Date.now() }
        else if (next[conversationId]?.agentId === agentId) delete next[conversationId]
        return next
      })
    }).subscribe()
    typingChannelRef.current = channel
    return () => { typingChannelRef.current = null; void supabase.removeChannel(channel) }
  }, [typingIdentity])
  useEffect(() => {
    if (!Object.keys(agentsTyping).length) return
    const timer = window.setInterval(() => setAgentsTyping((current) => {
      const fresh = Object.fromEntries(Object.entries(current).filter(([, entry]) => Date.now() - entry.at < 6000))
      return Object.keys(fresh).length === Object.keys(current).length ? current : fresh
    }), 1000)
    return () => window.clearInterval(timer)
  }, [agentsTyping])
  useEffect(() => {
    const channel = typingChannelRef.current
    if (!channel || !typingIdentity) return
    const me = agents.find((agent) => agent.id === sessionUser?.agentId || (sessionUser?.email && agent.email?.toLowerCase() === sessionUser.email.toLowerCase()))
    const name = me?.display_name || sessionUser?.email?.split('@')[0] || 'An agent'
    const send = (conversationId: string, typing: boolean) => void channel.send({ type: 'broadcast', event: 'typing', payload: { conversationId, agentId: typingIdentity, name, typing } })
    const sent = typingSentRef.current
    const typingNow = Boolean(selectedId && draft.trim())
    if (sent.conversationId && (!typingNow || sent.conversationId !== selectedId)) { send(sent.conversationId, false); typingSentRef.current = { conversationId: null, at: 0 } }
    if (typingNow && selectedId && (typingSentRef.current.conversationId !== selectedId || Date.now() - typingSentRef.current.at > 2500)) {
      send(selectedId, true)
      typingSentRef.current = { conversationId: selectedId, at: Date.now() }
    }
  }, [draft, selectedId, typingIdentity, sessionUser?.agentId, sessionUser?.email, agents])
  // Show "typing…" in the customer's WhatsApp while an agent writes a reply. Meta keeps it up to 25 seconds,
  // so it is renewed every 20 seconds while there is text in the box; failures are ignored.
  // Set when the mic starts recording on touch, so the click that follows doesn't start it a second time.
  const micPressStartedRef = useRef(false)
  const customerTypingSentRef = useRef<{ conversationId: string | null; at: number }>({ conversationId: null, at: 0 })
  useEffect(() => {
    // Writing an internal note must never show "typing…" to the customer.
    if (!selectedId || !draft.trim() || composerMode === 'note') return
    const sent = customerTypingSentRef.current
    if (sent.conversationId === selectedId && Date.now() - sent.at < 20000) return
    customerTypingSentRef.current = { conversationId: selectedId, at: Date.now() }
    void fetch('/api/typing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selectedId }) }).catch(() => {})
  }, [draft, selectedId, composerMode])

  // --- Mentions in internal notes ---
  const mentionMatch = composerMode !== undefined ? draft.match(/(?:^|\s)@([^\s@]{0,30})$/) : null
  const mentionCandidates = mentionMatch ? agents.filter((agent) => agent.is_active !== false && agent.id !== myAgentId && agent.display_name && agent.display_name.toLowerCase().split(/\s+/).some((word) => word.startsWith(mentionMatch[1].toLowerCase()))).slice(0, 6) : []
  const mentionPickerOpen = Boolean(selected && mentionMatch && mentionCandidates.length)
  useEffect(() => { setMentionPickerIndex(0) }, [mentionMatch?.[1], mentionPickerOpen])
  const pickMention = (agent: Agent) => {
    setDraft((current) => current.replace(/@([^\s@]{0,30})$/, `@${agent.display_name} `))
    setMentionMap((current) => ({ ...current, [agent.display_name]: agent.id }))
    // A mention only belongs in a note, so the customer never receives it.
    setComposerMode('note')
    requestAnimationFrame(() => {
      const editor = messageInput.current
      if (!editor) return
      editor.focus()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }
  const [noteSaving, setNoteSaving] = useState(false)
  // Appearance: Light, Dark or Automatic (follows the device). Saved per device; layout.tsx applies it before first paint.
  const [themePref, setThemePref] = useState<'light' | 'dark' | 'system'>(() => { try { const saved = localStorage.getItem('inbox-theme'); return saved === 'light' || saved === 'dark' ? saved : 'system' } catch { return 'system' } })
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { const dark = themePref === 'dark' || (themePref === 'system' && media.matches); const applyTheme = (window as unknown as { __applyTheme?: (dark: boolean) => void }).__applyTheme; if (applyTheme) applyTheme(dark); else document.documentElement.dataset.theme = dark ? 'dark' : 'light' }
    apply()
    try { localStorage.setItem('inbox-theme', themePref) } catch {}
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [themePref])
  // One tap on the crescent switches to dark; in dark mode it shows a sun to switch back.
  const [themeIsDark, setThemeIsDark] = useState(false)
  useEffect(() => { const sync = () => setThemeIsDark(document.documentElement.dataset.theme === 'dark'); sync(); const observer = new MutationObserver(sync); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect() }, [])
  const themeSwitch = <button type="button" className="theme-toggle" aria-label={themeIsDark ? 'Switch to light mode' : 'Switch to dark mode'} title={themeIsDark ? 'Light mode' : 'Dark mode'} onClick={(event) => { event.stopPropagation(); setThemePref(themeIsDark ? 'light' : 'dark') }}>{themeIsDark
    ? <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>
    : <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>}</button>
  const sendNote = async () => {
    if (!selected || !draft.trim() || noteSaving) return
    let body = draft.trim()
    for (const [name, id] of Object.entries(mentionMap).sort((a, b) => b[0].length - a[0].length)) body = body.split(`@${name}`).join(`@[${name}](${id})`)
    setNoteSaving(true)
    setMessageSendError('')
    try {
      const response = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, body }) })
      if (!response.ok) throw new Error('Note could not be saved')
      setDraft('')
      setMentionMap({})
      await load()
    } catch { setMessageSendError('The internal note could not be saved. Please try again.') } finally { setNoteSaving(false) }
  }
  // Opening a chat marks its mentions as seen (on phones only once the chat is actually on screen).
  useEffect(() => {
    if (!selected || !myAgentId) return
    if (window.matchMedia('(max-width: 900px)').matches && !mobileChatOpen) return
    const latest = mentionNotesForMe(selected).at(-1)
    if (!latest || (mentionSeen[selected.id] && new Date(mentionSeen[selected.id]).getTime() >= new Date(latest.date).getTime())) return
    setMentionSeen((current) => { const next = { ...current, [selected.id]: latest.date }; try { localStorage.setItem('inbox-mention-seen', JSON.stringify(next)) } catch {} return next })
  }, [selected?.id, selected?.notes.length, mobileChatOpen, myAgentId])
  // A small in-app alert when someone mentions you while the inbox is open (push covers the rest).
  useEffect(() => {
    if (!myAgentId || !conversations.length) return
    const all = conversations.flatMap((conversation) => mentionNotesForMe(conversation).map((note) => ({ conversation, note })))
    if (!alertedMentionsRef.current) { alertedMentionsRef.current = new Set(all.map((item) => item.note.id)); return }
    // Only a mention that is new (written in the last 10 minutes) and not yet seen in that chat; older notes that
    // simply arrive later (opening the app, loading a chat's full history) never pop up again.
    const seenAt = (id: string) => (mentionSeen[id] ? new Date(mentionSeen[id]).getTime() : 0)
    const fresh = all.filter((item) => !alertedMentionsRef.current!.has(item.note.id) && Date.now() - new Date(item.note.date).getTime() < 10 * 60 * 1000 && new Date(item.note.date).getTime() > seenAt(item.conversation.id))
    all.forEach((item) => alertedMentionsRef.current!.add(item.note.id))
    if (!fresh.length) return
    fresh.forEach((item) => alertedMentionsRef.current!.add(item.note.id))
    const newest = fresh.sort((a, b) => new Date(b.note.date).getTime() - new Date(a.note.date).getTime())[0]
    if (newest.conversation.id === selectedId && document.visibilityState === 'visible' && (!window.matchMedia('(max-width: 900px)').matches || mobileChatOpen)) return
    setMentionToast({ conversationId: newest.conversation.id, author: newest.note.agentName, contact: contactDisplayName(newest.conversation.name, newest.conversation.phone) })
  }, [conversations, myAgentId])
  useEffect(() => { if (!mentionToast) return; const timer = window.setTimeout(() => setMentionToast(null), 8000); return () => window.clearTimeout(timer) }, [mentionToast])
  // Notification links open the right chat: /?conversation=<id>
  const openedFromLinkRef = useRef(false)
  useEffect(() => {
    if (openedFromLinkRef.current || !conversations.length) return
    const id = new URLSearchParams(window.location.search).get('conversation')
    openedFromLinkRef.current = true
    if (!id || !conversations.some((conversation) => conversation.id === id)) return
    setSelectedId(id)
    setMobileChatOpen(true)
    window.history.replaceState(null, '', window.location.pathname)
  }, [conversations])
  // Sidebar highlight follows the open window and returns to Inbox when it closes (Tags is opened by TagNavBridge).
  useEffect(() => {
    if (activeNav === 'team' && !teamOpen) setActiveNav('inbox')
    if (activeNav === 'replies' && !savedRepliesOpen) setActiveNav('inbox')
  }, [activeNav, teamOpen, savedRepliesOpen])
  useEffect(() => {
    const onTags = (event: Event) => setActiveNav((event as CustomEvent<boolean>).detail ? 'tags' : 'inbox')
    window.addEventListener('inbox-tags-open', onTags)
    return () => window.removeEventListener('inbox-tags-open', onTags)
  }, [])
  // Desktop keyboard shortcuts: Esc closes windows and menus, Ctrl/Cmd+K searches, Up/Down moves between chats.
  const shortcutState = useRef({ visible: [] as Conversation[], selectedId: null as string | null })
  shortcutState.current = { visible, selectedId }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMessageActions(null); setReactionPickerFor(null); setForwardItems(null); setMediaPreview(null)
        setNewConversationOpen(false); setTeamOpen(false); setSavedRepliesOpen(false); setAccountSettingsOpen(false); setWorkspaceSettingsOpen(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.inbox-pane input[aria-label="Search conversations"]')?.focus()
        return
      }
      const target = event.target as HTMLElement | null
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.altKey && !event.metaKey && !event.ctrlKey && !(target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) && !document.querySelector('.modal-backdrop, .message-actions-overlay')) {
        const { visible, selectedId: current } = shortcutState.current
        if (!visible.length) return
        event.preventDefault()
        const index = visible.findIndex((conversation) => conversation.id === current)
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
        if (next) setSelectedId(next.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
  const startContactEdit = () => { if (!selected) return; setContactNameDraft(selected.name.replace(/\D/g, '') === selected.phone.replace(/\D/g, '') ? '' : selected.name); setContactTypeDraft((selected.type === 'Vendor' ? 'supplier' : selected.type === 'Team' ? 'team' : 'customer') as 'customer' | 'supplier' | 'team'); setEditingContact(true) }
  const saveContact = async () => { if (!selected || !contactNameDraft.trim()) return; setContactSaveBusy(true); setMessageSendError(''); try { const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, contactPatch: { display_name: contactNameDraft.trim(), contact_type: contactTypeDraft } }) }); if (!response.ok) throw new Error('Contact update failed'); setEditingContact(false); await load() } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Could not save contact name.') } finally { setContactSaveBusy(false) } }
  const loadSavedReplies = async () => { const response = await fetch('/api/saved-replies', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Saved replies unavailable'); setSavedReplies(payload.replies ?? []) }
  const openSavedReplies = async () => { setActiveNav('replies'); setSavedRepliesOpen(true); setQuickRepliesOpen(false); setSavedReplyError(''); try { await loadSavedReplies() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Saved replies unavailable') } }
  const sendChatTemplate = async () => { if (!selected || !chatTemplateSelection || sendingMessage) return; setSendingMessage(true); setMessageSendError(''); try { const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, to: selected.phone, text: '', template: chatTemplateSelection }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Template could not be sent.'); setChatTemplateOpen(false); setChatTemplateSelection(null); await load() } catch (error) { setMessageSendError(error instanceof Error ? error.message : 'Template could not be sent.') } finally { setSendingMessage(false) } }
  const openQuickReplies = async () => { const next = !quickRepliesOpen; setChatTemplateOpen(false); setChatTemplateSelection(null); setEmojiOpen(false); setOpenMessageMenu(null); setQuickRepliesOpen(next); setSavedReplySearch(''); if (next) { messageInput.current?.blur(); setSavedReplyError(''); try { await loadSavedReplies() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Saved replies unavailable') } } }
  const saveSavedReply = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setSavedReplyBusy(true); setSavedReplyError(''); try { const response = await fetch('/api/saved-replies', { method: editingReplyId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(editingReplyId ? { id: editingReplyId } : {}), title: savedReplyTitle, body: savedReplyBody }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Reply could not be saved.'); await loadSavedReplies(); setSavedReplyTitle(''); setSavedReplyBody(''); setEditingReplyId(null); setReplyFormOpen(false) } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Reply could not be saved.') } finally { setSavedReplyBusy(false) } }
  const beginEditSavedReply = (reply: SavedReply) => { setEditingReplyId(reply.id); setSavedReplyTitle(reply.title); setSavedReplyBody(reply.body); setReplyFormOpen(true); window.setTimeout(() => document.querySelector('.saved-reply-form')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0) }
  const cancelEditSavedReply = () => { setEditingReplyId(null); setSavedReplyTitle(''); setSavedReplyBody(''); setReplyFormOpen(false) }
  const deleteSavedReply = async (id: string) => { setSavedReplyBusy(true); try { const response = await fetch('/api/saved-replies', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!response.ok) throw new Error('Reply could not be deleted.'); setSavedReplies((current) => current.filter((reply) => reply.id !== id)); if (editingReplyId === id) cancelEditSavedReply() } catch (error) { setSavedReplyError(error instanceof Error ? error.message : 'Reply could not be deleted.') } finally { setSavedReplyBusy(false) } }
  const useSavedReply = (reply: SavedReply) => { setDraft(reply.body); setQuickRepliesOpen(false); setSavedReplySearch(''); window.setTimeout(() => messageInput.current?.focus(), 0) }

  // Unsent text stays with its chat (and survives closing the app), like WhatsApp drafts.
  const draftsRef = useRef<Record<string, string> | null>(null)
  const draftOwnerRef = useRef<string | null>(null)
  const draftValueRef = useRef(draft)
  draftValueRef.current = draft
  const composerModeRef = useRef(composerMode)
  composerModeRef.current = composerMode
  const readDrafts = () => { if (!draftsRef.current) { try { draftsRef.current = JSON.parse(localStorage.getItem('inbox-drafts') || '{}') || {} } catch { draftsRef.current = {} } } return draftsRef.current! }
  const storeDraft = (id: string, value: string) => {
    const drafts = readDrafts(); const clean = value.trim() ? value : ''
    if ((drafts[id] || '') === clean) return
    if (clean) drafts[id] = clean; else delete drafts[id]
    try { localStorage.setItem('inbox-drafts', JSON.stringify(drafts)) } catch {}
  }
  useEffect(() => {
    const previous = draftOwnerRef.current
    if (previous === selectedId) return
    if (previous && composerModeRef.current !== 'note') storeDraft(previous, draftValueRef.current)
    draftOwnerRef.current = selectedId
    if (previous !== null || selectedId) setDraft(selectedId ? readDrafts()[selectedId] || '' : '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  useEffect(() => {
    const id = draftOwnerRef.current
    if (!id || id !== selectedId || composerMode === 'note') return
    const timer = window.setTimeout(() => storeDraft(id, draft), 400)
    return () => window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selectedId, composerMode])

  // Typing "/" in the composer lists saved replies right above it; "/ticket" or "/تذكرة" narrows the list.
  const slashQuery = composerMode !== 'note' && /^\/[^\n]{0,40}$/.test(draft) ? draft.slice(1) : null
  const slashActive = slashQuery !== null
  useEffect(() => { if (slashActive && !savedReplies.length) void loadSavedReplies().catch(() => {}) }, [slashActive])
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return []
    const query = normalizeReplyText(slashQuery)
    const last = [...selectedVisibleMessages].reverse().find((message) => message.from === 'customer' && message.text?.trim())
    const preferred = last ? detectLanguage(last.text) : 'ar'
    return savedReplies
      .filter((reply) => !query || normalizeReplyText(`${reply.title} ${reply.body}`).includes(query))
      .map((reply) => { const parsed = parseReplyTitle(reply.title); return { reply, parsed, rank: parsed.lang && parsed.lang !== preferred ? 1 : 0 } })
      .sort((a, b) => a.rank - b.rank || a.reply.title.localeCompare(b.reply.title, undefined, { numeric: true }))
      .slice(0, 8)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery, savedReplies, selectedId, selected?.messages.length])

  // "Take it": one tap assigns an unassigned chat to you; the server refuses if someone else got there first.
  const [claimBusy, setClaimBusy] = useState(false)
  const claimConversation = async (conversationId: string) => {
    if (!myAgentId || claimBusy) return
    const me = agents.find((agent) => agent.id === myAgentId)
    setClaimBusy(true); setMessageSendError('')
    setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, assignedTo: myAgentId, agentName: me?.display_name || item.agentName } : item))
    try {
      const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: conversationId, claim: true, agentId: myAgentId }) })
      if (response.status === 409) setMessageSendError('Someone already took this chat.')
      else if (!response.ok) throw new Error('claim failed')
    } catch { setMessageSendError('Could not take this chat. Please try again.') }
    finally { setClaimBusy(false); void load().catch(() => {}) }
  }

  swipeClaimRef.current = (id: string) => { void claimConversation(id) }

  // Scrolled up in a chat: a ↓ button returns to the latest message and counts messages that arrived meanwhile.
  const [threadScrolledUp, setThreadScrolledUp] = useState(false)
  const [newBelowCount, setNewBelowCount] = useState(0)
  const onThreadScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const thread = event.currentTarget
    // Ignore the jump to the newest message right after a chat opens, so the button doesn't flash.
    const up = Date.now() - chatOpenedAtRef.current > 900 && thread.scrollHeight - thread.scrollTop - thread.clientHeight > 220
    if (up !== threadScrolledUp) setThreadScrolledUp(up)
    if (thread.scrollTop < 120 && threadStart > 0 && !earlierAnchorRef.current && Date.now() - chatOpenedAtRef.current > 900) showEarlierMessages()
    if (!up && newBelowCount) setNewBelowCount(0)
  }
  const chatOpenedAtRef = useRef(0)
  useEffect(() => { chatOpenedAtRef.current = Date.now(); setThreadScrolledUp(false); setNewBelowCount(0) }, [selectedId, mobileChatOpen])
  // Long chats and long lists draw only what is near the screen: the latest messages of a chat (older ones
  // load as you scroll up), and the chat list in pages as you scroll down. Keeps big inboxes smooth.
  const [threadLimit, setThreadLimit] = useState(THREAD_PAGE)
  const [listLimit, setListLimit] = useState(LIST_PAGE)
  useEffect(() => { setThreadLimit(THREAD_PAGE) }, [selectedId])
  useEffect(() => { setListLimit(LIST_PAGE) }, [filter, deferredQuery])
  const threadStart = Math.max(0, selectedVisibleMessages.length - threadLimit)
  const earlierAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const showEarlierMessages = () => {
    const thread = threadRef.current
    if (thread) earlierAnchorRef.current = { height: thread.scrollHeight, top: thread.scrollTop }
    setThreadLimit((limit) => limit + THREAD_PAGE)
  }
  useLayoutEffect(() => {
    const thread = threadRef.current, anchor = earlierAnchorRef.current
    if (!thread || !anchor) return
    earlierAnchorRef.current = null
    thread.scrollTop = anchor.top + (thread.scrollHeight - anchor.height)
  }, [threadLimit])
  const jumpToLatest = () => { const thread = threadRef.current; if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }); setNewBelowCount(0) }

  const emojiCategories = [
    { id: 'recent', icon: '◷', label: 'Frequently used', emojis: ['👍','🙏','😀','😍','😘','💜','😆','😅','😜','➕','😊','💯','↗️','💌','🕺','🌍','👋','😂','👌','🥰','🙁','😋'] },
    { id: 'smileys', icon: '☺', label: 'Smileys & People', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😋','😛','😜','🤪','🤗','🤭','🫡','🤔','🫶','👏','🙌','🤝','😌','😏','😒','😞','😔','😟','😕','🙁','☹','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤤','😴','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','🥳','🥸','����','🤓','🧐','😮','😯','😲','��','😦','💨','😬','🙄','😑','😐','🤨','🤫','🤥','😶','🌫','😈','👿','💀','☠','👻','👽','🤖','💩','👋','🤚','🖐','✋','🖖','🫱','🫲','🫳','🫴','🫰','🤞','✌','🤟','🤘','🤙','👈','👉','👆','👇','☝','✊','👊','🤛','🤜','🤲','👐','🤷','🙋','💁','🙆','🙅','🤦','🧑','👩','👨','👶','👧','👦','👵','👴'] },
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
    // On phones focusing the field would raise the keyboard over the emoji sheet, so insert without focus.
    const phone = window.matchMedia('(max-width: 900px)').matches
    if (!phone) input.focus()
    const selection = window.getSelection()
    let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null
    if (phone && (!range || !input.contains(range.commonAncestorContainer))) { range = document.createRange(); range.selectNodeContents(input); range.collapse(false) }
    if (range && input.contains(range.commonAncestorContainer)) {
      range.deleteContents()
      const img = document.createElement('img')
      img.src = emojiArtworkUrl(emoji)
      img.alt = emoji
      img.dataset.emoji = emoji
      img.className = 'composer-emoji'
      img.draggable = false
      attachEmojiFallback(img, emoji)
      range.insertNode(img)
      range.setStartAfter(img)
      range.collapse(true)
      if (!phone) { selection?.removeAllRanges(); selection?.addRange(range) }
      setDraft(Array.from(input.childNodes).map(function collect(node: ChildNode): string { if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''; if (!(node instanceof HTMLElement)) return ''; if (node.tagName === 'IMG') return node.dataset.emoji || node.getAttribute('alt') || ''; if (node.tagName === 'BR') return '\\n'; return Array.from(node.childNodes).map(collect).join('') }).join(''))
    } else setDraft(current => current + emoji)
  }

  // Re-encode phone images as standard 8-bit RGB JPEG before Meta processes them.
  // iOS screenshots/photos can otherwise retain unsupported PNG/HEIC color profiles.
  const normalizeImageForWhatsApp = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/') && !/\\.(heic|heif)$/i.test(file.name)) return file
    if (file.type === 'image/gif') return file
    let imageUrl: string | null = null
    try {
      imageUrl = URL.createObjectURL(file)
      const image = new Image()
      image.src = imageUrl
      await image.decode()
      const maxSide = 2048
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) throw new Error('Image conversion is not supported on this device.')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not convert image.')), 'image/jpeg', 0.88))
      if (blob.type !== 'image/jpeg') throw new Error('Could not convert image to JPEG.')
      return new File([blob], file.name.replace(/\\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    } catch (error) {
      throw new Error('Could not prepare this image for WhatsApp. Try saving it as a JPEG first. ' + (error instanceof Error ? error.message : ''))
    } finally {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }
  const uploadAttachment = async (file: File) => { const prepared = await normalizeImageForWhatsApp(file); const form = new FormData(); form.append('file', prepared); const response = await fetch('/api/media', { method: 'POST', body: form }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Media upload failed'); return payload }
  // Text messages appear in the chat straight away and the box clears, so you can keep typing; the bubble
  // shows "sending" until WhatsApp accepts it (or "Failed" with the reason).
  const sendTextMessage = async () => {
    if (!selected || !draft.trim() || attachment) return
    const conversationId = selected.id
    const recipient = selected.phone
    const text = draft.trim()
    const replyingTo = replyTo
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const now = new Date()
    const patch = (update: (message: Message) => Message) => setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: conversation.messages.map((message) => message.id === pendingId ? update(message) : message) } : conversation))
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, preview: text, messages: [...conversation.messages, { id: pendingId, date: now.toISOString(), from: 'agent', text, time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: 'sending', replyToExternalId: replyingTo?.externalId, senderName: agents.find((agent) => agent.id === sessionUser?.agentId)?.display_name }] } : conversation))
    setDraft('')
    setReplyTo(null)
    setQuickRepliesOpen(false)
    setMessageSendError('')
    try {
      const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, to: recipient, text, replyToMessageId: replyingTo?.id }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || payload.message || 'Message could not be sent. Please try again.')
      // Accepted: show it as sent; the next reload replaces this placeholder with the stored message.
      patch((message) => ({ ...message, id: `sent-${String(message.id).slice(8)}`, status: 'sent' }))
      void load().catch(() => {})
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Message could not be sent. Please try again.'
      patch((message) => ({ ...message, id: `failed-${String(message.id).slice(8)}`, status: 'failed', failureReason: reason }))
      setMessageSendError(reason)
      console.error('[send] failed', error)
    }
  }
  const sendMessage = async () => {
    if (selected && draft.trim() && !attachment) return sendTextMessage()
    if (sendInProgress.current || !selected || (!draft.trim() && !attachment)) return
    sendInProgress.current = true
    setSendingMessage(true)
    setMessageSendError('')
    const conversationId = selected.id
    const recipient = selected.phone
    const originalDraft = draft
    const text = originalDraft.trim()
    const file = attachment
    const replyingTo = replyTo
    try {
      let media: any = null
      if (file) media = await uploadAttachment(file)
      const response = await fetch('/api/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, to: recipient, text, mediaId: media?.mediaId, attachmentUrl: media?.mediaId ? undefined : media?.url, attachmentName: media?.name, attachmentType: media?.type, replyToMessageId: replyingTo?.id })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || payload.message || 'Message could not be sent. Please try again.')
      setDraft((current) => current === originalDraft ? '' : current)
      setAttachment((current) => current === file ? null : current)
      setQuickRepliesOpen(false)
      setReplyTo(null)
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
    } else if (hasNewMessages && previous) {
      const added = selected.messages.slice(previous.count).filter((message) => message.from === 'customer' && !isReactionRow(message)).length
      if (added) setNewBelowCount((count) => count + added)
    }
    previousThread.current = { id: selected.id, count: selected.messages.length }
  }, [selectedId, selected?.messages.length])
  // Give an open chat its own history entry on phones, so Safari's edge swipe and Android's back button return to the list.
  useEffect(() => {
    if (!mobileChatOpen || !window.matchMedia('(max-width: 900px)').matches || window.history.state?.inboxChat) return
    window.history.pushState({ ...window.history.state, inboxChat: true }, '')
  }, [mobileChatOpen])
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => { if (!event.state?.inboxChat) { setMobileChatOpen(false); setMobileDetailsOpen(false) } }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const closeMobileChat = () => {
    setMobileDetailsOpen(false)
    if (window.history.state?.inboxChat) window.history.back()
    else setMobileChatOpen(false)
  }
  // Back button on phones: slide the chat out to the right over the list (like WhatsApp and like swiping back),
  // instead of the chat vanishing and the list jumping in from the left.
  const closeMobileChatAnimated = () => {
    const pane = chatPaneRef.current
    const shell = pane?.parentElement
    const inbox = shell?.querySelector<HTMLElement>(':scope > .inbox-pane')
    if (!pane || !shell || !window.matchMedia('(max-width: 900px)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { closeMobileChat(); return }
    shell.classList.add('chat-swiping')
    document.documentElement.classList.add('swiped-back')
    if (inbox) { inbox.style.transition = 'none'; inbox.style.transform = `translateX(${Math.round(-0.3 * pane.clientWidth)}px)` }
    pane.style.transition = 'none'
    pane.style.transform = ''
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const transition = 'transform .26s cubic-bezier(.2,.8,.2,1)'
      pane.style.transition = transition
      pane.style.transform = `translateX(${pane.clientWidth}px)`
      if (inbox) { inbox.style.transition = transition; inbox.style.transform = '' }
    }))
    window.setTimeout(() => { closeMobileChat(); window.setTimeout(() => document.documentElement.classList.remove('swiped-back'), 1200) }, 270)
  }
  // Swipe a message to the right to reply to it (phones and iPad), like WhatsApp.
  const swipeMessagesRef = useRef<Message[]>([])
  swipeMessagesRef.current = selectedVisibleMessages
  useEffect(() => {
    const pane = chatPaneRef.current
    if (!pane) return
    const trigger = 58
    let start: { x: number; y: number } | null = null
    let bubble: HTMLElement | null = null
    let icon: HTMLElement | null = null
    let dragging = false
    let offset = 0
    let passed = false
    let direction = 1
    const reset = (animate: boolean) => {
      if (bubble) { bubble.style.transition = animate ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none'; bubble.style.transform = '' }
      if (icon) { const old = icon; old.style.transition = 'opacity .18s, transform .18s'; old.style.opacity = '0'; old.style.transform = 'translateY(-50%) scale(.6)'; window.setTimeout(() => old.remove(), 220) }
      bubble = null; icon = null; start = null; dragging = false; offset = 0; passed = false
    }
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement
      const element = target.closest<HTMLElement>('.thread .message-bubble')
      if (!element || event.touches.length !== 1 || target.closest('button, a, audio, [role="slider"], [data-inbox-popover]')) { start = null; return }
      if (element.dataset.messageId?.startsWith('pending-')) return
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      bubble = element
      dragging = false
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!start || !bubble) return
      const dx = event.touches[0].clientX - start.x
      const dy = event.touches[0].clientY - start.y
      if (!dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (Math.abs(dx) < Math.abs(dy) * 1.5) { start = null; bubble = null; return }
        // Either direction works: right like WhatsApp, or left, which feels natural on our own right-hand messages.
        direction = dx > 0 ? 1 : -1
        dragging = true
        icon = document.createElement('span')
        icon.className = 'swipe-reply-icon'
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
        icon.style.left = direction > 0 ? `${bubble.offsetLeft + 6}px` : `${bubble.offsetLeft + bubble.offsetWidth - 38}px`
        bubble.parentElement?.insertBefore(icon, bubble)
      }
      event.preventDefault()
      // Follows the finger, then resists past the reply point.
      const distance = Math.max(0, dx * direction)
      offset = distance < trigger ? distance : trigger + (distance - trigger) * 0.25
      offset = Math.min(offset, 96)
      bubble.style.transition = 'none'
      bubble.style.transform = `translateX(${offset * direction}px)`
      if (icon) {
        const progress = Math.min(1, offset / trigger)
        icon.style.opacity = String(progress)
        icon.style.transform = `translateY(-50%) scale(${0.5 + progress * 0.5})`
        icon.classList.toggle('ready', offset >= trigger)
      }
      if (!passed && offset >= trigger) { passed = true; navigator.vibrate?.(8) }
      if (passed && offset < trigger) passed = false
    }
    const onTouchEnd = () => {
      if (!dragging || !bubble) { reset(false); return }
      const id = bubble.dataset.messageId
      const shouldReply = offset >= trigger
      reset(true)
      if (!shouldReply || !id) return
      const message = swipeMessagesRef.current.find((item) => String(item.id) === id)
      if (!message) return
      setReplyTo(message)
      messageInput.current?.focus()
    }
    pane.addEventListener('touchstart', onTouchStart, { passive: true })
    pane.addEventListener('touchmove', onTouchMove, { passive: false })
    pane.addEventListener('touchend', onTouchEnd)
    pane.addEventListener('touchcancel', onTouchEnd)
    return () => {
      pane.removeEventListener('touchstart', onTouchStart)
      pane.removeEventListener('touchmove', onTouchMove)
      pane.removeEventListener('touchend', onTouchEnd)
      pane.removeEventListener('touchcancel', onTouchEnd)
    }
  // The chat pane mounts only after sign-in and loading, so re-attach when the open chat changes.
  }, [selected?.id])

  // Swipe right on an open chat to go back to the conversation list, like WhatsApp.
  const chatPaneRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const pane = chatPaneRef.current
    if (!pane) return
    let start: { x: number; y: number; time: number } | null = null
    let dragging = false
    let offset = 0
    const shellElement = pane.parentElement
    const inbox = shellElement?.querySelector<HTMLElement>(':scope > .inbox-pane')
    // Show the conversation list underneath while dragging, sliding in slightly like WhatsApp.
    const setOffset = (value: number, animate: boolean) => {
      offset = value
      const transition = animate ? 'transform .2s ease-out' : 'none'
      pane.style.transition = transition
      pane.style.transform = value ? `translateX(${value}px)` : ''
      shellElement?.classList.toggle('chat-swiping', value > 0)
      if (inbox) {
        inbox.style.transition = transition
        inbox.style.transform = value ? `translateX(${Math.round((value / pane.clientWidth - 1) * pane.clientWidth * 0.3)}px)` : ''
      }
    }
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement
      if (!mobileChatOpen || event.touches.length !== 1 || target.closest('.composer-wrap, [role="menu"], input, textarea, [contenteditable="true"]')) { start = null; return }
      const touch = event.touches[0]
      // A swipe that starts on a message replies to it; leaving the chat needs a swipe from the screen edge or empty space.
      if (target.closest('.thread .message-bubble') && touch.clientX > 28) { start = null; return }
      start = { x: touch.clientX, y: touch.clientY, time: Date.now() }
      dragging = false
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return
      const touch = event.touches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (!dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.5) { start = null; return }
        dragging = true
      }
      event.preventDefault()
      setOffset(Math.max(0, dx), false)
    }
    const onTouchEnd = () => {
      if (!start || !dragging) { start = null; return }
      const speed = offset / Math.max(1, Date.now() - start.time)
      start = null
      dragging = false
      if (offset > pane.clientWidth * 0.3 || (offset > 40 && speed > 0.5)) {
        setOffset(pane.clientWidth, true)
        // The list is already in place after the swipe, so it skips the app's slide-back animation.
        // On <html>: React rewrites the shell's class list when it re-renders.
        document.documentElement.classList.add('swiped-back')
        window.setTimeout(() => document.documentElement.classList.remove('swiped-back'), 1200)
        // Keep the chat off screen until the list replaces it; the effect cleanup resets the offset.
        window.setTimeout(() => { closeMobileChat(); window.setTimeout(() => setMobileChatOpen(false), 400) }, 200)
      } else setOffset(0, true)
    }
    pane.addEventListener('touchstart', onTouchStart, { passive: true })
    pane.addEventListener('touchmove', onTouchMove, { passive: false })
    pane.addEventListener('touchend', onTouchEnd)
    pane.addEventListener('touchcancel', onTouchEnd)
    return () => {
      pane.removeEventListener('touchstart', onTouchStart)
      pane.removeEventListener('touchmove', onTouchMove)
      pane.removeEventListener('touchend', onTouchEnd)
      pane.removeEventListener('touchcancel', onTouchEnd)
      setOffset(0, false)
    }
  }, [mobileChatOpen])
  // On phones the thread is hidden until a chat opens, so jump to the latest message once it is visible.
  useEffect(() => {
    const thread = threadRef.current
    if (!mobileChatOpen || !thread) return
    requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight })
  }, [mobileChatOpen, selectedId])
  useEffect(() => { setMessageSendError('') }, [selectedId])

  const createConversation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (newConversationTemplateActive && !newConversationTemplate) { setNewConversationError('Fill in all template variables before sending.'); return }; if (!newConversationTemplate) { setNewConversationError('Select an approved template to start the conversation.'); return }; setNewConversationBusy(true); setNewConversationError('')
    try { const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newConversationName, phone: newConversationCountry + newConversationPhone.replace(/\D/g, '').replace(/^0+/, ''), message: newConversationMessage, template: newConversationTemplate || undefined }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Conversation could not be created.'); await load(); setSelectedId(payload.conversationId); setDetailsOpen(true); setNewConversationOpen(false); setNewConversationName(''); setNewConversationPhone(''); setNewConversationMessage(''); setNewConversationTemplate(null); setNewConversationTemplateActive(false) } catch (error) { setNewConversationError(error instanceof Error ? error.message : 'Conversation could not be created.') } finally { setNewConversationBusy(false) }
  }

  const loadTeam = async () => { const response = await fetch('/api/team', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Team unavailable'); setTeamAgents(payload.agents ?? []) }
  // Fixed English day-month-year so phones set to Arabic don't show Hijri dates or mixed numerals.
  const formatInviteDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  // Admins see everyone's invitation status in Account settings, so load the team when it opens.
  useEffect(() => { if (accountSettingsOpen && sessionUser?.role === 'admin') loadTeam().catch((error) => setTeamError(error instanceof Error ? error.message : 'Team unavailable')) }, [accountSettingsOpen, sessionUser?.role]) // eslint-disable-line react-hooks/exhaustive-deps
  const invitationNotice = teamNotice && <div className="temporary-password" role="status" style={{display:"grid",gap:9,overflowWrap:"anywhere"}}><span>{teamNotice}</span>{agentInvitationLink && <><input aria-label="Generated agent invitation link" type="text" value={agentInvitationLink} readOnly onFocus={e=>e.currentTarget.select()} style={{width:"100%",padding:9,border:"1px solid #d6dfe9",borderRadius:7,fontSize:12}}/><button type="button" className="send-btn" onClick={async()=>{try{await navigator.clipboard.writeText(agentInvitationLink);setTeamNotice('Invitation link copied. Send it privately to the agent.')}catch{setTeamNotice('Select and copy the invitation link manually.')}}}>Copy invitation link</button></>}<button type="button" onClick={() => {setTeamNotice('');setAgentInvitationLink('')}} aria-label="Dismiss notice">Dismiss</button></div>
  const openTeam = async () => { setActiveNav('team'); setTeamOpen(true); setTeamError(''); try { await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Team unavailable') } }
  // Phone tab bar pages: only one of the list, Team, Replies, Tags or You is shown at a time.
  const closeMobilePages = () => { setTeamOpen(false); setSavedRepliesOpen(false); setMobileTagsOpen(false); setMobileProfileOpen(false); setAccountSettingsOpen(false); setWorkspaceSettingsOpen(false); setActiveNav('inbox') }
  const addAgent = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setTeamBusy(true); setTeamError(''); try { const response = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: newAgentName, email: newAgentEmail, role: newAgentRole, departments: newAgentDepartments }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Agent could not be added.'); setAgentInvitationLink(payload.invitationLink || '');setTeamNotice('Invitation link generated. Copy and send it privately to the agent. It will not be emailed.'); setNewAgentName(''); setNewAgentEmail(''); await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Agent could not be added.') } finally { setTeamBusy(false) } }
  const updateAgent = async (id: string, patch: Record<string, string | boolean>) => { setTeamBusy(true); try { const response = await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Agent could not be updated.'); await loadTeam() } catch (error) { setTeamError(error instanceof Error ? error.message : 'Agent could not be updated.') } finally { setTeamBusy(false) } }
  const deleteAgent = async (agent: Agent) => {
    setTeamBusy(true);setTeamError('');setTeamNotice('')
    try {
      const response=await fetch('/api/team',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:agent.id})})
      const payload=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(payload.error||'Agent could not be deleted.')
      setTeamNotice(agent.display_name+' was deleted. Their inbox access has been revoked.')
      await loadTeam()
      setAgentDeleteTarget(null)
    }catch(error){setTeamError(error instanceof Error?error.message:'Agent could not be deleted.')}
    finally{setTeamBusy(false)}
  }
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
  // iOS app: notifications come from Apple (APNs), not the browser. This checks each step and says which one fails.
  const [nativeApp, setNativeApp] = useState(false)
  useEffect(() => { setNativeApp(Boolean((window as any).Capacitor?.isNativePlatform?.())) }, [])
  const testNativeNotification = async () => {
    const native = (window as any).__myticketNativePush
    setPushTestBusy(true); setPushFeedback('Checking…')
    try {
      if (!native) { setPushFeedback('Notification support is still loading. Try again in a few seconds.'); return }
      let state = await native.status()
      if (state.permission !== 'granted') {
        await native.register(); state = await native.status()
        if (state.permission !== 'granted') { setPushFeedback('Notifications are off for this app. Turn them on in iPhone Settings → Notifications → Myticket Inbox, then try again.'); return }
      }
      if (!state.token) {
        await native.register()
        for (let i = 0; i < 10 && !state.token; i++) { await new Promise((resolve) => setTimeout(resolve, 500)); state = await native.status() }
        if (!state.token) { setPushFeedback('Step 2 failed: the iPhone did not give the app a notification address' + (state.registrationError ? ' (' + state.registrationError + ')' : '') + '.'); return }
      }
      const saveError = await native.save(state.token)
      if (saveError) { setPushFeedback('Step 3 failed: could not save this iPhone for your account (' + saveError + ').'); return }
      const response = await fetch('/api/notifications/apns/test', { method: 'POST' })
      const result = await response.json().catch(() => ({}))
      if (result.ok) { setPushFeedback('Sent. A test notification should appear in a few seconds (lock the phone or leave the app to see it as a banner).'); return }
      const reasons = Array.isArray(result.results) ? result.results.map((item: any) => item.device + ': ' + item.reason).join('; ') : ''
      setPushFeedback('Step 4 failed: ' + (result.message || 'Apple did not accept the notification') + (reasons ? ' — ' + reasons : ''))
    } catch (error) {
      setPushFeedback('Test failed: ' + (error instanceof Error ? error.message : 'unknown error'))
    } finally { setPushTestBusy(false) }
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
  const signOut = async () => { const supabase = createBrowserSupabaseClient(); if (sessionUser?.agentId) await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionUser.agentId, availability: 'offline' }) }); clearDeviceInboxData(); await supabase?.auth.signOut(); setSessionUser(null); setProfileMenuOpen(false); setAccountSettingsOpen(false); setWorkspaceSettingsOpen(false); setPushFeedback(''); setPushEnabled(false) }

  const signIn = async () => { setAuthBusy(true); setAuthError(''); const supabase = createBrowserSupabaseClient(); if (!supabase) { setAuthError('Supabase authentication is not configured in this preview.'); setAuthBusy(false); return } const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword }); if (error || !data.user) setAuthError(error?.message || 'Invalid email or password.'); else { const agent = agents.find((item) => item.email?.toLowerCase() === data.user.email?.toLowerCase()); setSessionUser({ email: data.user.email, agentId: agent?.id, role: data.user.app_metadata?.role || (agent ? 'agent' : 'admin') }) } setAuthBusy(false) }

  // Internal notes sit in the chat between the messages they were written after; customers never see them.
  const renderThreadNotes = (after: string | null, upTo: string | null) => {
    if (!selected) return null
    const from = after ? new Date(after).getTime() : -Infinity
    const to = upTo ? new Date(upTo).getTime() : Infinity
    const notes = selected.notes.filter((note) => { const time = new Date(note.date).getTime(); return time > from && time <= to })
    return notes.map((note) => <div key={`note-${note.id}`} className={`thread-note ${myAgentId && note.mentions.includes(myAgentId) && note.agentId !== myAgentId ? 'thread-note-mentions-me' : ''}`}><div className="thread-note-head"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>Internal note</span><span>·</span><strong>{note.agentId === myAgentId ? 'You' : note.agentName}</strong><span>·</span><span>{note.time}</span></div><div className="thread-note-body"><NoteBody body={note.body} myAgentId={myAgentId} /></div></div>)
  }
  if (isLoading) return <>{/* layout.tsx marks html[data-session] before first paint: signed-in agents see the inbox skeleton, others the logo loader. */}<InboxSkeleton /><main className="auth-loading-shell" aria-label="Loading inbox" role="status"><div className="auth-loading-stack"><img className="auth-loading-mark" src="/brand/myticket-mark.png" alt="Myticket" /><span className="auth-loading-bar" aria-hidden="true"><i /></span></div></main></>
  if (sessionUser && !inboxReady) return <InboxSkeleton shown />
  if (!sessionUser) return <main className="login-shell"><div className="login-bg-orb login-bg-orb-orange" aria-hidden="true" /><div className="login-bg-orb login-bg-orb-green" aria-hidden="true" /><section className="login-card"><div className="login-head"><img className="login-head-mark" src="/brand/myticket-mark.png" alt="Myticket" /><h1 className="login-head-title">Sign in to Inbox</h1><p className="login-head-subtitle">Myticket WhatsApp inbox</p></div><form className="login-form" onSubmit={(event) => { event.preventDefault(); void signIn() }}><label htmlFor="login-email">EMAIL</label><div className="login-input-wrap"><span className="login-field-icon" aria-hidden="true">✉</span><input id="login-email" aria-label="Email" type="email" placeholder="you@example.com" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required /></div><label htmlFor="login-password">PASSWORD</label><div className="login-input-wrap"><span className="login-field-icon login-lock" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg></span><input id="login-password" aria-label="Password" type="password" placeholder="Enter your password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required /></div><button className="send-btn login-submit" type="submit" disabled={authBusy}>{authBusy ? 'Signing in…' : <>Sign in <span aria-hidden="true">→</span></>}</button></form>{authError && <p className="login-error" role="alert">{authError}</p>}<div className="login-security"><span className="login-check">✓</span><span>Secure shared messaging workspace<br/>for your support team.</span></div></section><p className="login-help">Trouble logging in? <strong>Contact Organization Administrator</strong></p><p className="login-privacy-link"><a href="/privacy">Privacy Policy</a></p><footer className="login-page-footer"><span>© 2026 Myticket. All rights reserved.</span><span>WhatsApp Shared Inbox · Secure team access</span></footer></main>
  return <main className={`app-shell ${mobileChatOpen ? "mobile-chat-open" : "mobile-inbox-open"} ${mobileDetailsOpen ? "mobile-details-open" : ""} ${desktopSidebarCollapsed ? "desktop-rail-collapsed" : ""}`}>
    {showPushPrompt && <div className="push-permission-overlay"><section className="push-permission-card" role="dialog" aria-modal="true" aria-labelledby="push-permission-title"><div className="push-permission-icon"><Bell size={22}/></div><h2 id="push-permission-title">Stay updated with new messages</h2><p>Allow Myticket Shared Inbox to notify you when customers send new WhatsApp messages, even when you are away from the inbox.</p><div className="push-permission-actions"><button type="button" className="push-permission-later" onClick={() => { sessionStorage.setItem('myticket-push-prompt-dismissed','1');setShowPushPrompt(false) }}>Not now</button><button type="button" className="push-permission-allow" onClick={() => { setShowPushPrompt(false);void configureBrowserPush() }}>Enable notifications</button></div><small>On iPhone or iPad, add the inbox to your Home Screen first to enable push notifications.</small></section></div>}

    {sidebarOpen && <button type="button" className="mobile-nav-dismiss" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={`rail ${sidebarOpen ? 'rail-open' : ''}`}><div className="brand-mark"><img src="/brand/myticket-mark.png" alt="Myticket Inbox" /></div><nav aria-label="Primary navigation" className="rail-nav" onClick={() => setSidebarOpen(false)}><button className={`rail-item ${activeNav === 'inbox' ? 'active' : ''}`} aria-label="Inbox" onClick={() => setActiveNav('inbox')}><Inbox size={20} /><span>Inbox</span>{(() => { const unreadChats = conversations.filter((conversation) => conversation.unread > 0).length; return unreadChats > 0 ? <b aria-label={`${unreadChats} unread chats`}>{unreadChats > 99 ? '99+' : unreadChats}</b> : null })()}</button><button className={`rail-item ${activeNav === 'team' ? 'active' : ''}`} aria-label="Team" onClick={() => void openTeam()}><Users size={20} /><span>Team</span></button><button className={`rail-item ${activeNav === 'replies' ? 'active' : ''}`} aria-label="Saved replies" onClick={() => void openSavedReplies()}><FileText size={20} /><span>Replies</span></button><button className={`rail-item ${activeNav === 'tags' ? 'active' : ''}`} aria-label="Tags" onClick={() => setActiveNav('tags')}><Tag size={20} /><span>Tags</span></button></nav><div className="rail-bottom">{sessionUser?.role === 'admin' && <button className="rail-item" aria-label="Workspace settings" title="Workspace settings" onClick={() => { setSidebarOpen(false); setProfileMenuOpen(false); setWorkspaceSettingsOpen(true) }}><Settings size={20} /></button>}<div className="profile-menu-wrap" data-inbox-popover><button className="mini-avatar" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-label="Open agent menu">{sessionUser?.email?.slice(0, 2).toUpperCase() || agents[0]?.display_name?.slice(0, 2).toUpperCase() || 'AG'}</button>{profileMenuOpen && <div className="profile-menu profile-menu-v2" role="menu" aria-label="Your profile"><div className="profile-menu-head"><strong>{agents.find((agent) => agent.id === sessionUser?.agentId)?.display_name || sessionUser?.email?.split('@')[0] || 'Agent'}</strong><span>{sessionUser?.email}</span></div><div className="profile-menu-sep" /><button type="button" role="menuitemcheckbox" aria-checked={selfAvailability === 'available'} className="profile-menu-row profile-status-row" onClick={() => void updateSelfAvailability(selfAvailability === 'available' ? 'away' : 'available')}><span className={`profile-status-dot ${selfAvailability}`} aria-hidden="true" /><span className="profile-menu-label">{selfAvailability === 'available' ? 'Available' : 'Away'}</span><span className={`profile-switch ${selfAvailability === 'available' ? 'on' : ''}`} aria-hidden="true"><i /></span></button><div className="profile-menu-row profile-theme-row">{themeSwitch}</div><button type="button" role="menuitem" className="profile-menu-row" onClick={() => { setSidebarOpen(false); setProfileMenuOpen(false); setAccountSettingsOpen(true); setAccountPasswordFeedback('') }}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span className="profile-menu-label">My account &amp; password</span></button><div className="profile-menu-sep" /><button type="button" role="menuitem" className="profile-menu-row logout-button" onClick={() => void signOut()}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg><span className="profile-menu-label">Log out</span></button></div>}</div></div><button type="button" className="desktop-rail-toggle" aria-label={desktopSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={desktopSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setDesktopSidebarCollapsed(v => !v)}><span aria-hidden="true">{desktopSidebarCollapsed ? "›" : "‹"}</span></button></aside>
    <section className={`inbox-pane ${mobileProfileOpen || mobileTagsOpen || teamOpen || savedRepliesOpen ? 'profile-open' : ''}`}><header className="pane-header"><div className="pane-brand-heading"><h1>WHATSAPP SHARED INBOX</h1></div><span className="new-conversation-menu-wrap"><button className="new-conversation-header-btn" type="button" aria-label="New conversation" title="New conversation" aria-haspopup="menu" aria-expanded={newMenuOpen} onClick={() => setNewMenuOpen((open) => !open)}><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg></button>{newMenuOpen && <div className="new-conversation-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); setNewConversationOpen(true); setNewConversationError('') }}><span className="ic"><MessageCircle size={18} /></span><span><b>Start a conversation</b><small>Message one person</small></span></button><button type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); setGroupMessageOpen(true) }}><span className="ic"><Users size={18} /></span><span><b>Group message</b><small>Send a template to a list from Excel</small></span></button></div>}</span><button className="icon-btn" aria-label="Notifications" title="Notifications"><Bell size={20} /></button><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button></header><div className="inbox-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search conversations" placeholder="Search names, numbers or messages" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div></div><div className="filter-tabs" role="tablist"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All<span>{counts.all}</span></button><button className={filter === 'unread' ? 'selected' : ''} onClick={() => setFilter('unread')}>Unread{counts.unread > 0 && <span>{counts.unread}</span>}</button><button className={filter === 'unassigned' ? 'selected' : ''} onClick={() => setFilter('unassigned')}>Unassigned{counts.unassigned > 0 && <span>{counts.unassigned}</span>}</button><button className={`filter-tab-mentions ${filter === 'mentions' ? 'selected' : ''}`} onClick={() => setFilter('mentions')} aria-label="Mentions" title="Chats where you were mentioned">@{counts.mentions > 0 && <span>{counts.mentions}</span>}</button></div><div className="conversation-list" ref={conversationListRef} onScroll={(event) => { const list = event.currentTarget; if (listLimit < visible.length && list.scrollHeight - list.scrollTop - list.clientHeight < 900) setListLimit((limit) => limit + LIST_PAGE) }}>{visible.length === 0 ? <p className="empty-list">{query.trim() ? `No chats match “${query.trim()}”.` : 'No conversations yet.'}</p> : visible.slice(0, listLimit).map((conversation) => <button className={`conversation ${conversation.id === selectedId ? 'conversation-selected' : ''}${conversation.unread > 0 ? ' conversation-has-unread' : ''}`} data-conversation-id={conversation.id} key={conversation.id} onClick={() => { setSelectedId(conversation.id); setMobileChatOpen(true); if (window.matchMedia('(min-width: 1400px)').matches) setDetailsOpen(true) }}><span className="conversation-avatar-wrap"><ContactAvatar phone={conversation.phone} name={conversation.name} />{conversation.agentName && <i className="conversation-agent-badge" title={`Assigned to ${conversation.agentName}`} aria-label={`Assigned to ${conversation.agentName}`}>{agentInitials(conversation.agentName)}</i>}</span><div className="conversation-copy"><div className="conversation-top"><strong>{query.trim() ? <SearchHighlight text={contactDisplayName(conversation.name, conversation.phone)} query={query} /> : contactDisplayName(conversation.name, conversation.phone)}</strong><time title={conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : undefined}>{formatConversationListDate(conversation.lastMessageAt)}</time>{hasUnseenMention(conversation) && <span className="conversation-mention-badge" title="You were mentioned in this chat" aria-label="You were mentioned">@</span>}</div>{searchMatches.get(conversation.id)?.by === 'message' ? <p className="conversation-preview conversation-search-snippet"><span className="conversation-preview-text"><SearchHighlight text={searchSnippet(searchMatches.get(conversation.id)?.message?.text || searchMatches.get(conversation.id)?.message?.attachmentName || '', query)} query={query} /></span></p> : agentsTyping[conversation.id] ? <p className="conversation-preview conversation-agent-typing">{agentsTyping[conversation.id].name} is typing…</p> : <p className="conversation-preview">{conversation.messages.at(-1)?.from === 'agent' && <span className="conversation-preview-ticks" title={conversation.messages.at(-1)?.status || 'sent'} aria-label={conversation.messages.at(-1)?.status || 'sent'}>{conversation.messages.at(-1)?.status === 'read' || conversation.messages.at(-1)?.status === 'delivered' ? <svg width="15" height="11" viewBox="0 0 20 14" fill="none" aria-hidden="true" style={{ color: conversation.messages.at(-1)?.status === 'read' ? '#53b7ef' : '#8896a8', flexShrink: 0 }}><path d="M1.5 7.5 5.4 11.3 12.3 3.2M7.5 7.5 11.4 11.3 18.3 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : conversation.messages.at(-1)?.status === 'failed' ? <span style={{ color: '#c93b35', fontSize: 11 }}>!</span> : <Check size={11} color="#8896a8" aria-hidden="true" />}</span>}<span className="conversation-preview-text"><EmojiMessageSegment text={conversation.preview} /></span>{conversation.unread > 0 && <b className="conversation-count" aria-label={`${conversation.unread} unread`}>{conversation.unread > 99 ? '99+' : conversation.unread}</b>}</p>}<div className="conversation-bottom"><span className={`type-badge ${conversation.type.toLowerCase()}`} style={conversation.type === "Vendor" ? { backgroundColor: "#fff0e8", color: "#e6531a", borderColor: "#ffd0b8" } : undefined}>{conversation.type}</span></div></div></button>)}</div>{mobileProfileOpen && <div className="mobile-profile"><div className="mobile-profile-hero"><button type="button" className={`mobile-profile-status ${selfAvailability}`} onClick={() => void updateSelfAvailability(selfAvailability === 'available' ? 'away' : 'available')} title="Tap to change your status">{selfAvailability === 'available' ? 'Available' : 'Away'}</button><div className="mobile-profile-avatar">{sessionUser?.email?.slice(0, 2).toUpperCase() || 'AG'}<i className={`mobile-tab-presence ${selfAvailability}`} /></div><strong>{sessionUser?.email || 'Agent'}</strong><span>{sessionUser?.role === 'admin' ? 'Administrator' : 'Agent'}</span></div><div className="mobile-profile-group"><button type="button" onClick={() => void updateSelfAvailability(selfAvailability === 'available' ? 'away' : 'available')}><span className={`mobile-profile-dot ${selfAvailability}`} /><span>Status</span><em>{selfAvailability === 'available' ? 'Available' : 'Away'}</em><ChevronRight size={18} /></button></div><div className="mobile-profile-group mobile-theme-group"><div className="mobile-theme-row"><span>Appearance</span>{themeSwitch}</div></div><div className="mobile-profile-group"><button type="button" onClick={() => { setAccountSettingsOpen(true); setAccountPasswordFeedback('') }}><KeyRound size={21} /><span>My account &amp; password</span><ChevronRight size={18} /></button>{sessionUser?.role === 'admin' && <button type="button" onClick={() => setWorkspaceSettingsOpen(true)}><Settings size={21} /><span>Workspace settings</span><ChevronRight size={18} /></button>}</div><div className="mobile-profile-group"><button type="button" className="mobile-profile-logout" onClick={() => void signOut()}><LogOut size={21} /><span>Log out</span></button></div></div>}{mobileTagsOpen && <div className="mobile-profile mobile-tags-page"><TagManager /></div>}<nav className="mobile-tabbar" aria-label="Mobile navigation"><button type="button" className={`mobile-tab ${mobileProfileOpen || mobileTagsOpen || teamOpen || savedRepliesOpen ? '' : 'active'}`} aria-label="Chats" onClick={closeMobilePages}><span className="mobile-tab-icon"><MessageCircle size={23} />{conversations.some(item => item.unread > 0) && <b>{conversations.reduce((total, item) => total + (item.unread > 0 ? 1 : 0), 0)}</b>}</span><span>Chats</span></button><button type="button" className={`mobile-tab ${teamOpen ? 'active' : ''}`} aria-label="Team" onClick={() => { closeMobilePages(); void openTeam() }}><span className="mobile-tab-icon"><Users size={23} /></span><span>Team</span></button><button type="button" className={`mobile-tab ${savedRepliesOpen ? 'active' : ''}`} aria-label="Saved replies" onClick={() => { closeMobilePages(); void openSavedReplies() }}><span className="mobile-tab-icon"><FileText size={23} /></span><span>Replies</span></button><button type="button" className={`mobile-tab ${mobileTagsOpen ? 'active' : ''}`} aria-label="Manage tags" onClick={() => { closeMobilePages(); setActiveNav('tags'); setMobileTagsOpen(true) }}><span className="mobile-tab-icon"><Tag size={23} /></span><span>Tags</span></button><button type="button" className={`mobile-tab ${mobileProfileOpen ? 'active' : ''}`} aria-label="You" onClick={() => { closeMobilePages(); setMobileProfileOpen(true) }}><span className="mobile-tab-icon mobile-tab-avatar">{sessionUser?.email?.slice(0, 2).toUpperCase() || 'AG'}<i className={`mobile-tab-presence ${selfAvailability}`} /></span><span>You</span></button></nav></section>
    <section className={`chat-pane ${fileDragOver ? 'chat-drop-target' : ''}${selectMode ? ' select-mode' : ''}`} ref={chatPaneRef} onDragOver={(event) => { if (!selected || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setFileDragOver(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDragOver(false) }} onDrop={(event) => { if (!event.dataTransfer.files?.length) return; event.preventDefault(); setFileDragOver(false); setAttachment(event.dataTransfer.files[0]) }}>{selected ? <><header className="chat-header">{selectMode && <div className="message-select-bar" role="toolbar" aria-label="Selected messages"><button type="button" className="message-select-close" onClick={exitSelectMode} aria-label="Cancel selection"><X size={22} /></button><strong>{selectedMessageIds.length} selected</strong><button type="button" aria-label="Copy selected messages" title="Copy" disabled={!selectedVisibleMessages.some((message) => selectedMessageIds.includes(String(message.id)) && message.text.trim())} onClick={() => { const text = selectedVisibleMessages.filter((message) => selectedMessageIds.includes(String(message.id)) && message.text.trim()).map((message) => message.text).join('\n\n'); void navigator.clipboard?.writeText(text).catch(() => {}); setForwardNotice('Copied'); exitSelectMode() }}><Copy size={20} /></button><button type="button" className="message-select-forward" aria-label="Forward selected messages" title="Forward" disabled={!selectedVisibleMessages.some((message) => selectedMessageIds.includes(String(message.id)) && canForwardMessage(message))} onClick={() => setForwardItems(selectedVisibleMessages.filter((message) => selectedMessageIds.includes(String(message.id))))}><Forward size={21} /></button></div>}<button type="button" className="mobile-chat-back" aria-label="Back to conversations" onClick={closeMobileChatAnimated}>‹</button><div className="chat-person" role="button" tabIndex={0} aria-label="Open contact details" title="Contact details" onClick={() => { setDetailsOpen(true); setMobileDetailsOpen(true) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailsOpen(true); setMobileDetailsOpen(true) } }}><ContactAvatar phone={selected.phone} name={selected.name} className="large" /><div><h2>{contactDisplayName(selected.name, selected.phone)}</h2><p><span className="online-dot" /> WhatsApp</p></div></div><div className="chat-actions"><button className="status-select" onClick={() => void updateConversation({ status: selected.status === 'open' ? 'pending' : 'open' })}><span className={`status-dot ${selected.status}`} /> {selected.status}</button><button className="icon-btn" type="button" onClick={() => void deleteInboxContent(selected.id)} aria-label="Delete chat" title="Delete chat from inbox" style={{ color: "#c93b35" }}><Trash2 size={18} /></button></div></header><div className="thread" ref={threadRef} onScroll={onThreadScroll}>{threadStart > 0 && <button type="button" className="thread-earlier" onClick={showEarlierMessages}>Show earlier messages ({threadStart.toLocaleString()})</button>}{selectedVisibleMessages.slice(threadStart).map((message, position, _all, index = position + threadStart) => <Fragment key={message.id}>{(index === 0 || new Date(selectedVisibleMessages[index - 1].date).toDateString() !== new Date(message.date).toDateString()) && <div className="day-divider"><span>{formatChatDate(message.date)}</span></div>}{renderThreadNotes(index === 0 ? null : selectedVisibleMessages[index - 1].date, message.date)}<div className={`message-row ${message.from === 'agent' ? 'message-agent' : ''}${selectMode ? ' is-selectable' : ''}${selectMode && selectedMessageIds.includes(String(message.id)) ? ' is-selected' : ''}`} key={message.id} onClickCapture={selectMode ? (event) => { event.preventDefault(); event.stopPropagation(); toggleSelectedMessage(message) } : undefined}>{selectMode && <span className="message-select-check" aria-hidden="true">{selectedMessageIds.includes(String(message.id)) && <Check size={14} strokeWidth={3} />}</span>}<div {...messageLongPress(message)} data-message-id={String(message.id)} className={`message-bubble hover-message-bubble ${index === selectedVisibleMessages.length - 1 || selectedVisibleMessages[index + 1].from !== message.from || new Date(selectedVisibleMessages[index + 1].date).toDateString() !== new Date(message.date).toDateString() ? 'bubble-tail' : ''} ${message.attachmentUrl && /^(voice|audio) attachment$|\bvoice\b|\baudio\b|\.(ogg|opus|mp3|m4a|aac|wav|amr)$/i.test(message.attachmentName || '') ? "voice-message-bubble" : /^sticker attachment$/i.test(message.attachmentName || "") && !!message.attachmentUrl ? "sticker-message-bubble" : message.attachmentUrl && !/\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm|m4v)$|^(image|video|sticker) attachment$/i.test(message.attachmentName || '') ? "document-message-bubble" : "text-message-bubble"}`} style={{ position: "relative", overflow: "visible", boxSizing: "border-box" }}>{message.from === 'agent' && message.senderName && !(index > 0 && selectedVisibleMessages[index - 1].from === 'agent' && selectedVisibleMessages[index - 1].senderName === message.senderName) && <span className="message-sender-name" style={{ color: senderNameColor(message.senderName) }}>{message.senderName}</span>}<div data-inbox-popover className={`hover-message-options ${openMessageMenu === message.id ? "message-options-open" : ""}`} style={{ position: "absolute", right: 4, top: 4, zIndex: openMessageMenu === message.id ? 30 : 1 }}><button type="button" onClick={(event) => { setEmojiOpen(false); setQuickRepliesOpen(false); setOpenMessageMenu(null); openMessageActions(message, (event.currentTarget as HTMLElement).closest('.message-bubble')) }} aria-label="Message options" aria-expanded={openMessageMenu === message.id} title="Message options" style={{ display: "grid", placeItems: "center", width: 23, height: 25, padding: 0, border: "none", borderRadius: 7, background: "transparent", color: "#6b7787", cursor: "pointer" }}><ChevronDown size={15} /></button>{openMessageMenu === message.id && <div role="menu" aria-label="Message actions" style={{ position: "absolute", top: 28, right: 0, minWidth: 143, padding: 5, background: "#fff", border: "1px solid #dce4ee", borderRadius: 10, boxShadow: "0 8px 24px #102a4329", zIndex: 40 }}><button type="button" role="menuitem" onClick={() => { setReplyTo(message); setOpenMessageMenu(null) }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", border: 0, borderRadius: 6, background: "transparent", color: "#243149", fontSize: 12, cursor: "pointer" }}>↩ Reply</button><button type="button" role="menuitem" onClick={() => { setOpenMessageMenu(null); void deleteInboxContent(selected.id, message.id) }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", border: 0, borderRadius: 6, background: "transparent", color: "#c93b35", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", textAlign: "left" }}><Trash2 size={14} /> Delete message</button></div>}</div>{!message.attachmentUrl && /^sticker attachment$/i.test(message.attachmentName || '') && <div className="sticker-unavailable" title="Sticker media was not included in the webhook">Sticker unavailable</div>}{message.replyToExternalId && (() => { const original = selected.messages.find(item => item.externalId === message.replyToExternalId); return <div className="quoted-message" title="Replied-to message"><strong>{original?.from === "agent" ? "You" : selected.name}</strong><span>{original?.text?.startsWith('[Template] ') ? 'Template: ' + original.text.slice(11).replace(/_/g, ' ') : original?.text || original?.attachmentName || "Original message unavailable"}</span></div> })()}{message.attachmentUrl && /^(voice|audio) attachment$|\bvoice\b|\baudio\b|\.(ogg|opus|mp3|m4a|aac|wav|amr)$/i.test(message.attachmentName || '') && <VoiceNotePlayer src={message.attachmentUrl} />}{message.attachmentUrl && !/^(voice|audio) attachment$|\bvoice\b|\baudio\b|\.(ogg|opus|mp3|m4a|aac|wav|amr)$/i.test(message.attachmentName || '') && (/^sticker attachment$/i.test(message.attachmentName || "") ? <><button type="button" className="message-sticker-button" onClick={() => setMediaPreview({url:message.attachmentUrl!,kind:"image",name:"Sticker"})} title="View sticker" aria-label="Enlarge sticker"><img src={message.attachmentUrl} alt="WhatsApp sticker" className="message-sticker" loading="lazy" onError={(event) => { event.currentTarget.closest('.message-sticker-button')?.classList.add('is-broken') }} /></button><button type="button" onClick={()=>void saveSticker(message.id)} title="Save sticker" aria-label="Save sticker" style={{border:0,background:"transparent",color:"#e6531a",fontSize:11,cursor:"pointer",display:"block",padding:"4px 0"}}>☆ Save sticker</button></> : (/\.(png|jpe?g|webp|gif|bmp)$/i.test(message.attachmentName || '') || /^image attachment$/i.test(message.attachmentName || '')) ? <button type="button" className="message-image-link" onClick={() => setMediaPreview({url:message.attachmentUrl!,kind:"image",name:message.attachmentName || "Image"})} title="View image" style={{padding:0,border:0,background:"transparent",cursor:"zoom-in"}}><img className="message-image" src={message.attachmentUrl} alt={message.attachmentName || "Attached image"} loading="lazy" /></button> : (/\.(mp4|mov|webm|m4v)$/i.test(message.attachmentName || "") || /^video attachment$/i.test(message.attachmentName || "")) ? <button type="button" className="message-image-link" onClick={() => setMediaPreview({url:message.attachmentUrl!,kind:"video",name:message.attachmentName || "Video"})} style={{border:0,padding:0,background:"transparent",cursor:"pointer",display:"block"}}><video src={message.attachmentUrl} preload="metadata" muted playsInline style={{maxWidth:260,maxHeight:230,borderRadius:10,display:"block"}} /><span style={{display:"block",fontSize:12,padding:5}}>▶ Play video</span></button> : <DocumentCard url={message.attachmentUrl} name={message.attachmentName || 'Document'} />)}{message.text && !(message.attachmentUrl && message.text.trim() === (message.attachmentName || '').trim()) && <LinkedMessageText text={message.text} />}<small>{message.time} {message.from === 'agent' && <span className="message-delivery-status" title={message.status || 'sent'} aria-label={message.status || 'sent'}>{message.status === 'read' || message.status === 'delivered' ? <svg width="15" height="11" viewBox="0 0 20 14" fill="none" aria-hidden="true" style={{ color: message.status === 'read' ? '#53b7ef' : '#8896a8', verticalAlign: 'middle' }}><path d="M1.5 7.5 5.4 11.3 12.3 3.2M7.5 7.5 11.4 11.3 18.3 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : message.status === 'sending' ? <Clock size={11} color="#8896a8" aria-hidden="true" /> : message.status === 'failed' ? <button type="button" style={{ color: '#c93b35', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }} title={message.failureReason || 'WhatsApp delivery failed'} onClick={() => window.alert(message.failureReason || 'WhatsApp delivery failed. Check the Meta delivery status in server logs.')}>Failed</button> : <Check size={11} color="#8896a8" aria-hidden="true" />}</span>}</small>{message.externalId && selectedReactions.get(message.externalId) && <button type="button" className="message-reaction" title={myReaction(message) ? 'Tap to remove your reaction' : undefined} onClick={() => { if (myReaction(message)) void reactToMessage(message, '') }}>{Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(selectedReactions.get(message.externalId) ?? ''), (part) => <EmojiArtwork key={part.index} emoji={part.segment} />)}</button>}</div></div></Fragment>)}{renderThreadNotes(selectedVisibleMessages.at(-1)?.date ?? null, null)}</div><div className={`composer-wrap ${composerMode === 'note' ? 'composer-note-mode' : ''}`}>{(() => { const last = selectedVisibleMessages.at(-1); const waiting = last?.from === 'customer' && !!last.text?.trim(); return <SmartReplyBar conversationId={selected?.id} messageId={waiting ? last!.id : undefined} customerText={waiting ? last!.text : undefined} hidden={composerMode === 'note' || !!draft.trim()} onUse={setDraft} /> })()}{slashActive && <div className="slash-replies" role="listbox" aria-label="Saved replies">{slashMatches.length === 0 ? <p className="slash-replies-empty">{savedReplies.length ? 'No saved reply matches.' : 'Loading saved replies…'}</p> : slashMatches.map(({ reply, parsed }) => <button type="button" role="option" aria-selected="false" key={reply.id} dir={parsed.lang === 'ar' ? 'rtl' : 'ltr'} onPointerDown={(event) => event.preventDefault()} onClick={() => { setDraft(reply.body); window.setTimeout(() => messageInput.current?.focus(), 0) }}><strong>{parsed.label}</strong><span>{reply.body}</span></button>)}</div>}{selected && !selected.assignedTo && myAgentId && composerMode !== 'note' && <div className="claim-bar"><span>No one has taken this chat yet</span><button type="button" disabled={claimBusy} onClick={() => void claimConversation(selected.id)}>{claimBusy ? 'Taking…' : 'Take it'}</button></div>}{selected && threadScrolledUp && <button type="button" className="jump-latest" onClick={jumpToLatest} aria-label={newBelowCount ? `${newBelowCount} new messages` : 'Go to latest message'}>{newBelowCount > 0 && <b>{newBelowCount > 99 ? '99+' : newBelowCount}</b>}<ChevronDown size={22} /></button>}{mentionToast && <button type="button" className="mention-toast" onClick={() => { setSelectedId(mentionToast.conversationId); setMobileChatOpen(true); setMentionToast(null) }}><span className="mention-toast-at" aria-hidden="true">@</span><span><strong>{mentionToast.author}</strong> mentioned you in the chat with <strong>{mentionToast.contact}</strong></span></button>}{mentionPickerOpen && <div className="mention-picker" role="listbox" aria-label="Mention a teammate" data-inbox-popover>{mentionCandidates.map((agent, index) => <button type="button" role="option" aria-selected={index === mentionPickerIndex} key={agent.id} className={index === mentionPickerIndex ? 'active' : ''} onPointerDown={(event) => event.preventDefault()} onClick={() => pickMention(agent)}><span className="mention-picker-avatar" aria-hidden="true">{agent.display_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><span className="mention-picker-name">{agent.display_name}</span>{agent.availability === 'available' && <span className="mention-picker-online" aria-label="Available" />}</button>)}</div>}{composerMode === 'note' && <div className="composer-note-bar" role="status"><Lock size={13} aria-hidden="true" /><span><strong>Internal note</strong> · only your team sees this · type @ to mention</span><button type="button" aria-label="Back to replying to the customer" title="Back to reply" onPointerDown={(event) => event.preventDefault()} onClick={() => setComposerMode('reply')}><X size={14} /></button></div>}{agentsTyping[selected.id] && <div className="agent-typing-banner" role="status"><span className="agent-typing-dots" aria-hidden="true"><i /><i /><i /></span><span><strong>{agentsTyping[selected.id].name}</strong> is typing a reply to this chat…</span></div>}{replyTo && <div className="reply-preview"><div><strong>Replying to {replyTo.from === "agent" ? "yourself" : selected.name}</strong><span>{replyTo.text || replyTo.attachmentName || "Attachment"}</span></div><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">×</button></div>}<div className="composer">{(recording || voiceFile) ? <div className="voice-inline" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '2px 4px', width: '100%' }}>{recording ? <div className="voice-recording-bar"><button type="button" className="voice-recording-finish" onClick={stopVoiceRecording} aria-label="Stop recording and preview" title="Stop recording and preview"><Square size={16} /></button><button type="button" className="voice-recording-pause" onClick={toggleRecordingPause} aria-label={recordingPaused ? "Resume recording" : "Pause recording"} title={recordingPaused ? "Resume recording" : "Pause recording"}>{recordingPaused ? <Play size={17} fill="currentColor" strokeWidth={1.8} /> : <Pause size={18} fill="currentColor" strokeWidth={1.8} />}</button><div className="voice-recording-wave" aria-label={recordingPaused ? "Recording paused" : "Recording in progress"}>{Array.from({ length: 35 }, (_, i) => <span key={i} style={{ height: `${4 + Math.round(Math.abs(Math.sin(i * 1.89) * Math.cos(i * 0.71)) * 17)}px` }} />)}</div><span className="voice-recording-time">{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span><span className="voice-recording-dot" /><button type="button" className="voice-recording-discard" onClick={discardVoiceRecording} aria-label="Discard recording" title="Discard recording"><Trash2 size={18} /></button></div> : <><VoiceNotePlayer src={voicePreviewUrl || ""} /><button type="button" onClick={clearVoice} aria-label="Discard recording" title="Discard recording"><Trash2 size={16} /></button></>}</div> : <div className="composer-editor-wrap" onKeyDownCapture={(event) => { if (!mentionPickerOpen) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setMentionPickerIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length) } else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); pickMention(mentionCandidates[mentionPickerIndex] ?? mentionCandidates[0]) } }}><EmojiComposer placeholder={composerMode === 'note' ? 'Internal note… type @ to mention a teammate' : 'Type a message...'} editorRef={messageInput} value={draft} onChange={setDraft} onFile={setAttachment} onSend={() => { if (composerMode === 'note') { void sendNote(); return } if (!sendingMessage) void sendMessage() }} /></div>}{attachment && <div className="composer-attachment-preview">{attachmentPreviewUrl && <img className="composer-image-preview" src={attachmentPreviewUrl} alt={`Preview of ${attachment.name}`} /> }<div className="attachment-chip"><Paperclip size={14} /><span title={attachment.name}>{attachment.name}</span><button type="button" onClick={() => { setAttachment(null); if (attachmentInput.current) attachmentInput.current.value = ''; }} aria-label="Remove attachment"><X size={12} /></button></div></div>}{chatTemplateOpen && <div className="chat-template-panel" data-inbox-popover><div className="chat-template-panel-head"><strong>Send a template</strong><button type="button" onClick={() => { setChatTemplateOpen(false); setChatTemplateSelection(null) }} aria-label="Close template picker"><X size={16}/></button></div><WhatsAppTemplatePicker onChange={setChatTemplateSelection} onActiveChange={setChatTemplateActive} disabled={sendingMessage} contactName={selected?.name || ''}/><button type="button" className="chat-template-send" disabled={!chatTemplateSelection || sendingMessage} onClick={() => void sendChatTemplate()}>Send template</button></div>}<div className="composer-tools"><div className="composer-plus-wrap" data-inbox-popover><button type="button" className="composer-plus" onPointerDown={(event) => event.preventDefault()} aria-label="More options" aria-expanded={composerMenuOpen} onClick={() => { setEmojiOpen(false); setStickerOpen(false); setQuickRepliesOpen(false); if (composerMenuOpen) { setComposerMenuOpen(false); messageInput.current?.focus(); return } messageInput.current?.blur(); setComposerMenuOpen(true) }}>{composerMenuOpen ? <><Keyboard className="plus-open-phone" size={26} strokeWidth={1.8} /><X className="plus-open-desktop" size={26} strokeWidth={1.8} /></> : <Plus size={26} strokeWidth={1.8} />}</button>{composerMenuOpen && <div className="composer-plus-menu" role="menu" aria-label="More options"><button type="button" role="menuitem" onClick={() => { setComposerMenuOpen(false); attachmentInput.current?.click() }}><span className="composer-plus-icon attach"><Paperclip size={24} /></span>Attach file</button><button type="button" role="menuitem" onClick={() => { setComposerMenuOpen(false); setChatTemplateOpen(true); setChatTemplateSelection(null); setQuickRepliesOpen(false); setEmojiOpen(false) }}><span className="composer-plus-icon template"><MessageSquareCheck size={24} /></span>Template</button><button type="button" role="menuitem" onClick={() => { setComposerMenuOpen(false); void openQuickReplies() }}><span className="composer-plus-icon replies"><FileText size={24} /></span>Saved replies</button><button type="button" role="menuitem" onClick={() => { setComposerMenuOpen(false); setComposerMode("note"); requestAnimationFrame(() => messageInput.current?.focus()) }}><span className="composer-plus-icon note"><Lock size={24} /></span>Internal note</button></div>}</div><input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { setAttachment(event.target.files?.[0] || null); event.target.value = '' }} /><button type="button" className="composer-camera" aria-label="Take photo" title="Take photo" onClick={() => cameraInput.current?.click()}><Camera size={24} strokeWidth={1.8} /></button><div className="composer-left-tools"><button type="button" className={`composer-tool-template ${chatTemplateOpen ? 'tool-active' : ''}`} data-inbox-popover aria-label="Meta templates" title="Send approved Meta template" onClick={() => { setChatTemplateOpen((open) => !open); setChatTemplateSelection(null); setQuickRepliesOpen(false); setEmojiOpen(false) }}><MessageSquareCheck size={18} color="#e35a20"/></button><input ref={attachmentInput} type="file" hidden onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><button className="composer-tool-attach" aria-label="Attach file" onClick={() => attachmentInput.current?.click()}><Paperclip size={17} /></button><button type="button" className="composer-mic" aria-label={recording ? "Stop voice recording" : "Record voice message"} title={recording ? "Stop recording" : "Record voice message"} onClick={() => recording ? stopVoiceRecording() : void startVoiceRecording()} disabled={sendingMessage}><Mic size={17} color={recording ? "#d92d20" : undefined} /></button><div className="emoji-picker-wrap composer-sticker-wrap" data-inbox-popover><button type="button" onPointerDown={(event) => event.preventDefault()} aria-label="Saved stickers" title="Saved stickers" className={stickerOpen?'tool-active':''} onClick={()=>{setEmojiOpen(false);setComposerMenuOpen(false);if(stickerOpen){setStickerOpen(false);messageInput.current?.focus();return}messageInput.current?.blur();setStickerOpen(true);void loadStickers()}}>{stickerOpen?<Keyboard size={22} className="sticker-keyboard-icon"/>:<><svg className="sticker-icon-classic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 13V6a3 3 0 0 0-3-3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h6l7-8Z"/><path d="M13 21v-5a3 3 0 0 1 3-3h4"/><path d="M8 9h.01M15 9h.01"/><path d="M8.5 13a4.5 4.5 0 0 0 6 0"/></svg><svg className="sticker-icon-phone" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 1 9-9c0 1-.2 1.9-.5 2.8L14.8 20.5c-.9.3-1.8.5-2.8.5Z"/><path d="M20.5 14.8 14.8 20.5c-.4-2.9 2.8-6.1 5.7-5.7Z"/><circle cx="9" cy="10" r=".7" fill="currentColor"/><circle cx="15" cy="10" r=".7" fill="currentColor"/><path d="M8.6 14.3c.9.9 2.1 1.3 3.4 1.2"/></svg></>}</button>{stickerOpen&&<div className="saved-sticker-panel" role="dialog" aria-label="Saved stickers"><div className="saved-sticker-header"><div><strong>Saved stickers</strong><span>{savedStickers.length} saved · Click to send</span></div><button type="button" className="saved-sticker-close" aria-label="Close sticker picker" onClick={()=>setStickerOpen(false)}><X size={17}/></button></div><div className="saved-sticker-grid">{savedStickers.length===0?<p className="saved-sticker-empty">No saved stickers yet. Save a received sticker to add it here.</p>:savedStickers.map(sticker=><button type="button" className="saved-sticker-item" key={sticker.id} title="Send sticker" disabled={sendingMessage} onClick={()=>void sendSticker(sticker.media_id)}><img src={`/api/media?mediaId=${encodeURIComponent(sticker.media_id)}`} alt="Saved sticker" loading="lazy" onError={(event)=>{const tile=event.currentTarget.closest('button');tile?.classList.add('is-broken');tile?.setAttribute('disabled','');tile?.setAttribute('title','This sticker is no longer available from WhatsApp')}}/></button>)}</div></div>}</div><div className="emoji-picker-wrap composer-emoji-wrap" data-inbox-popover><button className={emojiOpen ? 'tool-active' : ''} aria-label="Emoji" aria-expanded={emojiOpen} onClick={() => { setOpenMessageMenu(null); setQuickRepliesOpen(false); setEmojiOpen((open) => !open) }}><Smile size={17} /></button>{emojiOpen && <div className="emoji-picker" role="dialog" aria-label="Emoji picker"><div className="emoji-category-tabs">{emojiCategories.map((category) => <button type="button" key={category.id} className={emojiCategory === category.id ? 'active' : ''} title={category.label} onClick={() => { setEmojiCategory(category.id); setEmojiSearch('') }}>{category.icon}</button>)}</div><div className="emoji-search"><Search size={14}/><input value={emojiSearch} onChange={(event) => setEmojiSearch(event.target.value)} placeholder="Search emoji" aria-label="Search emoji"/></div><div className="emoji-scroll">{shownEmojiCategories.map((category) => <section className="emoji-section" key={category.id}><strong>{category.label}</strong><div className="emoji-grid">{category.emojis.map((emoji, index) => <button type="button" key={emoji + index} onPointerDown={(event) => event.preventDefault()} onClick={() => insertEmoji(emoji)} aria-label={`Insert ${emoji}`}><EmojiArtwork emoji={emoji} /></button>)}</div></section>)}</div></div>}</div><div className="quick-reply-wrap" data-inbox-popover><button className={quickRepliesOpen ? 'tool-active' : ''} aria-label="Saved replies" onClick={() => void openQuickReplies()}><FileText size={17} /></button>{quickRepliesOpen && <><div className="qr-sheet-backdrop" onClick={() => setQuickRepliesOpen(false)} aria-hidden="true" /><div className="quick-reply-menu qr-sheet" role="dialog" aria-label="Saved replies"><div className="qr-sheet-grip" aria-hidden="true" /><div className="qr-sheet-head"><strong>Saved replies</strong><button type="button" onClick={() => setQuickRepliesOpen(false)} aria-label="Close saved replies"><X size={18} /></button></div>{savedReplyError && <p className="login-error" role="alert">{savedReplyError}</p>}<QuickReplyList replies={savedReplies} initialLanguage={(() => { const last = [...selectedVisibleMessages].reverse().find((message) => message.from === 'customer' && message.text?.trim()); return last ? detectLanguage(last.text) : 'ar' })()} onTap={(reply) => useSavedReply(reply)} /><button className="manage-replies-link" onClick={() => void openSavedReplies()}>Manage saved replies</button></div></>}</div></div>{(() => { const noteMode = composerMode === 'note'; const canSend = noteMode ? Boolean(draft.trim()) : Boolean((chatTemplateOpen && chatTemplateSelection) || voiceFile || draft.trim() || attachment); return <button data-inbox-popover onPointerDown={(event) => { event.preventDefault(); editorFocusedAtSendRef.current = document.activeElement === messageInput.current; if (!canSend && !noteMode && !sendingMessage && !recording) { micPressStartedRef.current = true; void startVoiceRecording(); messageInput.current?.blur() } }} className={`send-btn ${canSend || noteMode || recording ? '' : 'send-btn-mic'} ${noteMode ? 'send-btn-note' : ''}`} onClick={() => { if (recording) { sendAfterStopRef.current = true; stopVoiceRecording(); return } if (micPressStartedRef.current) { micPressStartedRef.current = false; return } if (canSend && !noteMode && editorFocusedAtSendRef.current && !(chatTemplateOpen && chatTemplateSelection) && !voiceFile) { editorFocusedAtSendRef.current = false; if (document.activeElement !== messageInput.current) messageInput.current?.focus() } if (noteMode) { void sendNote(); return } void (!canSend ? startVoiceRecording() : chatTemplateOpen && chatTemplateSelection ? sendChatTemplate() : voiceFile ? sendVoiceMessage() : sendMessage()) }} disabled={sendingMessage || (noteMode && (!canSend || noteSaving))} aria-label={noteMode ? "Save internal note" : sendingMessage ? "Sending message" : recording ? "Send voice message" : canSend ? "Send" : "Record voice message"} title={noteMode ? "Save internal note (only your team sees it)" : sendingMessage ? "Sending…" : canSend ? "Send message" : "Record voice message"}>{canSend || noteMode || recording ? <Send size={16} /> : <Mic size={18} />}</button> })()}</div></div>{!replyWindowOpen && <p role="status" className="reply-window-notice" style={{ color: '#9a5700', background: 'transparent', border: 'none', borderRadius: 0, padding: 0, fontSize: 10, lineHeight: 1.4, margin: '5px 12px 2px' }}>WhatsApp’s 24-hour reply window is closed. Send an approved template to reopen the conversation.</p>}{messageSendError && <p role="alert" style={{ color: "#b42318", fontSize: 12, margin: "6px 12px" }}>{messageSendError}</p>}<p className="composer-hint">Messages are sent through Meta WhatsApp Cloud API.</p></div></> : <div className="empty-thread">Select a conversation</div>}</section>
    {messageActions && selected && <div className={`message-actions-overlay ${messageActionsLayout ? 'anchored' : ''}`} role="presentation" onPointerDownCapture={() => { menuArmedRef.current = true }} onClick={armed(() => setMessageActions(null))}><div className={`message-actions-stack ${messageActions.from === 'agent' ? 'mine' : ''}`} role="dialog" aria-label="Message actions" onClick={(event) => event.stopPropagation()}>{messageActions.externalId && <div className="message-reaction-bar" style={messageActionsLayout?.bar}>{['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => <button type="button" key={emoji} aria-label={`React ${emoji}`} className={myReaction(messageActions) === emoji ? 'chosen' : ''} onClick={armed(() => void reactToMessage(messageActions, myReaction(messageActions) === emoji ? '' : emoji))}><EmojiArtwork emoji={emoji} /></button>)}<button type="button" className="message-reaction-more" aria-label="More reactions" onClick={armed(() => { setReactionPickerFor(messageActions); setMessageActions(null) })}><Plus size={22} /></button></div>}<div className="message-actions-bubble">{messageActions.text || (/^sticker attachment$/i.test(messageActions.attachmentName || '') ? 'Sticker' : messageActions.attachmentName || 'Attachment')}</div><div className="message-actions-menu" style={messageActionsLayout?.menu}><button type="button" onClick={armed(() => { setReplyTo(messageActions); setMessageActions(null) })}><span>Reply</span><Reply size={20} /></button>{canForwardMessage(messageActions) && <button type="button" onClick={armed(() => { setForwardItems([messageActions]); setMessageActions(null) })}><span>Forward</span><Forward size={20} /></button>}<button type="button" onClick={armed(() => { setSelectMode(true); setSelectedMessageIds([String(messageActions.id)]); setMessageActions(null) })}><span>Select</span><CheckCircle2 size={20} /></button>{messageActions.text && <button type="button" onClick={armed(() => { void navigator.clipboard?.writeText(messageActions.text).catch(() => {}); setMessageActions(null) })}><span>Copy</span><Copy size={20} /></button>}<button type="button" className="danger" onClick={armed(() => { const target = messageActions; setMessageActions(null); void deleteInboxContent(selected.id, target.id) })}><span>Delete</span><Trash2 size={20} /></button></div></div></div>}
    {reactionPickerFor && <div className={`message-actions-overlay reaction-picker-overlay ${reactionPickerLayout ? 'anchored' : ''}`} role="presentation" onClick={() => setReactionPickerFor(null)}><div className="reaction-picker-sheet" style={reactionPickerLayout ?? undefined} role="dialog" aria-label="Choose a reaction" onClick={(event) => event.stopPropagation()}><div className="reaction-picker-grabber" /><div className="reaction-picker-scroll">{emojiCategories.map((category) => <section key={category.id}><strong>{category.label}</strong><div className="reaction-picker-grid">{[...new Set(category.emojis)].map((emoji) => <button type="button" key={emoji} className={myReaction(reactionPickerFor) === emoji ? 'chosen' : ''} onClick={() => void reactToMessage(reactionPickerFor, myReaction(reactionPickerFor) === emoji ? '' : emoji)}><EmojiArtwork emoji={emoji} /></button>)}</div></section>)}</div></div></div>}
    {forwardItems && (() => {
      const items = forwardItems.filter(canForwardMessage)
      const skipped = forwardItems.length - items.length
      const canForward = items.length > 0
      const describe = (item: Message) => item.text.trim() ? item.text : item.attachmentName && !/ attachment$/.test(item.attachmentName) ? `📎 ${item.attachmentName}` : /audio|voice/i.test(item.attachmentName || '') ? '🎤 Voice message' : /image|sticker/i.test(item.attachmentName || '') ? '📷 Photo' : /video/i.test(item.attachmentName || '') ? '🎬 Video' : '📎 Attachment'
      const query = forwardQuery.trim().toLowerCase()
      const options = conversations.filter((conversation) => !query || `${contactDisplayName(conversation.name, conversation.phone)} ${conversation.phone}`.toLowerCase().includes(query))
      const chosen = conversations.filter((conversation) => forwardTargets.includes(conversation.id))
      const toggle = (conversation: Conversation) => setForwardTargets((current) => current.includes(conversation.id) ? current.filter((id) => id !== conversation.id) : current.length >= 5 ? current : [...current, conversation.id])
      return <div className="message-actions-overlay forward-overlay" role="presentation" onClick={() => { if (!forwardBusy) setForwardItems(null) }}><div className="forward-sheet" role="dialog" aria-label="Forward message" onClick={(event) => event.stopPropagation()}>
        <span className="forward-grabber" aria-hidden="true" />
        <div className="forward-sheet-head"><button type="button" className="forward-cancel" onClick={() => setForwardItems(null)} disabled={forwardBusy}>Cancel</button><strong>Forward</strong><span className="forward-limit">{forwardTargets.length}/5</span></div>
        <div className="forward-preview"><Forward size={15} aria-hidden="true" /><div className="forward-preview-lines">{items.length > 1 && <strong>{items.length} messages</strong>}{items.slice(0, 3).map((item) => <p key={item.id} dir="auto">{describe(item)}</p>)}{items.length > 3 && <small>+{items.length - 3} more</small>}{!items.length && <p>Nothing to forward</p>}</div></div>
        {skipped > 0 && <p className="forward-warning">{skipped === 1 ? '1 message' : `${skipped} messages`} can't be forwarded (still sending or failed) and will be left out.</p>}
        <div className="forward-search"><Search size={16} aria-hidden="true" /><input value={forwardQuery} onChange={(event) => setForwardQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" /></div>
        {chosen.length > 0 && <div className="forward-chosen">{chosen.map((conversation) => <button type="button" key={conversation.id} onClick={() => toggle(conversation)} aria-label={`Remove ${contactDisplayName(conversation.name, conversation.phone)}`}><ContactAvatar phone={conversation.phone} name={conversation.name} /><span>{contactDisplayName(conversation.name, conversation.phone).split(' ')[0]}</span><i aria-hidden="true"><X size={10} strokeWidth={3} /></i></button>)}</div>}
        <p className="forward-section-label">{query ? `${options.length} result${options.length === 1 ? '' : 's'}` : 'Recent chats'}</p>
        <div className="forward-sheet-list">{options.length === 0 ? <p className="forward-empty">No chats found.</p> : options.map((conversation) => { const open = windowOpenFor(conversation); const on = forwardTargets.includes(conversation.id); const full = !on && forwardTargets.length >= 5; return <button type="button" key={conversation.id} className={`${on ? 'is-chosen' : ''}${!open ? ' is-closed' : ''}`} onClick={() => open && !full && canForward && toggle(conversation)} disabled={!open || !canForward || full} aria-pressed={on}><ContactAvatar phone={conversation.phone} name={conversation.name} /><span className="forward-row-copy"><strong dir="auto">{contactDisplayName(conversation.name, conversation.phone)}</strong><small>{open ? (conversation.id === selectedId ? 'This chat' : displayPhone(conversation.phone)) : '24-hour window closed · needs a template'}</small></span><i className="forward-check" aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</i></button> })}</div>
        <div className="forward-footer"><button type="button" className="forward-send" disabled={!chosen.length || !canForward || forwardBusy} onClick={() => void forwardMessage()}>{forwardBusy ? 'Forwarding…' : chosen.length ? `Forward to ${chosen.length} chat${chosen.length === 1 ? '' : 's'}` : 'Choose chats'}{!forwardBusy && <Send size={16} aria-hidden="true" />}</button></div>
      </div></div>
    })()}
    {forwardNotice && <div className="forward-toast" role="status">{forwardNotice}</div>}
    {detailsOpen && <aside className="details-pane">{selected ? <><div className="details-title"><p className="eyebrow">CONTACT DETAILS</p><button className="icon-btn" onClick={() => { setDetailsOpen(false); setMobileDetailsOpen(false) }} aria-label="Close details" title="Close contact details"><X size={17} /></button></div><div className="profile"><ContactAvatar phone={selected.phone} name={selected.name} className="profile-avatar" /><h2>{contactDisplayName(selected.name, selected.phone)}</h2><span className={`type-badge large-badge ${selected.type.toLowerCase()}`}>{selected.type}</span><button type="button" onClick={startContactEdit} aria-label="Name or rename customer" title="Name or rename customer" style={{ display: "block", alignSelf: "center", border: "1px solid #d9e3ee", borderRadius: 8, padding: "6px 13px", background: "#f7fafc", color: "#375e83", fontSize: 12, fontWeight: 600, cursor: "pointer", margin: "12px auto 0" }}>Edit contact</button></div><div className="detail-section contact-card"><div className="section-heading"><h3>CONTACT</h3></div><dl><dt>Phone</dt><dd>{displayPhone(selected.phone)}</dd><dt>Channel</dt><dd><span className="whatsapp-channel-dot" />WhatsApp</dd></dl></div><div className="detail-section conversation-tags-section"><div className="section-heading"><h3>TAGS</h3></div><ConversationTags conversationId={selected.id} agentId={sessionUser?.agentId} /></div><div className="detail-section assignment-card"><div className="section-heading"><h3>ASSIGNED TEAM</h3><button><MoreHorizontal size={16} /></button></div><span className="field-label">Assigned to</span><DetailPicker label="Assigned to" value={selected.assignedTo || ''} onChange={(value) => void updateConversation({ assigned_agent_id: value || null })} options={[{ value: '', label: 'Unassigned', icon: <span className="picker-avatar picker-avatar-empty" aria-hidden="true">–</span> }, ...agents.map((agent) => ({ value: agent.id, label: agent.display_name, hint: agent.id === sessionUser?.agentId ? 'You' : agent.availability === 'away' ? 'Away' : undefined, icon: <span className="picker-avatar" aria-hidden="true">{agentInitials(agent.display_name || '?')}<i className={`picker-presence ${agent.availability === 'away' ? 'away' : agent.availability === 'available' ? 'available' : ''}`} /></span> }))]} /><span className="field-label">Conversation status</span><DetailPicker label="Conversation status" value={selected.status} onChange={(value) => void updateConversation({ status: value })} options={[{ value: 'open', label: 'Open', icon: <i className="picker-dot open" aria-hidden="true" /> }, { value: 'pending', label: 'Pending', icon: <i className="picker-dot pending" aria-hidden="true" /> }, { value: 'closed', label: 'Closed', icon: <i className="picker-dot closed" aria-hidden="true" /> }]} /></div><div className="detail-section notes"><div className="section-heading"><h3>Internal notes</h3><button onClick={() => { setComposerMode('note'); setDetailsOpen(window.matchMedia('(max-width: 1280px)').matches ? false : detailsOpen); setMobileDetailsOpen(false); requestAnimationFrame(() => messageInput.current?.focus()) }}>Add note</button></div>{selected.notes.length === 0 && <p className="notes-empty">No notes yet. Tap “Add note” to write one in the chat — only your team sees it.</p>}{selected.notes.map((note) => <p key={note.id} className="note-item"><strong>{note.agentName}</strong> · {note.time}<br /><NoteBody body={note.body} myAgentId={myAgentId} /></p>)}</div></> : <div className="empty-details">No contact selected</div>}</aside>}
    {savedRepliesOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSavedRepliesOpen(false) }}><section className="conversation-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="saved-replies-title"><div className="modal-header"><div><p className="eyebrow">TEAM LIBRARY</p><h2 id="saved-replies-title">Saved replies</h2></div><button className="icon-btn" onClick={() => { setSavedRepliesOpen(false); cancelEditSavedReply() }} aria-label="Close saved replies"><X size={18} /></button></div><div className="saved-reply-toolbar">{!replyFormOpen && <button type="button" className="send-btn saved-reply-new" onClick={() => { cancelEditSavedReply(); setReplyFormOpen(true) }}>+ New reply</button>}</div>{replyFormOpen && <form className="team-add-form saved-reply-form" onSubmit={(event) => void saveSavedReply(event)}><input value={savedReplyTitle} onChange={(event) => setSavedReplyTitle(event.target.value)} placeholder="Title (e.g. QR31-AR | موضوع الرد)" required /><textarea value={savedReplyBody} onChange={(event) => setSavedReplyBody(event.target.value)} placeholder="Reply text" rows={5} required /><button className="send-btn saved-reply-save" type="submit" disabled={savedReplyBusy}>{editingReplyId ? 'Update' : 'Save'}</button><button className="secondary-btn" type="button" onClick={cancelEditSavedReply}>Cancel</button></form>}{savedReplyError && <p className="login-error" role="alert">{savedReplyError}</p>}<div className="saved-reply-list"><QuickReplyList replies={savedReplies} expandedId={expandedReplyId} onTap={(reply) => { setExpandedReplyId((current) => current === reply.id ? null : reply.id); setDeleteArmedReplyId(null) }} renderExpanded={(reply) => <div className="qr-list-actions" dir="ltr">{selected && <button type="button" className="send-btn" onClick={() => { setDraft(reply.body); setSavedRepliesOpen(false); cancelEditSavedReply(); setExpandedReplyId(null); setActiveNav('inbox'); setMobileChatOpen(true) }}>Use in chat with {contactDisplayName(selected.name, selected.phone)}</button>}<button type="button" className="secondary-btn" onClick={() => { void navigator.clipboard?.writeText(reply.body).then(() => { setReplyCopiedId(reply.id); window.setTimeout(() => setReplyCopiedId((current) => current === reply.id ? null : current), 1500) }).catch(() => {}) }}>{replyCopiedId === reply.id ? 'Copied ✓' : 'Copy'}</button><button className="secondary-btn" type="button" disabled={savedReplyBusy} onClick={() => beginEditSavedReply(reply)}>Edit</button><button className={`team-toggle${deleteArmedReplyId === reply.id ? ' armed' : ''}`} type="button" disabled={savedReplyBusy} onClick={() => { if (deleteArmedReplyId !== reply.id) { setDeleteArmedReplyId(reply.id); return } setDeleteArmedReplyId(null); setExpandedReplyId(null); void deleteSavedReply(reply.id) }}>{deleteArmedReplyId === reply.id ? 'Tap again to delete' : 'Delete'}</button></div>} /></div></section></div>}
    {workspaceSettingsOpen && sessionUser?.role === 'admin' && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setWorkspaceSettingsOpen(false) }}><section className="conversation-modal workspace-settings-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title"><div className="modal-header"><div><p className="eyebrow">ADMINISTRATION</p><h2 id="workspace-settings-title">Workspace settings</h2></div><button className="icon-btn" aria-label="Close settings" onClick={() => setWorkspaceSettingsOpen(false)}><X size={18}/></button></div><div className="workspace-settings-content"><section><h3>Auto reply menu</h3><AutoReplySettings /></section><section><h3>Workspace</h3><p>Myticket WhatsApp Shared Inbox</p><p>Manage your employees, administrator privileges, and department assignments.</p><button className="secondary-btn" onClick={() => { setWorkspaceSettingsOpen(false); void openTeam() }}>Manage team and departments</button></section><section><h3>WhatsApp integration</h3><p>Messages are sent through Meta WhatsApp Cloud API. Phone number, webhook credentials, and API tokens are managed securely in server configuration, not in this interface.</p></section><section><h3>Security</h3><p>Only Administrators can invite or manage members. Each employee must use their own account.</p><p>To change your own password, open My account &amp; password from your profile.</p></section></div></section></div>}
    {accountSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAccountSettingsOpen(false) }}><section className="conversation-modal workspace-settings-modal" role="dialog" aria-modal="true" aria-labelledby="account-settings-title"><div className="modal-header"><div><p className="eyebrow">MY ACCOUNT</p><h2 id="account-settings-title">Account settings</h2></div><button className="icon-btn" aria-label="Close account settings" onClick={() => setAccountSettingsOpen(false)}><X size={18}/></button></div><div className="workspace-settings-content"><section><h3>Profile</h3><p><strong>Email:</strong> {sessionUser?.email}</p><p><strong>Role:</strong> {sessionUser?.role === 'admin' ? 'Administrator' : 'Team Member'}</p><p><strong>Availability:</strong> {selfAvailability}</p><div className="account-availability-actions"><button className="secondary-btn" onClick={() => void updateSelfAvailability('available')}>Set available</button><button className="secondary-btn" onClick={() => void updateSelfAvailability('away')}>Set away</button></div></section>{sessionUser?.role === 'admin' && <section className="account-invitations"><h3>Team invitations</h3>{teamAgents.map((agent) => <div className="account-invitation" key={agent.id}><strong>{agent.display_name}</strong><span>{agent.email}</span><small style={{ color: agent.invitation_status === 'pending' ? '#b36b00' : agent.invitation_status === 'active' ? '#14805e' : '#53657b' }}>Invitation: {agent.invitation_status === 'active' ? 'Active (signed in)' : agent.invitation_status === 'accepted' ? 'Accepted (not signed in)' : agent.invitation_status === 'pending' ? 'Pending acceptance' : 'Unknown'}{agent.invited_at ? ' · ' + formatInviteDate(agent.invited_at) : ''}</small>{sessionUser?.role==='admin' && agent.invitation_status !== 'active' && <button type="button" className="team-invite-renew" disabled={teamBusy} onClick={async()=>{setTeamBusy(true);try{const response=await fetch('/api/team',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:agent.id,action:'regenerate_invite'})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to generate link');setAgentInvitationLink(result.invitationLink);setTeamNotice('New invitation link generated. Copy and share it privately.');}catch(error){setTeamError(error instanceof Error?error.message:'Unable to generate link')}finally{setTeamBusy(false)}}}>Regenerate invite link</button>}</div>)}{invitationNotice}</section>}{nativeApp ? <section><h3>Notifications</h3><p>New customer messages arrive as iPhone notifications. If they don't, send a test: it checks each step and says which one fails.</p><button className="secondary-btn" type="button" disabled={pushTestBusy} onClick={() => void testNativeNotification()}>{pushTestBusy ? 'Testing…' : 'Send a test notification'}</button>{pushFeedback && <p role="status">{pushFeedback}</p>}</section> : <section><h3>Browser notifications</h3><p>Receive one notification per customer or vendor until you reply. Email alerts go to your account email when configured by the administrator.</p><button className="secondary-btn" type="button" onClick={() => void configureBrowserPush()}>{pushEnabled ? 'Disable browser notifications' : 'Enable browser notifications'}</button><button className="secondary-btn" type="button" disabled={pushTestBusy} onClick={() => void testBrowserNotification()}>{pushTestBusy ? 'Testing…' : 'Test notification & sound'}</button>{pushFeedback && <p role="status">{pushFeedback}</p>}</section>}<section><h3>Change password</h3><form className="account-password-form" onSubmit={event => void changeOwnPassword(event)}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={accountPassword} onChange={event => setAccountPassword(event.target.value)} /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={accountPasswordConfirm} onChange={event => setAccountPasswordConfirm(event.target.value)} /></label>{accountPasswordFeedback && <p role="status">{accountPasswordFeedback}</p>}<button className="send-btn" type="submit" disabled={accountPasswordBusy || accountPassword.length < 12 || accountPassword !== accountPasswordConfirm}>{accountPasswordBusy ? 'Updating…' : 'Update password'}</button></form></section><section><button className="secondary-btn logout-button" onClick={() => void signOut()}>Log out</button></section></div></section></div>}
    {teamOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTeamOpen(false) }}><section className="conversation-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-title"><div className="modal-header"><div><p className="eyebrow">WORKSPACE</p><h2 id="team-title">Team</h2></div><button className="icon-btn" onClick={() => setTeamOpen(false)} aria-label="Close team"><X size={18} /></button></div>{sessionUser?.role === 'admin' && <form className="team-add-form" onSubmit={(event) => void addAgent(event)}><input value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} placeholder="Agent name" required /><input type="email" value={newAgentEmail} onChange={(event) => setNewAgentEmail(event.target.value)} placeholder="Agent email" required /><select aria-label="Account role" value={newAgentRole} onChange={e=>setNewAgentRole(e.target.value as "admin"|"agent")}><option value="agent">Team Member</option><option value="admin">Administrator</option></select>{newAgentRole==="agent"&&<fieldset className="team-departments"><legend>Departments</legend>{[["customer_support","Customer Support"],["supplier_relations","Supplier Relations"],["booking_operations","Booking Operations"]].map(([id,label])=><label key={id}><input type="checkbox" checked={newAgentDepartments.includes(id)} onChange={e=>setNewAgentDepartments(current=>e.target.checked?[...current,id]:current.filter(x=>x!==id))}/>{label}</label>)}</fieldset>}<button className="send-btn" type="submit" disabled={teamBusy||(newAgentRole==="agent"&&!newAgentDepartments.length)}>Generate invitation link</button></form>}{teamError && <p className="login-error" role="alert">{teamError}</p>}{invitationNotice}<div className="team-list">{teamAgents.map((agent) => { const assigned = agent.whatsapp_conversations ?? []; return <article className="team-row" key={agent.id}><div className="team-avatar">{agent.display_name.slice(0, 2).toUpperCase()}</div><div className="team-info"><strong>{agent.display_name}</strong><small>{assigned.length} assigned conversation{assigned.length === 1 ? '' : 's'}</small></div><select value={agent.availability ?? 'offline'} disabled={sessionUser?.role !== 'admin' || teamBusy} onChange={(event) => void updateAgent(agent.id, { availability: event.target.value })}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select><select value={agent.role ?? 'agent'} disabled={sessionUser?.role !== 'admin' || teamBusy} onChange={(event) => void updateAgent(agent.id, { role: event.target.value })}><option value="agent">Team Member</option><option value="admin">Administrator</option></select>{sessionUser?.role==='admin'&&agent.role!=='admin'&&<div className="team-departments"><small>Departments</small>{[["customer_support","Customer Support"],["supplier_relations","Supplier Relations"],["booking_operations","Booking Operations"]].map(([id,label])=><label key={id}><input type="checkbox" checked={(agent.departments??[]).includes(id)} disabled={teamBusy} onChange={event=>{const departments=event.target.checked?[...(agent.departments??[]),id]:(agent.departments??[]).filter(x=>x!==id);if(departments.length)void updateAgent(agent.id,{departments} as unknown as Record<string,string|boolean>)}}/>{label}</label>)}</div>}<button className="team-toggle" disabled={sessionUser?.role !== 'admin' || teamBusy} onClick={() => void updateAgent(agent.id, { is_active: !agent.is_active })}>{agent.is_active ? 'Deactivate' : 'Activate'}</button>{sessionUser?.role === 'admin' && agent.id !== sessionUser.agentId && <button type="button" className="team-toggle" style={{ color:'#c93b35', borderColor:'#f4b7b2', background:'#fff8f7' }} disabled={teamBusy} onClick={() => setAgentDeleteTarget(agent)}>Delete</button>}</article> })}</div></section></div>}
    {editingContact && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingContact(false) }}><section className="conversation-modal contact-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title"><div className="modal-header"><div><p className="eyebrow">CONTACT DETAILS</p><h2 id="edit-contact-title">Edit contact</h2></div><button className="icon-btn" onClick={() => setEditingContact(false)} aria-label="Close edit contact"><X size={18} /></button></div><div className="conversation-form contact-edit-form"><label htmlFor="edit-contact-name">{selected && (selected.name === selected.phone || selected.name === displayPhone(selected.phone)) ? "Name this customer" : "Customer name"}</label><input id="edit-contact-name" autoFocus placeholder="Enter customer name" value={contactNameDraft} onChange={(event) => setContactNameDraft(event.target.value)} required /><p style={{ margin: "0 0 8px", color: "#738398", fontSize: 12 }}>Phone: {selected ? displayPhone(selected.phone) : ""} — unchanged</p><label htmlFor="edit-contact-type">Type</label><select id="edit-contact-type" value={contactTypeDraft} onChange={(event) => setContactTypeDraft(event.target.value as 'customer' | 'supplier' | 'team')}><option value="customer">Customer</option><option value="supplier">Vendor</option><option value="team">Team</option></select><div className="modal-actions contact-edit-actions"><button type="button" className="secondary-btn" onClick={() => setEditingContact(false)}>Cancel</button><button className="send-btn" type="button" disabled={contactSaveBusy} onClick={() => void saveContact()}>{contactSaveBusy ? 'Saving…' : 'Save contact'}</button></div></div></section></div>}
    {groupMessageOpen && <GroupMessage onClose={() => setGroupMessageOpen(false)} onSent={() => { void load() }} />}
    {newConversationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewConversationOpen(false) }}><section className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title"><div className="modal-header"><div><p className="eyebrow">WHATSAPP</p><h2 id="new-conversation-title">New conversation</h2></div><button className="icon-btn" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation"><X size={18} /></button></div><form className="conversation-form" onSubmit={(event) => void createConversation(event)}><label htmlFor="new-contact-name">Contact name</label><input id="new-contact-name" dir="auto" value={newConversationName} onChange={(event) => setNewConversationName(event.target.value)} placeholder="Contact name" required /><label htmlFor="new-contact-phone">WhatsApp number</label><div className="international-phone-field"><div className="country-code-control"><select aria-label="Country dialing code" value={newConversationCountry} onChange={(event) => setNewConversationCountry(event.target.value)}>{dialingCountries.map(([flag, name, code]) => <option key={name} value={code}>{flag} {code}</option>)}</select><ChevronDown size={15} className="country-code-chevron" aria-hidden="true" /></div><div className="international-phone-input"><span className="phone-input-symbol" aria-hidden="true">☎</span><input id="new-contact-phone" value={newConversationPhone} onChange={(event) => setNewConversationPhone(event.target.value.replace(/[^0-9\s()-]/g, ""))} placeholder="Phone number" inputMode="tel" required /></div></div><WhatsAppTemplatePicker onChange={setNewConversationTemplate} onActiveChange={setNewConversationTemplateActive} disabled={newConversationBusy}/><p className="form-help">Start the conversation with an approved Meta template. Fill in any variables before sending.</p>{newConversationError && <p className="login-error" role="alert">{newConversationError}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setNewConversationOpen(false)}>Cancel</button><button className="send-btn" type="submit" disabled={newConversationBusy || !newConversationTemplate}>{newConversationBusy ? 'Creating…' : 'Create and send'}</button></div></form></section></div>}
    {agentDeleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => {if(event.target===event.currentTarget && !teamBusy)setAgentDeleteTarget(null)}}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-agent-title" aria-describedby="delete-agent-description" style={{background:'#fff',width:'min(350px, calc(100vw - 32px))',borderRadius:14,padding:20,boxShadow:'0 20px 65px #14283a35'}}><div style={{width:34,height:34,borderRadius:10,background:'#fff1ef',color:'#d8493d',display:'grid',placeItems:'center',marginBottom:12}}><Trash2 size={17}/></div><h2 id="delete-agent-title" style={{margin:'0 0 7px',fontSize:17,color:'#17263c'}}>Delete team member?</h2><p id="delete-agent-description" style={{margin:0,fontSize:12.5,lineHeight:1.5,color:'#657386'}}>Permanently delete <strong>{agentDeleteTarget.display_name}</strong>{agentDeleteTarget.email ? ' ('+agentDeleteTarget.email+')' : ''}? Their login access will be revoked and assigned conversations will become unassigned. Chat history will remain. This action cannot be undone.</p><div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:18}}><button type="button" disabled={teamBusy} onClick={()=>setAgentDeleteTarget(null)} style={{padding:'8px 12px',border:'1px solid #dbe2ea',borderRadius:9,background:'#fff',color:'#344054',cursor:'pointer',fontWeight:600}}>Cancel</button><button type="button" disabled={teamBusy} onClick={()=>void deleteAgent(agentDeleteTarget)} style={{padding:'8px 12px',border:0,borderRadius:9,background:'#d94338',color:'#fff',cursor:'pointer',fontWeight:600,opacity:teamBusy?.6:1}}>{teamBusy?'Deleting…':'Delete member'}</button></div></section></div>}
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteBusy) setDeleteTarget(null) }}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" style={{ background: '#fff', width: 'min(350px, calc(100vw - 32px))', borderRadius: 14, padding: 20, boxShadow: '0 20px 65px #14283a35' }}><div style={{ width: 34, height: 34, borderRadius: 10, background: '#fff1ef', color: '#d8493d', display: 'grid', placeItems: 'center', marginBottom: 12 }}><Trash2 size={17}/></div><h2 id="delete-dialog-title" style={{ margin: '0 0 7px', fontSize: 17, color: '#17263c' }}>{deleteTarget.messageId ? 'Delete message?' : 'Delete conversation?'}</h2><p id="delete-dialog-description" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#657386' }}>{deleteTarget.messageId ? 'This message will be permanently removed from Myticket Shared Inbox.' : `The conversation with ${deleteTarget.name} and its message history will be permanently removed from Myticket Shared Inbox.`} It will remain visible in the customer's WhatsApp. This action cannot be undone.</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}><button type="button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)} style={{ padding: '8px 12px', border: '1px solid #dbe2ea', borderRadius: 9, background: '#fff', color: '#344054', cursor: 'pointer', fontWeight: 600 }}>Cancel</button><button type="button" disabled={deleteBusy} onClick={() => void confirmInboxDeletion()} style={{ padding: '8px 12px', border: 0, borderRadius: 9, background: '#d94338', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: deleteBusy ? .6 : 1 }}>{deleteBusy ? 'Deleting…' : deleteTarget.messageId ? 'Delete message' : 'Delete conversation'}</button></div></section></div>}
    {mediaPreview && <div role="presentation" onMouseDown={(event) => {if(event.target===event.currentTarget)setMediaPreview(null)}} style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(9,17,28,.9)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}><button type="button" aria-label="Close media preview" onClick={()=>setMediaPreview(null)} style={{position:"absolute",top:"calc(env(safe-area-inset-top, 0px) + 14px)",right:18,zIndex:2,color:"#fff",background:"#ffffff26",border:0,borderRadius:999,padding:10,cursor:"pointer"}}><X size={22}/></button>{mediaPreview.kind==="image"?<ZoomableImage src={mediaPreview.url} alt={mediaPreview.name} onClose={()=>setMediaPreview(null)} />:<video src={mediaPreview.url} controls autoPlay playsInline style={{maxWidth:"95vw",maxHeight:"85vh",borderRadius:8}}/>}</div>}
  </main>
}

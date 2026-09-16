'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { Archive, Bell, Check, ChevronDown, CircleHelp, FileText, Inbox, Menu, MoreHorizontal, Paperclip, Search, Send, Settings, Smile, Tag, Users, X } from 'lucide-react'

type Status = 'open' | 'pending' | 'closed'
type Agent = { id: string; display_name: string; email?: string }
type Message = { id: string; from: 'customer' | 'agent'; text: string; time: string; status?: string; attachmentUrl?: string; attachmentName?: string }
type Conversation = { id: string; name: string; initials: string; color: string; type: 'Customer' | 'Supplier'; phone: string; preview: string; time: string; unread: number; status: Status; assignedTo: string | null; agentName?: string; messages: Message[]; notes: { id: string; body: string; time: string; agentName: string }[] }

const colors = ['#ff5a1f', '#d9774a', '#ff8b5c', '#b94d25']

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
  const [noteDraft, setNoteDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<'inbox' | 'team' | 'replies' | 'tags'>('inbox')
  const [attachment, setAttachment] = useState<File | null>(null)
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
  const [newConversationMessage, setNewConversationMessage] = useState('')
  const [newConversationTemplate, setNewConversationTemplate] = useState('')
  const attachmentInput = useRef<HTMLInputElement>(null)
  const selected = selectedId ? conversations.find((item) => item.id === selectedId) : undefined

  const load = async () => {
    const response = await fetch('/api/inbox', { cache: 'no-store' })
    if (!response.ok) throw new Error('Inbox unavailable')
    const payload = await response.json()
    const rows: Conversation[] = (payload.conversations ?? []).map((row: any, index: number) => {
      const contact = Array.isArray(row.whatsapp_contacts) ? row.whatsapp_contacts[0] : row.whatsapp_contacts
      const messages = [...(row.whatsapp_messages ?? [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const notes = [...(row.whatsapp_internal_notes ?? [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = messages.at(-1)
      const name = contact?.display_name || 'WhatsApp contact'
      return { id: row.id, name, initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(), color: colors[index % colors.length], type: contact?.contact_type === 'supplier' ? 'Supplier' : 'Customer', phone: contact?.phone || '', preview: last?.body || last?.attachment_name || '', time: last?.created_at ? new Date(last.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', unread: 0, status: row.status, assignedTo: row.assigned_agent_id, agentName: row.whatsapp_agents?.display_name, messages: messages.map((message: any) => ({ id: message.id, from: message.direction === 'outbound' ? 'agent' : 'customer', text: message.body || '', time: new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: message.status, attachmentUrl: message.attachment_url, attachmentName: message.attachment_name })), notes: notes.map((note: any) => ({ id: note.id, body: note.body, time: new Date(note.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), agentName: note.whatsapp_agents?.display_name || 'Agent' })) }
    })
    setConversations(rows)
    setAgents(payload.agents ?? [])
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null)
  }

  useEffect(() => {
    let active = true
    const supabase = createBrowserSupabaseClient()
    if (!supabase) { setIsLoading(false); return }
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      const agentResponse = await fetch('/api/inbox', { cache: 'no-store' })
      const agentPayload = agentResponse.ok ? await agentResponse.json() : { agents: [] }
      const agent = (agentPayload.agents ?? []).find((item: Agent) => item.email?.toLowerCase() === data.user.email?.toLowerCase())
      setSessionUser({ email: data.user.email, agentId: agent?.id, role: data.user.app_metadata?.role || (agent ? 'agent' : 'admin') })
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => { if (active && session?.user) setSessionUser({ email: session.user.email, role: session.user.app_metadata?.role || 'agent' }) })
    void load().catch((error) => console.error('[v0] inbox load failed', error)).finally(() => { if (active) setIsLoading(false) })
    let channel: ReturnType<ReturnType<typeof createBrowserSupabaseClient>['channel']> | undefined
    try { channel = createBrowserSupabaseClient().channel('whatsapp-inbox').on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations' }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_internal_notes' }, () => void load()).subscribe() } catch (error) { console.error('[v0] realtime failed', error) }
    return () => { active = false; if (channel) void channel.unsubscribe() }
  }, [])

  const counts = useMemo(() => ({ all: conversations.length, unassigned: conversations.filter((item) => !item.assignedTo).length, open: conversations.filter((item) => item.status === 'open').length, pending: conversations.filter((item) => item.status === 'pending').length, closed: conversations.filter((item) => item.status === 'closed').length }), [conversations])
  const visible = useMemo(() => conversations.filter((item) => { const matchesFilter = filter === 'all' || (filter === 'unassigned' ? !item.assignedTo : item.status === filter); return matchesFilter && `${item.name} ${item.phone} ${item.preview}`.toLowerCase().includes(query.toLowerCase()) }), [conversations, filter, query])
  const updateConversation = async (patch: Record<string, string | null>) => { if (!selected) return; const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, patch }) }); if (!response.ok) throw new Error('Conversation update failed'); await load() }
  const startContactEdit = () => { if (!selected) return; setContactNameDraft(selected.name); setContactTypeDraft(selected.type.toLowerCase() as 'customer' | 'supplier'); setEditingContact(true) }
  const saveContact = async () => { if (!selected || !contactNameDraft.trim()) return; setContactSaveBusy(true); try { const response = await fetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, contactPatch: { display_name: contactNameDraft, contact_type: contactTypeDraft } }) }); if (!response.ok) throw new Error('Contact update failed'); setEditingContact(false); await load() } finally { setContactSaveBusy(false) } }
  const uploadAttachment = async (file: File) => { const form = new FormData(); form.append('file', file); const response = await fetch('/api/media', { method: 'POST', body: form }); if (!response.ok) throw new Error('Media upload failed'); return response.json() }
  const sendMessage = async () => { if (!selected || (!draft.trim() && !attachment)) return; try { let media: any = null; if (attachment) media = await uploadAttachment(attachment); const response = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, to: selected.phone, text: draft.trim() || attachment?.name || 'Attachment', attachmentUrl: media?.url, attachmentName: media?.name, attachmentType: media?.type }) }); if (!response.ok) throw new Error('Send failed'); setDraft(''); setAttachment(null); await load() } catch (error) { console.error('[v0] send failed', error) } }
  const addNote = async () => { if (!selected || !noteDraft.trim()) return; const response = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, body: noteDraft, agentId: sessionUser?.agentId }) }); if (!response.ok) throw new Error('Note could not be saved'); setNoteDraft(''); await load() }
  const createConversation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNewConversationBusy(true)
    setNewConversationError('')
    try {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newConversationName, phone: newConversationPhone, message: newConversationMessage, template: newConversationTemplate.trim() ? { name: newConversationTemplate.trim() } : undefined }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Conversation could not be created.')
      await load()
      setSelectedId(payload.conversationId)
      setNewConversationOpen(false)
      setNewConversationName('')
      setNewConversationPhone('')
      setNewConversationMessage('')
      setNewConversationTemplate('')
    } catch (error) {
      setNewConversationError(error instanceof Error ? error.message : 'Conversation could not be created.')
    } finally {
      setNewConversationBusy(false)
    }
  }

  const signIn = async () => {
    setAuthBusy(true)
    setAuthError('')
    const supabase = createBrowserSupabaseClient()
    if (!supabase) {
      setAuthError('Supabase authentication is not configured in this preview.')
      setAuthBusy(false)
      return
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
    if (error || !data.user) setAuthError(error?.message || 'Invalid email or password.')
    else {
      const agent = agents.find((item) => item.email?.toLowerCase() === data.user.email?.toLowerCase())
      setSessionUser({ email: data.user.email, agentId: agent?.id, role: data.user.app_metadata?.role || (agent ? 'agent' : 'admin') })
    }
    setAuthBusy(false)
  }

  if (!sessionUser) return <main className="login-shell"><section className="login-card"><img className="login-wordmark" src="/brand/myticket-wordmark.png" alt="Myticket" /><div className="login-copy"><p className="eyebrow">WHATSAPP SHARED INBOX</p><h1>Welcome back</h1><p>Sign in with your inbox agent account.</p></div><form className="login-form" onSubmit={(event) => { event.preventDefault(); void signIn() }}><label htmlFor="login-email">Email</label><input id="login-email" aria-label="Email" type="email" placeholder="you@example.com" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required /><label htmlFor="login-password">Password</label><input id="login-password" aria-label="Password" type="password" placeholder="Enter your password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required /><button className="send-btn" type="submit" disabled={authBusy}>{authBusy ? 'Signing in…' : 'Sign in'}</button></form>{authError && <p className="login-error" role="alert">{authError}</p>}<p className="login-footnote">Separate workspace for your WhatsApp support team.</p></section></main>

  return <main className="app-shell">
    <aside className={`rail ${sidebarOpen ? 'rail-open' : ''}`}><div className="brand-mark"><img src="/brand/myticket-icon.png" alt="Myticket" /></div><nav aria-label="Primary navigation" className="rail-nav"><button className={`rail-item ${activeNav === 'inbox' ? 'active' : ''}`} aria-label="Inbox" onClick={() => setActiveNav('inbox')}><Inbox size={20} /><span>Inbox</span><b>{conversations.length}</b></button><button className={`rail-item ${activeNav === 'team' ? 'active' : ''}`} aria-label="Team" onClick={() => setActiveNav('team')}><Users size={20} /><span>Team</span></button><button className={`rail-item ${activeNav === 'replies' ? 'active' : ''}`} aria-label="Saved replies" onClick={() => setActiveNav('replies')}><FileText size={20} /><span>Replies</span></button><button className={`rail-item ${activeNav === 'tags' ? 'active' : ''}`} aria-label="Tags" onClick={() => setActiveNav('tags')}><Tag size={20} /><span>Tags</span></button></nav><div className="rail-bottom"><button className="rail-item" aria-label="Help"><CircleHelp size={20} /></button><button className="rail-item" aria-label="Settings"><Settings size={20} /></button><div className="mini-avatar">{agents[0]?.display_name?.slice(0, 2).toUpperCase() || 'AG'}</div></div></aside>
    <section className="inbox-pane"><header className="pane-header"><div><img className="pane-wordmark" src="/brand/myticket-wordmark.png" alt="Myticket" /><h1>Shared Inbox</h1></div><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button><button className="icon-btn" aria-label="Notifications"><Bell size={18} /><i /></button></header><div className="inbox-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><button className="new-conversation-btn" onClick={() => { setNewConversationOpen(true); setNewConversationError('') }}><span>+</span> New conversation</button></div><div className="filter-tabs" role="tablist"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All <span>{counts.all}</span></button><button className={filter === 'unassigned' ? 'selected' : ''} onClick={() => setFilter('unassigned')}>Unassigned <span>{counts.unassigned}</span></button><button className={filter === 'open' ? 'selected' : ''} onClick={() => setFilter('open')}>Open <span>{counts.open}</span></button><button className={filter === 'pending' ? 'selected' : ''} onClick={() => setFilter('pending')}>Pending <span>{counts.pending}</span></button><button className={filter === 'closed' ? 'selected' : ''} onClick={() => setFilter('closed')}>Closed <span>{counts.closed}</span></button></div><div className="conversation-list">{isLoading ? <div className="empty-list">Loading conversations…</div> : visible.length === 0 ? <div className="empty-list">No conversations yet.</div> : visible.map((item) => <button key={item.id} className={`conversation ${selected?.id === item.id ? 'conversation-selected' : ''}`} onClick={() => setSelectedId(item.id)}><div className="avatar" style={{ backgroundColor: item.color }}>{item.initials}</div><div className="conversation-copy"><div className="conversation-top"><strong>{item.name}</strong><time>{item.time}</time></div><p>{item.preview}</p><div className="conversation-bottom"><span className={`status-dot ${item.status}`} /><span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span>{item.agentName && <span className="assigned-label">{item.agentName}</span>}</div></div></button>)}{!isLoading && visible.length === 0 && <div className="empty-list">No conversations yet</div>}</div></section>
    <section className="chat-pane">{selected ? <><header className="chat-header"><div className="chat-person"><div className="avatar large" style={{ backgroundColor: selected.color }}>{selected.initials}</div><div><h2>{selected.name}</h2><p><span className="online-dot" /> WhatsApp</p></div></div><div className="chat-actions"><span className="meta-badge">Meta Cloud API</span><button className="status-select" onClick={() => void updateConversation({ status: selected.status === 'open' ? 'closed' : 'open' })}><span className={`status-dot ${selected.status}`} />{selected.status} <ChevronDown size={14} /></button><button className="icon-btn" aria-label="More options"><MoreHorizontal size={19} /></button></div></header><div className="thread"><div className="day-divider"><span>Conversation</span></div>{selected.messages.map((message) => <div key={message.id} className={`message-row ${message.from === 'agent' ? 'message-agent' : ''}`}><div className="message-bubble">{message.attachmentUrl && <a href={message.attachmentUrl} target="_blank" rel="noreferrer">{message.attachmentName || 'Open attachment'}</a>}{message.text}<small>{message.time}{message.from === 'agent' && <><Check size={13} />{message.status}</>}</small></div></div>)}</div><div className="composer-wrap"><div className="composer">{attachment && <div className="attachment-chip"><Paperclip size={14} /><span>{attachment.name}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={13} /></button></div>}<textarea aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void sendMessage() } }} placeholder="Write a reply..." rows={1} /><div className="composer-tools"><div><input ref={attachmentInput} type="file" hidden accept="image/*,.pdf,.doc,.docx" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><button type="button" aria-label="Attach file" onClick={() => attachmentInput.current?.click()}><Paperclip size={18} /></button><button type="button" aria-label="Add emoji"><Smile size={18} /></button></div><button className="send-btn" onClick={() => void sendMessage()} aria-label="Send message"><Send size={17} /></button></div></div><p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p></div></> : <div className="empty-chat"><Inbox size={28} /><h2>Select a conversation</h2><p>Incoming WhatsApp conversations will appear here.</p></div>}</section>
    <aside className="details-pane">{selected ? <><div className="details-title"><p className="eyebrow">CONTACT DETAILS</p><button className="icon-btn" aria-label="Close details"><X size={17} /></button></div><div className="profile"><div className="avatar profile-avatar" style={{ backgroundColor: selected.color }}>{selected.initials}</div><h2>{selected.name}</h2><span className={`type-badge large-badge ${selected.type.toLowerCase()}`}>{selected.type}</span></div><div className="detail-section"><div className="section-heading"><h3>Contact</h3><button onClick={startContactEdit}>Edit</button></div><dl><dt>Phone</dt><dd>{selected.phone}</dd><dt>Channel</dt><dd>WhatsApp</dd></dl></div><div className="detail-section"><div className="section-heading"><h3>Conversation</h3><button><MoreHorizontal size={16} /></button></div><label className="field-label" htmlFor="assignee">Assigned to</label><select id="assignee" value={selected.assignedTo || ''} onChange={(event) => void updateConversation({ assigned_agent_id: event.target.value || null })}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.display_name}</option>)}</select><label className="field-label" htmlFor="status">Status</label><select id="status" value={selected.status} onChange={(event) => void updateConversation({ status: event.target.value })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div><div className="detail-section notes"><div className="section-heading"><h3>Internal notes</h3><button onClick={() => void addNote()}>Add note</button></div><textarea aria-label="Internal note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Keep private context for the support team here." rows={3} />{selected.notes.map((note) => <p key={note.id} className="note-item"><strong>{note.agentName}</strong> · {note.time}<br />{note.body}</p>)}</div><div className="detail-row"><Archive size={16} /><span>Independent WhatsApp inbox</span></div></> : <div className="empty-details">No contact selected</div>}</aside>
    {editingContact && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingContact(false) }}><section className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title"><div className="modal-header"><div><p className="eyebrow">CONTACT DETAILS</p><h2 id="edit-contact-title">Edit contact</h2></div><button className="icon-btn" onClick={() => setEditingContact(false)} aria-label="Close edit contact"><X size={18} /></button></div><div className="conversation-form"><label htmlFor="edit-contact-name">Contact name</label><input id="edit-contact-name" value={contactNameDraft} onChange={(event) => setContactNameDraft(event.target.value)} required /><label htmlFor="edit-contact-type">Type</label><select id="edit-contact-type" value={contactTypeDraft} onChange={(event) => setContactTypeDraft(event.target.value as 'customer' | 'supplier')}><option value="customer">Customer</option><option value="supplier">Supplier</option></select><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setEditingContact(false)}>Cancel</button><button className="send-btn" type="button" disabled={contactSaveBusy} onClick={() => void saveContact()}>{contactSaveBusy ? 'Saving…' : 'Save contact'}</button></div></div></section></div>}
    {newConversationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewConversationOpen(false) }}><section className="conversation-modal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title"><div className="modal-header"><div><p className="eyebrow">WHATSAPP</p><h2 id="new-conversation-title">New conversation</h2></div><button className="icon-btn" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation"><X size={18} /></button></div><form className="conversation-form" onSubmit={(event) => void createConversation(event)}><label htmlFor="new-contact-name">Contact name</label><input id="new-contact-name" value={newConversationName} onChange={(event) => setNewConversationName(event.target.value)} placeholder="Contact name" required /><label htmlFor="new-contact-phone">WhatsApp number</label><input id="new-contact-phone" value={newConversationPhone} onChange={(event) => setNewConversationPhone(event.target.value)} placeholder="+968 9212 4555" inputMode="tel" required /><label htmlFor="new-first-message">First message</label><textarea id="new-first-message" value={newConversationMessage} onChange={(event) => setNewConversationMessage(event.target.value)} placeholder="Write the first message" rows={4} disabled={Boolean(newConversationTemplate)} required={!newConversationTemplate} /><label htmlFor="new-template">Approved template name <span>(optional)</span></label><input id="new-template" value={newConversationTemplate} onChange={(event) => setNewConversationTemplate(event.target.value)} placeholder="example_template_name" /><p className="form-help">Use a template when starting a conversation outside WhatsApp&apos;s 24-hour customer-service window. Template parameters can be added after the template is configured in Meta.</p>{newConversationError && <p className="login-error" role="alert">{newConversationError}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setNewConversationOpen(false)}>Cancel</button><button className="send-btn" type="submit" disabled={newConversationBusy}>{newConversationBusy ? 'Creating…' : 'Create and send'}</button></div></form></section></div>}
  </main>
}

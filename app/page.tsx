'use client'

import { useMemo, useRef, useState } from 'react'
import { Archive, Bell, Check, ChevronDown, CircleHelp, FileText, Inbox, Menu, MoreHorizontal, Paperclip, Search, Send, Settings, Smile, Tag, Users, X } from 'lucide-react'

type ContactType = 'Customer' | 'Supplier'
type Status = 'open' | 'pending' | 'closed'
type Conversation = { id: number; name: string; initials: string; color: string; type: ContactType; phone: string; preview: string; time: string; unread: number; status: Status; assignedTo: string | null; online?: boolean; messages: { from: 'customer' | 'agent'; text: string; time: string }[] }

const initialConversations: Conversation[] = [
  { id: 1, name: 'Ahmed Al Balushi', initials: 'AB', color: '#2759a5', type: 'Customer', phone: '+968 9212 4555', preview: 'I need help with my airport transfer.', time: '10:42 AM', unread: 2, status: 'open', assignedTo: 'Sarah Kim', online: true, messages: [{ from: 'customer', text: 'Hi, I need help with my airport transfer tomorrow.', time: '10:39 AM' }, { from: 'agent', text: 'Hello Ahmed, I’m checking this with our operations team now.', time: '10:41 AM' }, { from: 'customer', text: 'Thank you, I appreciate it.', time: '10:42 AM' }] },
  { id: 2, name: 'Salalah Tours', initials: 'ST', color: '#b77638', type: 'Supplier', phone: '+968 9944 1200', preview: 'The updated pickup list is ready.', time: '9:18 AM', unread: 0, status: 'open', assignedTo: 'Sarah Kim', messages: [{ from: 'customer', text: 'The updated pickup list is ready.', time: '9:18 AM' }] },
  { id: 3, name: 'Maha', initials: 'MA', color: '#7f65ae', type: 'Customer', phone: '+968 9777 3011', preview: 'Can I change the pickup time?', time: 'Yesterday', unread: 1, status: 'pending', assignedTo: null, messages: [{ from: 'customer', text: 'Can I change the pickup time?', time: 'Yesterday' }] },
  { id: 4, name: 'Desert Gate Oman', initials: 'DG', color: '#3f8b78', type: 'Supplier', phone: '+968 2456 7890', preview: 'The issue is fixed now, thanks.', time: 'Yesterday', unread: 0, status: 'closed', assignedTo: 'Sarah Kim', messages: [{ from: 'customer', text: 'The issue is fixed now, thanks.', time: 'Yesterday' }] },
]

export default function Page() {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState(1)
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'open'>('all')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<'inbox' | 'team' | 'replies' | 'tags'>('inbox')
  const [attachment, setAttachment] = useState<File | null>(null)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const selected = conversations.find((item) => item.id === selectedId) ?? conversations[0]
  const visible = useMemo(() => conversations.filter((item) => {
    const matches = filter === 'all' || (filter === 'unassigned' ? !item.assignedTo : item.status === 'open')
    return matches && `${item.name} ${item.preview}`.toLowerCase().includes(query.toLowerCase())
  }), [conversations, filter, query])

  function sendMessage() {
    if (!draft.trim()) return
    const message = { from: 'agent' as const, text: draft.trim(), time: 'Just now' }
    setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, preview: message.text, time: 'Just now', unread: 0, messages: [...item.messages, message] } : item))
    setDraft('')
  }

  function updateSelected(patch: Partial<Conversation>) {
    setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, ...patch } : item))
  }

  return <main className="app-shell">
    <aside className={`rail ${sidebarOpen ? 'rail-open' : ''}`}>
      <div className="brand-mark">M</div>
      <nav aria-label="Primary navigation" className="rail-nav"><button className={`rail-item ${activeNav === 'inbox' ? 'active' : ''}`} aria-label="Inbox" onClick={() => setActiveNav('inbox')}><Inbox size={20} /><span>Inbox</span><b>8</b></button><button className={`rail-item ${activeNav === 'team' ? 'active' : ''}`} aria-label="Team" onClick={() => setActiveNav('team')}><Users size={20} /><span>Team</span></button><button className={`rail-item ${activeNav === 'replies' ? 'active' : ''}`} aria-label="Saved replies" onClick={() => setActiveNav('replies')}><FileText size={20} /><span>Replies</span></button><button className={`rail-item ${activeNav === 'tags' ? 'active' : ''}`} aria-label="Tags" onClick={() => setActiveNav('tags')}><Tag size={20} /><span>Tags</span></button></nav>
      <div className="rail-bottom"><button className="rail-item" aria-label="Help"><CircleHelp size={20} /></button><button className="rail-item" aria-label="Settings"><Settings size={20} /></button><div className="mini-avatar">SK</div></div>
    </aside>
    <section className="inbox-pane">
      <header className="pane-header"><div><p className="eyebrow">MYTICKET</p><h1>Shared Inbox</h1></div><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button><button className="icon-btn" aria-label="Notifications"><Bell size={18} /><i /></button></header>
      <div className="inbox-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div></div>
      <div className="filter-tabs" role="tablist"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All <span>8</span></button><button className={filter === 'unassigned' ? 'selected' : ''} onClick={() => setFilter('unassigned')}>Unassigned <span>2</span></button><button className={filter === 'open' ? 'selected' : ''} onClick={() => setFilter('open')}>Open <span>5</span></button></div>
      <div className="conversation-list">{visible.map((item) => <button key={item.id} className={`conversation ${selected.id === item.id ? 'conversation-selected' : ''}`} onClick={() => setSelectedId(item.id)}><div className="avatar" style={{ backgroundColor: item.color }}>{item.initials}{item.online && <i />}</div><div className="conversation-copy"><div className="conversation-top"><strong>{item.name}</strong><time>{item.time}</time></div><p>{item.preview}</p><div className="conversation-bottom"><span className={`status-dot ${item.status}`} /><span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span>{item.assignedTo && <span className="assigned-label">{item.assignedTo}</span>}{item.unread > 0 && <b className="unread">{item.unread}</b>}</div></div></button>)}{visible.length === 0 && <div className="empty-list">No conversations found</div>}</div>
    </section>
    <section className="chat-pane">
      <header className="chat-header"><div className="chat-person"><div className="avatar large" style={{ backgroundColor: selected.color }}>{selected.initials}{selected.online && <i />}</div><div><h2>{selected.name}</h2><p><span className="online-dot" /> WhatsApp · {selected.online ? 'Online' : 'Last seen recently'}</p></div></div><div className="chat-actions"><span className="meta-badge">Meta Cloud API</span><button className="status-select" onClick={() => updateSelected({ status: selected.status === 'open' ? 'closed' : 'open' })}><span className={`status-dot ${selected.status}`} />{selected.status === 'open' ? 'Open' : selected.status === 'pending' ? 'Pending' : 'Closed'} <ChevronDown size={14} /></button><button className="icon-btn" aria-label="More options"><MoreHorizontal size={19} /></button></div></header>
      <div className="thread"><div className="day-divider"><span>Today</span></div>{selected.messages.map((message, index) => <div key={`${message.time}-${index}`} className={`message-row ${message.from === 'agent' ? 'message-agent' : ''}`}><div className="message-bubble">{message.text}<small>{message.time}{message.from === 'agent' && <Check size={13} />}</small></div></div>)}</div>
      <div className="composer-wrap"><div className="composer">{attachment && <div className="attachment-chip"><Paperclip size={14} /> <span>{attachment.name}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={13} /></button></div>}<textarea aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage() } }} placeholder="Write a reply..." rows={1} /><div className="composer-tools"><div><input ref={attachmentInput} type="file" hidden onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /><button type="button" aria-label="Attach file" onClick={() => attachmentInput.current?.click()}><Paperclip size={18} /></button><button type="button" aria-label="Add emoji"><Smile size={18} /></button></div><button className="send-btn" onClick={sendMessage} aria-label="Send message"><Send size={17} /></button></div></div><p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p></div>
    </section>
    <aside className="details-pane"><div className="details-title"><p className="eyebrow">CONTACT DETAILS</p><button className="icon-btn" aria-label="Close details"><X size={17} /></button></div><div className="profile"><div className="avatar profile-avatar" style={{ backgroundColor: selected.color }}>{selected.initials}</div><h2>{selected.name}</h2><span className={`type-badge large-badge ${selected.type.toLowerCase()}`}>{selected.type}</span></div><div className="detail-section"><div className="section-heading"><h3>Contact</h3><button>Edit</button></div><dl><dt>Phone</dt><dd>{selected.phone}</dd><dt>Channel</dt><dd>WhatsApp</dd></dl></div><div className="detail-section"><div className="section-heading"><h3>Conversation</h3><button><MoreHorizontal size={16} /></button></div><label className="field-label" htmlFor="assignee">Assigned to</label><select id="assignee" value={selected.assignedTo ?? ''} onChange={(event) => updateSelected({ assignedTo: event.target.value || null })}><option value="">Unassigned</option><option>Sarah Kim</option><option>Omar Al Harthy</option></select><label className="field-label" htmlFor="status">Status</label><select id="status" value={selected.status} onChange={(event) => updateSelected({ status: event.target.value as Status })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div><div className="detail-section notes"><div className="section-heading"><h3>Internal notes</h3><button>Add note</button></div><p>Keep private context for the support team here.</p></div><div className="detail-row"><Archive size={16} /><span>Independent WhatsApp inbox</span></div></aside>
  </main>
}

'use client'

import { useMemo, useState } from 'react'
import {
  Archive,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  Inbox,
  Menu,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Settings,
  Smile,
  Tag,
  Users,
  X,
} from 'lucide-react'

type Conversation = {
  id: number
  name: string
  initials: string
  color: string
  preview: string
  time: string
  unread: number
  status: 'open' | 'pending' | 'closed'
  assigned: boolean
  online?: boolean
  messages: { from: 'customer' | 'agent'; text: string; time: string }[]
}

const initialConversations: Conversation[] = [
  { id: 1, name: 'Maya Rodriguez', initials: 'MR', color: '#d5a05d', preview: 'Hi, I need help with my order...', time: '10:42 AM', unread: 2, status: 'open', assigned: true, online: true, messages: [{ from: 'customer', text: 'Hi! I need help with my order. It was supposed to arrive yesterday but I still haven’t received it.', time: '10:39 AM' }, { from: 'agent', text: 'Hi Maya, I’m happy to look into that for you. Could you share your order number?', time: '10:41 AM' }, { from: 'customer', text: 'Sure, it’s #48291. Thank you!', time: '10:42 AM' }] },
  { id: 2, name: 'Omar Hassan', initials: 'OH', color: '#729c93', preview: 'Thanks for getting back to me!', time: '9:18 AM', unread: 0, status: 'open', assigned: true, messages: [{ from: 'customer', text: 'Thanks for getting back to me!', time: '9:18 AM' }] },
  { id: 3, name: 'Sofia Chen', initials: 'SC', color: '#9a82b7', preview: 'Is the annual plan refundable?', time: 'Yesterday', unread: 1, status: 'pending', assigned: false, messages: [{ from: 'customer', text: 'Is the annual plan refundable?', time: 'Yesterday' }] },
  { id: 4, name: 'Lucas Bennett', initials: 'LB', color: '#6b91b8', preview: 'The issue is fixed now, thanks.', time: 'Yesterday', unread: 0, status: 'closed', assigned: true, messages: [{ from: 'customer', text: 'The issue is fixed now, thanks.', time: 'Yesterday' }] },
  { id: 5, name: 'Aisha Patel', initials: 'AP', color: '#bc7d7d', preview: 'Can I change my delivery address?', time: 'Mon', unread: 0, status: 'open', assigned: false, messages: [{ from: 'customer', text: 'Can I change my delivery address?', time: 'Mon' }] },
]

export default function Page() {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState(1)
  const [filter, setFilter] = useState<'all' | 'assigned' | 'pending'>('all')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0]

  const visibleConversations = useMemo(() => conversations.filter((conversation) => {
    const matchesFilter = filter === 'all' || (filter === 'assigned' ? conversation.assigned : conversation.status === 'pending')
    return matchesFilter && `${conversation.name} ${conversation.preview}`.toLowerCase().includes(query.toLowerCase())
  }), [conversations, filter, query])

  function sendMessage() {
    if (!draft.trim()) return
    const message = { from: 'agent' as const, text: draft.trim(), time: 'Just now' }
    setConversations((items) => items.map((conversation) => conversation.id === selected.id ? { ...conversation, preview: message.text, time: 'Just now', unread: 0, messages: [...conversation.messages, message] } : conversation))
    setDraft('')
  }

  function updateStatus(status: Conversation['status']) {
    setConversations((items) => items.map((conversation) => conversation.id === selected.id ? { ...conversation, status } : conversation))
  }

  return (
    <main className="app-shell">
      <aside className={`rail ${sidebarOpen ? 'rail-open' : ''}`}>
        <div className="brand-mark">W</div>
        <nav aria-label="Primary navigation" className="rail-nav">
          <button className="rail-item active" aria-label="Inbox"><Inbox size={20} /><span>Inbox</span><b>8</b></button>
          <button className="rail-item" aria-label="Contacts"><Users size={20} /><span>Contacts</span></button>
          <button className="rail-item" aria-label="Saved replies"><FileText size={20} /><span>Replies</span></button>
          <button className="rail-item" aria-label="Tags"><Tag size={20} /><span>Tags</span></button>
        </nav>
        <div className="rail-bottom"><button className="rail-item" aria-label="Help"><CircleHelp size={20} /></button><button className="rail-item" aria-label="Settings"><Settings size={20} /></button><div className="mini-avatar">SK</div></div>
      </aside>
      <section className="inbox-pane">
        <header className="pane-header"><div><p className="eyebrow">WORKSPACE</p><h1>Shared Inbox</h1></div><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button><button className="icon-btn" aria-label="Notifications"><Bell size={18} /><i /></button></header>
        <div className="inbox-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><button className="new-btn">+ New conversation</button></div>
        <div className="filter-tabs" role="tablist"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All <span>8</span></button><button className={filter === 'assigned' ? 'selected' : ''} onClick={() => setFilter('assigned')}>Assigned <span>4</span></button><button className={filter === 'pending' ? 'selected' : ''} onClick={() => setFilter('pending')}>Pending <span>2</span></button></div>
        <div className="conversation-list">{visibleConversations.map((conversation) => <button key={conversation.id} className={`conversation ${selected.id === conversation.id ? 'conversation-selected' : ''}`} onClick={() => setSelectedId(conversation.id)}><div className="avatar" style={{ backgroundColor: conversation.color }}>{conversation.initials}{conversation.online && <i />}</div><div className="conversation-copy"><div className="conversation-top"><strong>{conversation.name}</strong><time>{conversation.time}</time></div><p>{conversation.preview}</p><div className="conversation-bottom"><span className={`status-dot ${conversation.status}`} />{conversation.assigned && <span className="assigned-label">Assigned to you</span>}{conversation.unread > 0 && <b className="unread">{conversation.unread}</b>}</div></div></button>)}{visibleConversations.length === 0 && <div className="empty-list">No conversations found</div>}</div>
      </section>
      <section className="chat-pane">
        <header className="chat-header"><div className="chat-person"><div className="avatar large" style={{ backgroundColor: selected.color }}>{selected.initials}{selected.online && <i />}</div><div><h2>{selected.name}</h2><p><span className="online-dot" /> WhatsApp · {selected.online ? 'Online' : 'Last seen recently'}</p></div></div><div className="chat-actions"><button className="status-select" onClick={() => updateStatus(selected.status === 'open' ? 'closed' : 'open')}><span className={`status-dot ${selected.status}`} />{selected.status === 'open' ? 'Open' : selected.status === 'pending' ? 'Pending' : 'Closed'} <ChevronDown size={14} /></button><button className="icon-btn" aria-label="More options"><MoreHorizontal size={19} /></button></div></header>
        <div className="thread"> <div className="day-divider"><span>Today</span></div>{selected.messages.map((message, index) => <div key={`${message.time}-${index}`} className={`message-row ${message.from === 'agent' ? 'message-agent' : ''}`}><div className="message-bubble">{message.text}<small>{message.time}{message.from === 'agent' && <Check size={13} />}</small></div></div>)} </div>
        <div className="composer-wrap"><div className="composer"><textarea aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage() } }} placeholder="Write a reply..." rows={1} /><div className="composer-tools"><div><button aria-label="Attach file"><Paperclip size={18} /></button><button aria-label="Add emoji"><Smile size={18} /></button></div><button className="send-btn" onClick={sendMessage} aria-label="Send message"><Send size={17} /></button></div></div><p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p></div>
      </section>
      <aside className="details-pane"><div className="details-title"><p className="eyebrow">CUSTOMER</p><button className="icon-btn" aria-label="Close details"><X size={17} /></button></div><div className="profile"><div className="avatar profile-avatar" style={{ backgroundColor: selected.color }}>{selected.initials}</div><h2>{selected.name}</h2><p>Customer since Mar 2024</p></div><div className="detail-section"><div className="section-heading"><h3>Contact details</h3><button>Edit</button></div><dl><dt>Phone</dt><dd>+1 (415) 555-0198</dd><dt>Email</dt><dd>maya.rodriguez@email.com</dd></dl></div><div className="detail-section"><div className="section-heading"><h3>Conversation</h3><button><MoreHorizontal size={16} /></button></div><div className="detail-row"><Clock3 size={16} /><span>Created today</span></div><div className="detail-row"><Archive size={16} /><span>Order #48291</span></div></div><div className="detail-section"><div className="section-heading"><h3>Assignee</h3><button>Edit</button></div><div className="assignee"><div className="mini-avatar">SK</div><span>Sarah Kim</span><ChevronDown size={14} /></div></div></aside>
    </main>
  )
}

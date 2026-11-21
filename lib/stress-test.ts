// Load test that never touches real data. Open the inbox with ?stress (e.g. /?stress=1000) while signed in:
// the inbox list and chat history are replaced by made-up chats served from this page, every change
// (send, mark read, assign, delete…) is answered locally and never reaches the server, and a panel measures
// how the app copes with many chats, a 3,000-message chat, bursts of new messages, search and scrolling.
// Remove ?stress (or press Exit) to go back to normal. Nothing is stored: the device cache is cleared on exit.

type Row = Record<string, any>

const BIG_ID = '00000000-0000-4000-8000-00000000b16b'
const AR = ['السلام عليكم', 'كم سعر التذكرة؟', 'ما وصلتني التذكرة', 'متى تبدأ الفعالية؟', 'ابي احجز لشخصين', 'شكرا لكم', 'وين الموقع؟', 'تم الدفع ولكن ما وصل شي']
const EN = ['Hi there', 'How much is a ticket?', 'I did not get my ticket', 'What time does it start?', 'Can I book for 4 people?', 'Thanks!', 'Where is the location?', 'Payment went through but nothing arrived']

function uuid(n: number) { return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` }

function makeMessages(chat: number, count: number, now: number): Row[] {
  const out: Row[] = []
  for (let i = 0; i < count; i++) {
    const inbound = i % 3 !== 2
    const at = new Date(now - (count - i) * 60_000 - chat * 7_000).toISOString()
    const pool = chat % 2 ? AR : EN
    out.push({ id: `${uuid(chat)}-${i}`, external_id: `wamid.stress.${chat}.${i}`, reply_to_external_id: null, direction: inbound ? 'inbound' : 'outbound', sender_name: inbound ? null : 'Test agent', body: `${pool[(chat + i) % pool.length]} (#${i + 1})`, attachment_url: null, attachment_name: null, status: inbound ? null : 'read', failure_reason: null, sent_at: at, created_at: at })
  }
  return out
}

function createFakeDb(chats: number) {
  const now = Date.now()
  const rows: Row[] = []
  for (let c = 1; c <= chats; c++) {
    const id = c === 1 ? BIG_ID : uuid(c)
    const messages = makeMessages(c, c === 1 ? 3000 : 40, now)
    rows.push({ id, status: 'open', assigned_agent_id: null, last_message_at: messages.at(-1)!.created_at, unread_count: c % 4 === 0 ? 2 : 0,
      whatsapp_contacts: { id: `contact-${c}`, display_name: c === 1 ? 'TEST · 3,000 messages' : `Test customer ${c}`, phone: `+96890${String(c).padStart(6, '0')}`, contact_type: 'customer', avatar_url: null },
      whatsapp_agents: null, whatsapp_messages: messages, whatsapp_internal_notes: [], whatsapp_conversation_tags: [] })
  }
  return rows
}

function install() {
  const params = new URLSearchParams(location.search)
  const chats = Math.min(5000, Math.max(10, Number(params.get('stress')) || 1000))
  const db = createFakeDb(chats)
  const realFetch = window.fetch.bind(window)
  ;(window as any).__inboxStress = true
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  const listRows = () => [...db].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)).map((row) => ({ ...row, whatsapp_messages: row.whatsapp_messages.slice(-40).reverse() }))
  let lastList = 0

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      if (method !== 'GET') return json({ ok: true, stress: true, message: { id: `stress-${Date.now()}` } }) // nothing leaves the device
      if (url.pathname === '/api/inbox' && !url.searchParams.has('agents')) {
        const id = url.searchParams.get('conversation')
        if (id) { const row = db.find((item) => item.id === id); return json({ conversation: row ?? null }) }
        lastList = performance.now()
        return json({ conversations: listRows(), agents: [] })
      }
    }
    return realFetch(input as any, init)
  }

  // Frame monitor: any gap over 50 ms is a moment the screen froze.
  let frames: number[] = []
  let recording = false
  const tick = (t: number) => { if (recording) frames.push(t); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const measure = async (run: () => Promise<void> | void) => {
    frames = []; recording = true
    const start = performance.now()
    await run()
    await new Promise((resolve) => setTimeout(resolve, 300))
    recording = false
    const gaps = frames.slice(1).map((t, i) => t - frames[i])
    const worst = gaps.length ? Math.max(...gaps) : 0
    const frozen = gaps.filter((g) => g > 50).reduce((sum, g) => sum + g, 0)
    return { ms: Math.round(performance.now() - start - 300), worst: Math.round(worst), frozen: Math.round(frozen) }
  }
  const waitFor = (check: () => boolean, timeout = 15000) => new Promise<boolean>((resolve) => {
    const started = performance.now()
    const poll = () => { if (check()) resolve(true); else if (performance.now() - started > timeout) resolve(false); else requestAnimationFrame(poll) }
    poll()
  })
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))))

  const panel = document.createElement('div')
  panel.className = 'stress-panel'
  panel.innerHTML = `<strong>TEST MODE · made-up data · nothing is sent</strong><p>${chats.toLocaleString()} chats, one with 3,000 messages.</p><div class="stress-buttons"><button data-run="all">Run all tests</button><button data-exit>Exit test mode</button></div><ol class="stress-results"></ol>`
  const results = () => panel.querySelector('.stress-results') as HTMLOListElement
  const report = (name: string, r: { ms: number; worst: number; frozen: number }, ok?: boolean) => {
    const verdict = ok === false ? '❌' : r.worst > 400 ? '🔴' : r.worst > 150 ? '🟠' : '🟢'
    const li = document.createElement('li')
    li.textContent = `${verdict} ${name}: ${r.ms} ms · longest freeze ${r.worst} ms`
    results().appendChild(li)
  }
  const tests: Array<[string, () => Promise<boolean | void>]> = [
    ['Reload the chat list', async () => { const before = lastList; document.dispatchEvent(new Event('visibilitychange')); await waitFor(() => lastList !== before); await settle() }],
    ['Open the 3,000-message chat', async () => {
      const row = document.querySelector<HTMLElement>(`.conversation[data-conversation-id="${BIG_ID}"]`)
      if (!row) return false
      row.click()
      const ok = await waitFor(() => (document.querySelectorAll('.thread .message-row').length > 1000))
      await settle(); return ok
    }],
    ['Scroll the open chat to the top and back', async () => {
      const thread = document.querySelector<HTMLElement>('.thread'); if (!thread) return false
      for (let i = 0; i <= 20; i++) { thread.scrollTop = thread.scrollHeight * (1 - i / 20); await new Promise((r) => requestAnimationFrame(r)) }
      for (let i = 0; i <= 20; i++) { thread.scrollTop = thread.scrollHeight * (i / 20); await new Promise((r) => requestAnimationFrame(r)) }
    }],
    ['50 new messages arrive at once', async () => {
      const now = Date.now()
      for (let i = 0; i < 50; i++) { const row = db[Math.floor(Math.random() * db.length)]; const at = new Date(now + i).toISOString(); row.whatsapp_messages.push({ ...makeMessages(1, 1, now)[0], id: `burst-${now}-${i}`, external_id: `wamid.burst.${now}.${i}`, created_at: at, sent_at: at, body: `New message ${i + 1}` }); row.last_message_at = at; row.unread_count += 1 }
      const before = lastList; document.dispatchEvent(new Event('visibilitychange')); await waitFor(() => lastList !== before); await settle()
    }],
    ['Search all chats for "تذكرة"', async () => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search conversations"]'); if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'تذكرة'); input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
      setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
    }],
    ['Scroll the chat list', async () => {
      const list = document.querySelector<HTMLElement>('.conversation-list'); if (!list) return false
      for (let i = 0; i <= 30; i++) { list.scrollTop = list.scrollHeight * (i / 30); await new Promise((r) => requestAnimationFrame(r)) }
      list.scrollTop = 0
    }],
  ]
  panel.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    if (target.hasAttribute('data-exit')) {
      try { localStorage.removeItem('inbox-cache-v1') } catch {}
      location.href = location.pathname
      return
    }
    if (target.dataset.run !== 'all') return
    target.setAttribute('disabled', '')
    results().innerHTML = ''
    for (const [name, run] of tests) { let ok: boolean | void = undefined; const r = await measure(async () => { ok = await run() }); report(name, r, ok as boolean | undefined) }
    const li = document.createElement('li'); li.textContent = '🟢 under 150 ms feels smooth · 🟠 noticeable · 🔴 freezes'; results().appendChild(li)
    target.removeAttribute('disabled')
  })
  const mount = () => document.body.appendChild(panel)
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
}

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stress')) install()

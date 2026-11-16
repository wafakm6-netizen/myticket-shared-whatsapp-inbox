'use client'
import { useEffect, useRef, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

// Invitation page: the admin shares a link (no email is sent). The agent sets a password and is signed in.
export default function AcceptInvite() {
  const started = useRef(false)
  const [invite, setInvite] = useState<string | null>(null)
  const [who, setWho] = useState<{ name: string; email: string } | null>(null)
  const [legacyReady, setLegacyReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const query = new URLSearchParams(window.location.search)
    const code = query.get('invite')
    if (code) {
      setInvite(code)
      fetch(`/api/team/invite?invite=${encodeURIComponent(code)}`, { cache: 'no-store' })
        .then(async (response) => { const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'This invitation link is not valid.'); setWho({ name: result.name || '', email: result.email || '' }) })
        .catch((reason) => setError(reason instanceof Error ? reason.message : 'This invitation link is not valid.'))
        .finally(() => setLoading(false))
      return
    }
    // Older links made by Supabase's own invite system.
    const supabase = createBrowserSupabaseClient()
    if (!supabase) { setError('Authentication is not configured. Contact your administrator.'); setLoading(false); return }
    void (async () => {
      const tokenHash = query.get('token_hash')
      if (tokenHash) { const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' }); if (!verifyError) window.history.replaceState(null, '', window.location.pathname) }
      const { data } = await supabase.auth.getUser()
      setLegacyReady(Boolean(data.user))
      if (!data.user) setError('This invitation link is invalid or has already been used. Ask your administrator for a new link.')
      setLoading(false)
    })()
  }, [])

  const valid = password.length >= 12 && password === confirm
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    setBusy(true); setError('')
    const supabase = createBrowserSupabaseClient()
    if (!supabase) { setError('Authentication is not configured.'); setBusy(false); return }
    if (invite) {
      const response = await fetch('/api/team/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite, password }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setError(result.error || 'Your account could not be activated.'); setBusy(false); return }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: result.email, password })
      if (signInError) { window.location.assign('/'); return }
    } else {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError(updateError.message); setBusy(false); return }
    }
    window.location.assign('/')
  }

  const ready = invite ? !!who : legacyReady
  return <main className="invite-shell">
    <form className="invite-card" onSubmit={submit}>
      <img className="invite-mark" src="/brand/myticket-mark.png" alt="Myticket" />
      <h1>{who?.name ? `Welcome, ${who.name.split(' ')[0]}` : 'Welcome to Myticket'}</h1>
      <p className="invite-sub">Create a password to activate your Shared Inbox account.</p>
      {loading && <p className="invite-note">Checking your invitation…</p>}
      {who?.email && <div className="invite-email"><span>You'll sign in with</span><strong>{who.email}</strong></div>}
      {error && <p className="invite-error" role="alert">{error}</p>}
      {ready && <>
        <label>New password<div className="invite-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /><button type="button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div></label>
        <label>Confirm password<div className="invite-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Type it again" /></div></label>
        {password.length > 0 && password.length < 12 && <small className="invite-hint">{12 - password.length} more character{12 - password.length === 1 ? '' : 's'} needed.</small>}
        {confirm && password !== confirm && <small className="invite-hint invite-hint-error">Passwords do not match.</small>}
        <button type="submit" className="invite-submit" disabled={!valid || busy}>{busy ? 'Activating…' : 'Activate account'}</button>
      </>}
    </form>
  </main>
}

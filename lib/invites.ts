import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Team invitations: a random token is shown once in the invitation link; only its hash is kept on the
// member's auth account (app_metadata), so the link works until it is used or expires, and no email is sent.
export const INVITE_DAYS = 7

export function newInviteToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString() }
}

export function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function inviteTokenMatches(token: string, storedHash: unknown) {
  if (typeof storedHash !== 'string' || storedHash.length !== 64) return false
  const given = Buffer.from(hashInviteToken(token), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  return given.length === stored.length && timingSafeEqual(given, stored)
}

// Link format: /auth/accept-invite?invite=<agent id>.<token>
export function parseInvite(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(value.trim())
  return match ? { agentId: match[1], token: match[2] } : null
}

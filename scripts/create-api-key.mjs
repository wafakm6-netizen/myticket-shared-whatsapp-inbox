// Create an Inbox API key. Usage: node scripts/create-api-key.mjs <client-name> <agent-id> <scope> [scope...]
// Prints the key once (give it to the client) and the JSON entry to add to INBOX_API_KEYS in Vercel.
// Scopes: conversations:read conversations:write messages:send notes:write agents:read
import { createHash, randomBytes } from 'node:crypto'
const [name, agentId, ...scopes] = process.argv.slice(2)
const allowed = ['conversations:read', 'conversations:write', 'messages:send', 'notes:write', 'agents:read']
if (!name || !/^[0-9a-f-]{36}$/i.test(agentId || '') || !scopes.length || scopes.some((s) => !allowed.includes(s))) {
  console.error('Usage: node scripts/create-api-key.mjs <client-name> <agent-id> <scope> [scope...]\nScopes: ' + allowed.join(' '))
  process.exit(1)
}
const key = 'mti_' + randomBytes(32).toString('base64url')
console.log('\nAPI key (shown once, give it to ' + name + '):\n  ' + key)
console.log('\nAdd this object to the INBOX_API_KEYS array in Vercel:\n  ' + JSON.stringify({ name, keyHash: createHash('sha256').update(key).digest('hex'), agentId, scopes }) + '\n')

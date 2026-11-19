import { connect } from 'node:http2'
import { createPrivateKey, sign } from 'node:crypto'

// Native push for the Myticket Inbox iOS app. Device tokens are stored in whatsapp_push_subscriptions
// with endpoint "apns:<token>" so the existing delivery code reaches iOS without schema changes.
// Needs APNS_KEY_P8 (the .p8 text), APNS_KEY_ID and APNS_TEAM_ID; APNS_BUNDLE_ID defaults to the app's ID.
export const APNS_PREFIX = 'apns:'
const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url')

let cachedToken: { value: string; at: number } | null = null
function providerToken(keyId: string, teamId: string, pem: string) {
  // Apple accepts a token for up to an hour and rejects refreshing more than every 20 minutes.
  if (cachedToken && Date.now() - cachedToken.at < 40 * 60 * 1000) return cachedToken.value
  const body = pem.includes('BEGIN') ? pem : `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`
  const input = b64(JSON.stringify({ alg: 'ES256', kid: keyId })) + '.' + b64(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))
  const signature = sign('sha256', Buffer.from(input), { key: createPrivateKey(body.replace(/\\n/g, '\n')), dsaEncoding: 'ieee-p1363' })
  cachedToken = { value: input + '.' + b64(signature), at: Date.now() }
  return cachedToken.value
}

type Payload = { title?: string; body?: string; tag?: string; url?: string }
export async function sendApnsPush(endpoint: string, payload: Payload): Promise<boolean | 'expired'> {
  const pem = process.env.APNS_KEY_P8, keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID
  if (!pem || !keyId || !teamId) return false
  const deviceToken = endpoint.slice(APNS_PREFIX.length)
  if (!/^[0-9a-f]{32,200}$/i.test(deviceToken)) return 'expired'
  const host = process.env.APNS_HOST || 'https://api.push.apple.com' // TestFlight and App Store builds use production APNs
  const message = JSON.stringify({
    aps: { alert: { title: payload.title || 'Myticket Inbox', body: payload.body || '' }, sound: 'default', 'thread-id': payload.tag || 'myticket', 'mutable-content': 1 },
    url: payload.url,
  })
  return await new Promise((resolve, reject) => {
    const client = connect(host)
    client.on('error', (error) => { client.close(); reject(error) })
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken(keyId, teamId, pem)}`,
      'apns-topic': process.env.APNS_BUNDLE_ID || 'com.myticketom.inbox',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(payload.tag ? { 'apns-collapse-id': payload.tag.slice(0, 64) } : {}),
      'content-type': 'application/json',
    })
    let status = 0, data = ''
    request.setTimeout(9000, () => { request.close(); client.close(); reject(new Error('APNs timeout')) })
    request.on('response', (headers) => { status = Number(headers[':status']) })
    request.on('data', (chunk) => { data += chunk })
    request.on('end', () => {
      client.close()
      if (status === 200) return resolve(true)
      const reason = (() => { try { return JSON.parse(data).reason } catch { return '' } })()
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return resolve('expired')
      reject(new Error(`APNs returned ${status} ${reason}`))
    })
    request.end(message)
  })
}

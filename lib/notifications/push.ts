import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, sign, randomBytes } from 'node:crypto'

const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url')
const from64 = (value: string) => Buffer.from(value, 'base64url')
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number) {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  let previous = Buffer.alloc(0), output = Buffer.alloc(0), counter = 1
  while (output.length < length) {
    previous = createHmac('sha256', prk).update(Buffer.concat([previous, info, Buffer.from([counter++])])).digest()
    output = Buffer.concat([output, previous])
  }
  return output.subarray(0, length)
}
export type PushSubscriptionRecord = { endpoint: string; p256dh: string; auth: string }
export async function sendBrowserPush(subscription: PushSubscriptionRecord, payload: object) {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY
  const subject = process.env.WEB_PUSH_SUBJECT
  if (!publicKey || !privateKey || !subject) return false
  const url = new URL(subscription.endpoint)
  if (url.protocol !== 'https:' || !['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','*.push.apple.com'].some(host => host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) : url.hostname === host)) throw new Error('Unsupported push endpoint')
  const receiverPublic = from64(subscription.p256dh), authSecret = from64(subscription.auth)
  const local = createECDH('prime256v1'); local.generateKeys()
  const senderPublic = local.getPublicKey(undefined,'uncompressed')
  const shared = local.computeSecret(receiverPublic)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'),receiverPublic,senderPublic])
  const ikm = hkdf(authSecret,shared,info,32)
  const salt = randomBytes(16)
  const key = hkdf(salt,ikm,Buffer.from('Content-Encoding: aes128gcm\0'),16)
  const nonce = hkdf(salt,ikm,Buffer.from('Content-Encoding: nonce\0'),12)
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload)),Buffer.from([2])])
  const cipher = createCipheriv('aes-128-gcm',key,nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header,0);header.writeUInt32BE(4096,16);header[20]=senderPublic.length
  const body = Buffer.concat([header,senderPublic,encrypted])
  const aud = url.origin
  const jwtHeader = b64(JSON.stringify({typ:'JWT',alg:'ES256'}))
  const jwtPayload = b64(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+3600,sub:subject}))
  const signingInput = jwtHeader+'.'+jwtPayload
  const d = from64(privateKey), pub = from64(publicKey)
  const keyObject = createPrivateKey({key:{kty:'EC',crv:'P-256',d:b64(d),x:b64(pub.subarray(1,33)),y:b64(pub.subarray(33,65))},format:'jwk'})
  const signature = sign('sha256',Buffer.from(signingInput),{key:keyObject,dsaEncoding:'ieee-p1363'})
  const response = await fetch(subscription.endpoint,{method:'POST',headers:{'TTL':'86400','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Authorization':`vapid t=${signingInput}.${b64(signature)}, k=${publicKey}`},body:new Uint8Array(body),signal:AbortSignal.timeout(9000)})
  if (response.status===404 || response.status===410) return 'expired'
  if (!response.ok) throw new Error('Push provider returned '+response.status)
  return true
}

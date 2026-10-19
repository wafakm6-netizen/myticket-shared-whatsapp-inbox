/**
 * Validate the complete Ogg container before sending an Opus voice note to Meta.
 * This checks every page's CRC and sequence, reconstructs packets from lacing,
 * verifies OpusHead/OpusTags, and requires real audio + a final EOS granule.
 * No sensitive audio data is logged.
 */
export function validateOggOpus(bytes: Uint8Array): { valid: boolean; reason: string; durationSeconds?: number; pages?: number; audioPackets?: number } {
  const fail = (reason: string) => ({ valid: false, reason })
  if (bytes.byteLength < 100) return fail('Ogg recording is empty or truncated.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const label = (packet: Uint8Array, name: string) =>
    packet.length >= name.length && Array.from(name).every((character, index) => packet[index] === character.charCodeAt(0))
  let offset = 0
  let expectedSequence = 0
  let streamSerial: number | null = null
  let pages = 0
  let packetIndex = 0
  let audioPackets = 0
  let headerChannels = 0
  let lastGranule = 0n
  let preSkip = 0
  let seenEOS = false
  let partial: number[] = []

  while (offset < bytes.length) {
    if (bytes.length - offset < 27) return fail('Truncated Ogg page header.')
    if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'OggS') return fail('Invalid Ogg page signature.')
    if (bytes[offset + 4] !== 0) return fail('Unsupported Ogg bitstream version.')
    const flags = bytes[offset + 5]
    if ((flags & ~7) !== 0) return fail('Invalid Ogg page flags.')
    const segments = bytes[offset + 26]
    const headerLength = 27 + segments
    if (offset + headerLength > bytes.length) return fail('Truncated Ogg segment table.')
    let payloadLength = 0
    for (let i = 0; i < segments; i++) payloadLength += bytes[offset + 27 + i]
    const pageLength = headerLength + payloadLength
    if (offset + pageLength > bytes.length) return fail('Truncated Ogg page payload.')

    const serial = view.getUint32(offset + 14, true)
    const sequence = view.getUint32(offset + 18, true)
    if (streamSerial === null) streamSerial = serial
    if (streamSerial !== serial || sequence !== expectedSequence++) return fail('Unexpected Ogg stream or page sequence.')
    if (pages === 0 && (flags & 2) === 0) return fail('Ogg stream lacks beginning-of-stream page.')
    if (pages !== 0 && (flags & 2) !== 0) return fail('Unexpected second beginning-of-stream page.')
    if (Boolean(flags & 1) !== Boolean(partial.length)) return fail('Invalid Ogg packet continuation.')
    if (seenEOS) return fail('Data present after Ogg end-of-stream.')

    // Ogg's non-reflected CRC-32 (polynomial 0x04c11db7), checksum bytes zeroed.
    let crc = 0
    for (let i = 0; i < pageLength; i++) {
      const absolute = offset + i
      const byte = i >= 22 && i < 26 ? 0 : bytes[absolute]
      crc ^= byte << 24
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0
      }
    }
    if (crc !== view.getUint32(offset + 22, true)) return fail('Ogg checksum mismatch.')

    let position = offset + headerLength
    for (let segment = 0; segment < segments; segment++) {
      const size = bytes[offset + 27 + segment]
      for (let i = 0; i < size; i++) partial.push(bytes[position + i])
      position += size
      if (size < 255) {
        const packet = Uint8Array.from(partial)
        partial = []
        if (packetIndex === 0) {
          if (!label(packet, 'OpusHead') || packet.length < 19) return fail('Invalid Opus identification header.')
          if (packet[8] !== 1) return fail('Unsupported Opus header version.')
          headerChannels = packet[9]
          if (headerChannels !== 1 && headerChannels !== 2) return fail('Unsupported Opus channel count.')
          preSkip = packet[10] | (packet[11] << 8)
          const mappingFamily = packet[18]
          if (mappingFamily !== 0) return fail('Unsupported Opus channel mapping.')
          if (packet.length !== 19) return fail('Unexpected Opus identification header size.')
        } else if (packetIndex === 1) {
          if (!label(packet, 'OpusTags') || packet.length < 16) return fail('Invalid Opus comments header.')
        } else {
          if (packet.length === 0) return fail('Empty Opus audio packet.')
          audioPackets++
        }
        packetIndex++
      }
    }
    const granule = view.getBigUint64(offset + 6, true)
    if (granule !== 0xffffffffffffffffn) {
      if (granule < lastGranule) return fail('Ogg presentation timestamps are not monotonic.')
      lastGranule = granule
    }
    if ((flags & 4) !== 0) {
      if (partial.length) return fail('Ogg ends inside an incomplete packet.')
      seenEOS = true
    }
    pages++
    offset += pageLength
  }

  if (!seenEOS) return fail('Ogg recording lacks end-of-stream page.')
  if (packetIndex < 3 || audioPackets < 1) return fail('Ogg recording contains no Opus audio packets.')
  if (lastGranule <= BigInt(preSkip)) return fail('Ogg recording has no positive audio duration.')
  const durationSeconds = Number(lastGranule - BigInt(preSkip)) / 48000
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.1 || durationSeconds > 3600) return fail('Ogg recording duration is invalid.')
  return { valid: true, reason: 'ok', durationSeconds, pages, audioPackets }
}

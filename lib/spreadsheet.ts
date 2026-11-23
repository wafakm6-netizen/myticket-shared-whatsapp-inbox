// Reads .xlsx and .csv files in the browser without a library: an .xlsx file is a zip of XML parts, unzipped with
// the browser's own DecompressionStream. Returns every sheet as rows of cell text. Old binary .xls is not supported.
export type Sheet = { name: string; rows: string[][] }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('This is not an Excel (.xlsx) file.')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const files = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) continue
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(start, start + compressedSize)
    files.set(name, method === 0 ? raw : await inflateRaw(raw))
  }
  return files
}

const xml = (data: Uint8Array | undefined) => data ? new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml') : null
const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag))
const columnIndex = (ref: string) => { let index = 0; for (const char of ref.replace(/\d+/g, '')) index = index * 26 + (char.toUpperCase().charCodeAt(0) - 64); return index - 1 }

async function readXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const files = await unzip(buffer)
  const shared = byTag(xml(files.get('xl/sharedStrings.xml')) ?? new Document(), 'si').map((si) => byTag(si, 't').map((t) => t.textContent ?? '').join(''))
  const workbook = xml(files.get('xl/workbook.xml'))
  const rels = xml(files.get('xl/_rels/workbook.xml.rels'))
  const targets = new Map(byTag(rels ?? new Document(), 'Relationship').map((rel) => [rel.getAttribute('Id') ?? '', (rel.getAttribute('Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/')]))
  const sheets: Sheet[] = []
  for (const sheet of byTag(workbook ?? new Document(), 'sheet')) {
    const relId = sheet.getAttribute('r:id') ?? Array.from(sheet.attributes).find((attr) => attr.localName === 'id')?.value ?? ''
    const doc = xml(files.get(targets.get(relId) ?? ''))
    if (!doc) continue
    const rows: string[][] = []
    for (const row of byTag(doc, 'row')) {
      const cells: string[] = []
      let next = 0
      for (const cell of byTag(row, 'c')) {
        const ref = cell.getAttribute('r')
        const index = ref ? columnIndex(ref) : next
        next = index + 1
        const type = cell.getAttribute('t')
        const value = byTag(cell, 'v')[0]?.textContent ?? ''
        let text = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? byTag(cell, 't').map((t) => t.textContent ?? '').join('') : value
        // Long numbers (phone numbers typed as numbers) can be stored in exponent form.
        if (!type && /e\+?\d+$/i.test(text) && Number.isFinite(Number(text))) text = BigInt(Math.round(Number(text))).toString()
        cells[index] = text.trim()
      }
      rows.push(Array.from(cells, (value) => value ?? ''))
    }
    sheets.push({ name: sheet.getAttribute('name') || `Sheet ${sheets.length + 1}`, rows })
  }
  if (!sheets.length) throw new Error('No sheets were found in this file.')
  return sheets
}

function readCsv(text: string): Sheet[] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { cell += '"'; i++ } else if (char === '"') quoted = false; else cell += char
    } else if (char === '"') quoted = true
    else if (char === separator) { row.push(cell.trim()); cell = '' }
    else if (char === '\n' || char === '\r') { if (char === '\r' && clean[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return [{ name: 'Sheet 1', rows: rows.filter((r) => r.some(Boolean)) }]
}

export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (/\.csv$|\.txt$/i.test(file.name) || file.type === 'text/csv') return readCsv(await file.text())
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV.')
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read Excel files. Save the file as CSV and try again.')
  return readXlsx(await file.arrayBuffer())
}

// Context pack: what the agent is allowed to put on a slide.
// Text chunks and images get short ids (c1, i1…) so the agent can cite them
// (sourceIds) and pick an image (imageId) without ever seeing pixel data.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const CHUNK_CHARS = 600
const MAX_PDF_PAGES = 40
const PAGE_IMAGE_WIDTH = 960
const MAX_PACK_CHARS = 30000

const TEXT_TYPES = /\.(txt|md|markdown|csv)$/i
const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif)$/i

export function isSupported(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name) || IMAGE_TYPES.test(file.type) || TEXT_TYPES.test(file.name) || file.type === 'text/plain'
}

// Reads one dropped file into raw chunks/images (ids are assigned by addToPack).
export async function extractFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return extractPdf(file)
  if (IMAGE_TYPES.test(file.type)) return extractImage(file)
  if (TEXT_TYPES.test(file.name) || file.type === 'text/plain') {
    const text = await file.text()
    return { chunks: chunkText(text).map((t) => ({ source: file.name, page: 1, text: t })), images: [] }
  }
  throw new Error('unsupported')
}

async function extractPdf(file) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  const chunks = []
  const images = []
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES)
  for (let n = 1; n <= pages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    const text = content.items.map((it) => it.str ?? '').join(' ').replace(/\s+/g, ' ').trim()
    for (const t of chunkText(text)) chunks.push({ source: file.name, page: n, text: t })

    // Page image: the slide stage can show it, the agent picks it by page text.
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PAGE_IMAGE_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    images.push({ source: file.name, page: n, kind: 'pdf', text: text.slice(0, 300), dataUrl: canvas.toDataURL('image/jpeg', 0.72) })
    page.cleanup()
  }
  await task.destroy()
  return { chunks, images }
}

async function extractImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  // Make sure it actually decodes (catches corrupt files early).
  await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = resolve
    img.onerror = () => reject(new Error('unreadable image'))
    img.src = dataUrl
  })
  const label = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  return { chunks: [], images: [{ source: file.name, page: 1, kind: 'image', text: label, dataUrl }] }
}

// Splits page text into ~CHUNK_CHARS pieces on sentence boundaries, so a fact
// and its number usually stay in the same chunk.
export function chunkText(text, size = CHUNK_CHARS) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean]
  const out = []
  let cur = ''
  for (const s of sentences) {
    if (cur && cur.length + s.length > size) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// Appends extracted items to the pack, giving them stable sequential ids.
export function addToPack(pack, extracted) {
  let c = pack.chunks.length
  let i = pack.images.length
  return {
    chunks: [...pack.chunks, ...extracted.chunks.map((x) => ({ id: `c${++c}`, ...x }))],
    images: [...pack.images, ...extracted.images.map((x) => ({ id: `i${++i}`, ...x }))],
  }
}

// The textbox facts become one more source, "facts".
export function factsChunks(facts) {
  return chunkText(facts).map((text, n) => ({ id: `f${n + 1}`, source: 'facts', page: 1, text }))
}

// The string passed to the agent as {{context_pack}}. No pixel data, ever.
export function serializePack({ chunks, images, facts = '' }) {
  const all = [...chunks, ...factsChunks(facts)]
  const lines = ['TEXT CHUNKS']
  for (const c of all) lines.push(`[${c.id}] (${c.source} p${c.page}) ${c.text}`)
  lines.push('', 'IMAGES (use the id as imageId)')
  for (const i of images) lines.push(`[${i.id}] (${i.source} p${i.page}) ${(i.text ?? '').slice(0, 200)}`)
  let pack = lines.join('\n')
  if (pack.length > MAX_PACK_CHARS) {
    console.warn(`[context] pack truncated from ${pack.length} to ${MAX_PACK_CHARS} chars`)
    pack = pack.slice(0, MAX_PACK_CHARS)
  }
  return pack
}

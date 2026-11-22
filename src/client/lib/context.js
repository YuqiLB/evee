// Context pack: what the agent is allowed to put on a slide.
// Text chunks and images get short ids (c1, i1…) so the agent can cite them
// (sourceIds) and pick an image (imageId) without ever seeing pixel data.

const MAX_PACK_CHARS = 30000

// M1 stand-in until real uploads are wired: [placeholder] facts only.
export const FAKE_PACK = {
  chunks: [
    { id: 'c1', source: 'facts', page: 1, text: '[placeholder] evee composes slides from your own material while you pitch.' },
    { id: 'c2', source: 'facts', page: 1, text: '[placeholder] Pricing: $49 per month per founder. 14-day free trial.' },
    { id: 'c3', source: 'facts', page: 1, text: '[placeholder] Traction: 120 founders on the waitlist, 18 paying pilots.' },
  ],
  images: [],
}

// The string passed to the agent as {{context_pack}}.
export function serializePack({ chunks, images }) {
  const lines = ['TEXT CHUNKS']
  for (const c of chunks) lines.push(`[${c.id}] (${c.source} p${c.page}) ${c.text}`)
  lines.push('', 'IMAGES (use the id as imageId)')
  for (const i of images) lines.push(`[${i.id}] (${i.source} p${i.page}) ${(i.text ?? '').slice(0, 200)}`)
  let pack = lines.join('\n')
  if (pack.length > MAX_PACK_CHARS) {
    console.warn(`[context] pack truncated from ${pack.length} to ${MAX_PACK_CHARS} chars`)
    pack = pack.slice(0, MAX_PACK_CHARS)
  }
  return pack
}

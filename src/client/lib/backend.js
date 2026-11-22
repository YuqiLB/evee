// Link to the eevee backend (backend/cloudflare), through the Express proxy at /api/eevee.
// Setup uploads each file to a backend dataset, which Claude turns into cards.
// During the pitch the transcript streams to the backend over a WebSocket and the
// cards it picks come back (onCard). When the pitch ends it writes a summary.
// All optional: without EEVEE_API_URL / EEVEE_API_KEY the proxy answers 503,
// `backend` becomes 'off' and the pitch runs on the ElevenLabs agent alone.
import { store } from '../state.js'
import { createElevenLabsAdapter } from '../../../backend/integrations/elevenlabs-adapter.mjs'

// File types the backend accepts (it refuses GIF), by extension.
const MIME = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
const JOB_TIMEOUT_MS = 5 * 60 * 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, { method = 'POST', json, body, headers = {} } = {}) {
  const res = await fetch(`/api/eevee${path}`, {
    method,
    headers: json ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: json ? JSON.stringify(json) : body,
  })
  const data = await res.json().catch(() => null)
  if (res.status === 503 && data?.error === 'backend not configured') store.setState({ backend: 'off' })
  if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? `backend ${path} failed (${res.status})`)
  return data
}

const isOff = () => store.getState().backend === 'off'

async function waitForJob(id) {
  const until = Date.now() + JOB_TIMEOUT_MS
  while (Date.now() < until) {
    const job = await api(`/jobs/${id}`, { method: 'GET' })
    if (job.status === 'completed') return job
    if (job.status === 'failed') throw new Error(`backend job failed: ${job.error ?? 'unknown error'}`)
    await sleep(1500)
  }
  throw new Error('backend job timed out')
}

// ---- Setup: dataset uploads. One step at a time: the backend refuses uploads
// while a version is processing, and each processing run picks up every file
// uploaded since the last one (earlier cards carry over).
let queue = Promise.resolve()
let pending = false // files uploaded but not processed yet
let factsSent = ''

function enqueue(fn) {
  const run = queue.then(fn)
  queue = run.catch((err) => console.warn('[backend]', err.message))
}

async function datasetId() {
  let id = store.getState().datasetId
  if (!id) {
    id = (await api('/datasets', { json: { name: 'evee pitch' } })).dataset_id
    store.setState({ datasetId: id })
  }
  return id
}

async function upload(name, blob) {
  if (isOff()) return
  const type = MIME[name.split('.').pop().toLowerCase()]
  if (!type) return console.warn(`[backend] ${name}: not a type the backend reads, kept in the browser only`)
  const id = await datasetId()
  // Header values must be plain ASCII.
  await api(`/datasets/${id}/files`, { body: blob, headers: { 'Content-Type': type, 'x-filename': name.replace(/[^\x20-\x7e]/g, '_') } })
  pending = true
}

async function processPending() {
  if (!pending || isOff()) return
  pending = false
  const { job_id } = await api(`/datasets/${store.getState().datasetId}/process`)
  const job = await waitForJob(job_id)
  console.log(`[backend] dataset ready: ${job.result?.cards_added ?? '?'} new cards`)
}

export function ingestFiles(files) {
  for (const file of files) enqueue(() => upload(file.name, file))
  enqueue(processPending)
}

// The facts textbox becomes one more file. shortcut: an edited fact adds a new
// facts.txt and the old one's cards stay; fine for one pitch per Setup.
export function ingestFacts(facts) {
  const text = facts.trim()
  if (!text || text === factsSent) return
  factsSent = text
  enqueue(() => upload('facts.txt', new Blob([text], { type: 'text/plain' })))
  enqueue(processPending)
}

// ---- Pitch: live transcript stream
let live = null // { sessionId, streamBase, adapter, socket, outbox, onCard }

// Waits for ingestion to finish, then opens a backend session for this pitch.
// Transcript said before then is replayed so the backend (and its summary) has it all.
export async function connectBackend(streamBase, { onCard }) {
  await queue
  const s = store.getState()
  if (!streamBase || isOff() || !s.datasetId || s.screen !== 'pitch' || live) return
  try {
    const { session_id } = await api('/sessions', { json: { dataset_id: s.datasetId } })
    const l = { sessionId: session_id, streamBase, onCard, socket: null, outbox: [] }
    l.adapter = createElevenLabsAdapter({
      sessionId: session_id,
      send: (msg) => (l.socket?.readyState === WebSocket.OPEN ? l.socket.send(msg) : l.outbox.push(msg)),
    })
    live = l
    for (const t of store.getState().transcript) if (t.role === 'user') l.adapter.onSdkMessage({ source: 'user', message: t.text })
    await openSocket(l)
  } catch (err) {
    console.warn('[backend] live cards unavailable:', err.message)
  }
}

async function openSocket(l) {
  const { path } = await api(`/sessions/${l.sessionId}/stream-token`)
  const ws = new WebSocket(l.streamBase + path)
  l.socket = ws
  ws.onopen = () => {
    store.setState({ backendLive: true })
    while (l.outbox.length) ws.send(l.outbox.shift())
  }
  ws.onmessage = (e) => {
    let event
    try {
      event = JSON.parse(e.data)
    } catch {
      return
    }
    l.adapter.onEeveeMessage(event)
    // The backend sends its picks best-first; the screen shows one slide at a time.
    // context.clear is ignored so the last slide stays up instead of going blank.
    if (event.type === 'context.update' && event.payload?.items?.[0]) l.onCard(event.payload.items[0])
    if (event.type === 'context.error') console.warn('[backend] context error', event.payload?.code)
  }
  // Dropped mid-pitch: reconnect with a fresh token (the old one lasts 60 s).
  ws.onclose = () => {
    if (live !== l) return
    store.setState({ backendLive: false })
    setTimeout(() => live === l && openSocket(l).catch((err) => console.warn('[backend] reconnect failed:', err.message)), 2000)
  }
}

// Called by the agent's onMessage for every transcript line.
export function forwardTranscript(message) {
  live?.adapter.onSdkMessage(message)
}

// ---- Pitch end: close the stream, let the backend write its summary, and put it
// in the store (Follow-up redrafts the email whenever `summary` changes).
export async function endBackend() {
  const l = live
  live = null
  store.setState({ backendLive: false })
  if (!l) return
  l.socket?.close()
  try {
    const { job_id } = await api(`/sessions/${l.sessionId}/end`)
    await waitForJob(job_id)
    const { summary } = await api(`/sessions/${l.sessionId}/summary`, { method: 'GET' })
    if (summary) store.setState({ summary: formatSummary(summary), backendSummary: true })
  } catch (err) {
    console.warn('[backend] summary unavailable:', err.message)
  }
}

function formatSummary(x) {
  const lines = [x.overview ?? '']
  if (x.key_points?.length) lines.push('', ...x.key_points.map((p) => `- ${p}`))
  if (x.action_items?.length) lines.push('', 'Next steps', ...x.action_items.map((a) => `- ${a.task}`))
  return lines.join('\n').trim()
}

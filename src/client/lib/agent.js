// ElevenLabs agent session + the client tools it calls.
// Path of a slide: agent LLM decides → calls show_slide(args) over the socket →
// the SDK invokes toolHandlers.show_slide(args) here → store.setState → <Slide> re-renders.
import { useEffect } from 'react'
import { useConversation, useConversationClientTool } from '@elevenlabs/react'
import { store, nowIso } from '../state.js'
import { serializePack } from './context.js'
import { callAction } from '../api.js'
import { gateSlide, levelOf } from './sensitivity.js'
import { connectBackend, forwardTranscript } from './backend.js'

// A slide that arrived too soon after the last one (see sensitivity.js).
// Only the newest is kept: a later one replaces it and restarts nothing.
let waiting = null // { slide, timer }

function clearWaiting() {
  if (waiting) clearTimeout(waiting.timer)
  waiting = null
}

// Puts a slide on screen, unless the pitch has ended or it's now a repeat.
function putUp(slide) {
  const s = store.getState()
  if (s.screen !== 'pitch') return 'ignored: pitch is not running'
  const last = s.slides[s.slides.length - 1]
  const level = levelOf(s.sensitivity)
  if (gateSlide(last, slide.title, Date.now(), level).action === 'skip') return 'ignored: same slide is already showing'
  store.setState({ slides: [...s.slides, { ...slide, id: `s${s.slides.length + 1}`, at: nowIso() }] })
  return 'shown'
}

// ---- tool argument cleanup (LLMs sometimes send arrays/objects as JSON strings)
function parseMaybeJson(v) {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}
function toList(v) {
  v = parseMaybeJson(v)
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/\n|•/).map((s) => s.replace(/^[-*\s]+/, '').trim()).filter(Boolean)
  return []
}
function capWords(s, n) {
  const words = s.split(/\s+/)
  return words.length <= n ? s : words.slice(0, n).join(' ') + '…'
}
function toStat(v) {
  v = parseMaybeJson(v)
  if (!v || typeof v !== 'object' || !v.value) return null
  return { value: String(v.value), label: String(v.label ?? '') }
}

// Every slide, from the agent or the backend, goes through the sensitivity gate.
function queueSlide(slide) {
  const s = store.getState()
  const last = s.slides[s.slides.length - 1]
  const gate = gateSlide(last, slide.title, Date.now(), levelOf(s.sensitivity))
  if (gate.action === 'skip') return 'ignored: same slide is already showing'
  clearWaiting() // this slide is newer than anything waiting
  if (gate.action === 'show') return putUp(slide)
  waiting = {
    slide,
    timer: setTimeout(() => {
      waiting = null
      putUp(slide)
    }, gate.waitMs),
  }
  return 'queued'
}

// A backend card as a slide: the first sentences of its text become the bullets.
// Its image is served through the proxy, so <img> can load it without the key.
function cardToSlide(card) {
  const sentences = String(card.text ?? '').match(/[^.!?]+[.!?]*/g) ?? []
  return {
    trigger: '',
    title: String(card.title ?? '').trim(),
    layout: null,
    bullets: sentences.map((x) => x.trim()).filter(Boolean).slice(0, 3).map((b) => capWords(b, 12)),
    stat: null,
    imageId: null,
    image: card.image?.path ? { id: card.id, dataUrl: card.image.path.replace(/^\/v1\//, '/api/eevee/') } : null,
    sourceIds: [card.id],
  }
}

// ---- the client tools (also reachable from window.__evee in dev)
export const toolHandlers = {
  show_slide(args = {}) {
    const s = store.getState()
    const at = nowIso()
    const trigger = String(args.trigger ?? '').trim()
    const title = String(args.title ?? '').trim()
    // The question is kept for the follow-up email whatever happens to the slide.
    if (trigger) store.setState({ transcript: [...s.transcript, { role: 'question', text: trigger, at }] })
    if (!title) return 'ignored: title is required'
    if (s.backendLive) return 'ignored: slides come from the backend'

    const imageIds = new Set(s.images.map((i) => i.id))
    const imageId = imageIds.has(args.imageId) ? args.imageId : null
    const slide = {
      trigger,
      title,
      // What the agent asked for; <Slide> checks it fits before using it.
      layout: String(args.layout ?? '').trim().toLowerCase() || null,
      bullets: toList(args.bullets).slice(0, 3).map((b) => capWords(b, 12)),
      stat: toStat(args.stat),
      imageId,
      sourceIds: toList(args.sourceIds),
    }
    return queueSlide(slide)
  },

  log_followup(args = {}) {
    const s = store.getState()
    const question = String(args.question ?? '').trim()
    if (!question) return 'ignored: question is required'
    const at = nowIso()
    store.setState({
      openQuestions: [...s.openQuestions, { question, at }],
      transcript: [...s.transcript, { role: 'question', text: question, at }],
      // Calm mode records the question but doesn't flash the toast.
      ...(levelOf(s.sensitivity).toast ? { toastAt: Date.now() } : {}),
    })
    return 'noted'
  },

  capture_email(args = {}) {
    const email = String(args.email ?? '').trim().replace(/\s+/g, '').toLowerCase()
    const summary = String(args.summary ?? '').trim()
    // The backend's summary (written from the full transcript) wins over the agent's.
    store.setState((s) => ({ email: email || s.email, summary: s.backendSummary ? s.summary : summary || s.summary }))
    return email ? 'saved' : 'ignored: email is required'
  },
}

// ---- React hook: owns the live session
export function useEveeAgent() {
  const conversation = useConversation({
    volume: 0, // evee never speaks; this mutes it even if the LLM talks anyway
    onMessage: (m) => {
      const role = m.role ?? (m.source === 'ai' ? 'agent' : 'user')
      store.setState((s) => ({ transcript: [...s.transcript, { role, text: m.message, at: nowIso() }] }))
      forwardTranscript(m)
    },
    onError: (message) => console.warn('[agent]', message),
  })

  useConversationClientTool('show_slide', toolHandlers.show_slide)
  useConversationClientTool('log_followup', toolHandlers.log_followup)
  useConversationClientTool('capture_email', toolHandlers.capture_email)

  async function start() {
    // Ask for the mic first so "mic denied" is told apart from agent errors.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())

    const { sessionId, signedUrl, agentId, streamBase } = await callAction('startSession')
    store.setState({ sessionId })
    // Not awaited: it waits for ingestion, and the pitch shouldn't.
    connectBackend(streamBase, { onCard: (card) => queueSlide(cardToSlide(card)) })
    const context_pack = serializePack(store.getState())
    const auth = signedUrl ? { signedUrl, connectionType: 'websocket' } : { agentId }
    conversation.startSession({ ...auth, dynamicVariables: { context_pack } })
  }

  return { ...conversation, start }
}

// Dev-only: drive the tools from the console / browser automation without a mic.
export function useDevHook() {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__evee = {
      toolCall: (name, args) => toolHandlers[name]?.(args),
      state: () => store.getState(),
      // Backend without a mic: open the stream, then send stand-ins for spoken lines.
      connectBackend: async () => connectBackend((await callAction('startSession')).streamBase, { onCard: (card) => queueSlide(cardToSlide(card)) }),
      say: (text) => forwardTranscript({ source: 'user', message: text }),
    }
  }, [])
}

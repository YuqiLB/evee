// ElevenLabs agent session + the client tools it calls.
// Path of a slide: agent LLM decides → calls show_slide(args) over the socket →
// the SDK invokes toolHandlers.show_slide(args) here → store.setState → <Slide> re-renders.
import { useEffect } from 'react'
import { useConversation, useConversationClientTool } from '@elevenlabs/react'
import { store, nowIso } from '../state.js'
import { serializePack } from './context.js'
import { callAction } from '../api.js'

export const DEDUPE_MS = 6000

// SPEC: ignore a show_slide that arrives within 6 s of the last one, unless its
// title is different. Returns true when the new slide should be rendered.
export function shouldShowSlide(lastSlide, nextTitle, nowMs) {
  if (!lastSlide) return true
  const sameTitle = norm(lastSlide.title) === norm(nextTitle)
  const tooSoon = nowMs - Date.parse(lastSlide.at) < DEDUPE_MS
  return !(sameTitle && tooSoon)
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
const norm = (s) => String(s ?? '').trim().toLowerCase()

// ---- the client tools (also reachable from window.__evee in dev)
export const toolHandlers = {
  show_slide(args = {}) {
    const s = store.getState()
    const at = nowIso()
    const trigger = String(args.trigger ?? '').trim()
    const title = String(args.title ?? '').trim()
    const recordQuestion = trigger ? [{ role: 'question', text: trigger, at }] : []
    if (!title) {
      store.setState({ transcript: [...s.transcript, ...recordQuestion] })
      return 'ignored: title is required'
    }

    const last = s.slides[s.slides.length - 1]
    if (!shouldShowSlide(last, title, Date.now())) {
      // Still keep the question for the follow-up email.
      store.setState({ transcript: [...s.transcript, ...recordQuestion] })
      return 'ignored: same slide is already showing'
    }

    const imageIds = new Set(s.images.map((i) => i.id))
    const imageId = imageIds.has(args.imageId) ? args.imageId : null
    const slide = {
      id: `s${s.slides.length + 1}`,
      at,
      trigger,
      title,
      // What the agent asked for; <Slide> checks it fits before using it.
      layout: String(args.layout ?? '').trim().toLowerCase() || null,
      bullets: toList(args.bullets).slice(0, 3).map((b) => capWords(b, 12)),
      stat: toStat(args.stat),
      imageId,
      sourceIds: toList(args.sourceIds),
    }
    store.setState({ slides: [...s.slides, slide], transcript: [...s.transcript, ...recordQuestion] })
    return 'shown'
  },

  log_followup(args = {}) {
    const s = store.getState()
    const question = String(args.question ?? '').trim()
    if (!question) return 'ignored: question is required'
    const at = nowIso()
    store.setState({
      openQuestions: [...s.openQuestions, { question, at }],
      transcript: [...s.transcript, { role: 'question', text: question, at }],
      toastAt: Date.now(),
    })
    return 'noted'
  },

  capture_email(args = {}) {
    const email = String(args.email ?? '').trim().replace(/\s+/g, '').toLowerCase()
    const summary = String(args.summary ?? '').trim()
    store.setState((s) => ({ email: email || s.email, summary: summary || s.summary }))
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

    const { sessionId, signedUrl, agentId } = await callAction('startSession')
    store.setState({ sessionId })
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
    }
  }, [])
}

// One tiny external store for the whole app (browser memory only, per SPEC).
// Agent tool handlers run outside React render, so they read/write the store
// directly via getState/setState and never see stale closures.
import { useSyncExternalStore } from 'react'

const initial = {
  screen: 'setup', // 'setup' | 'pitch' | 'followup'
  zooming: false, // true while Setup zooms into the fog before the pitch
  files: [], // {name, status: 'loading'|'ok'|'error', error?}
  facts: '',
  chunks: [], // ContextChunk {id, source, page, text}
  images: [], // ContextImage {id, source, page, dataUrl, text}
  sessionId: null,
  slides: [], // Slide[] (accepted ones, in order)
  openQuestions: [], // {question, at}
  transcript: [], // {role: 'user'|'agent'|'question', text, at}
  email: '',
  summary: '',
  toastAt: 0, // timestamp of the last "Noted for follow-up"
  sensitivity: 'normal', // 'calm' | 'normal' | 'lively', see lib/sensitivity.js
  // eevee backend, see lib/backend.js
  backend: 'unknown', // 'unknown' | 'off' (not configured on the server)
  datasetId: null, // the uploaded files, as a backend dataset
  backendLive: false, // transcript stream open: slides come from the backend
  backendSummary: false, // summary came from the backend (the agent's is then ignored)
}

let state = initial
const listeners = new Set()

export const store = {
  getState: () => state,
  setState(patch) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    listeners.forEach((l) => l())
  },
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  // New pitch: clear session data, keep the uploaded material and the sensitivity.
  reset() {
    const { files, facts, chunks, images, sensitivity, backend, datasetId } = state
    store.setState({ ...initial, files, facts, chunks, images, sensitivity, backend, datasetId })
  },
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => selector(state))
}

export const nowIso = () => new Date().toISOString()

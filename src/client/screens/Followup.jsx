// Follow-up: the agent asks for the email aloud (or the visitor types it),
// the server drafts the email from the session, the founder approves the send.
import { useEffect, useRef, useState } from 'react'
import { store, useStore } from '../state.js'
import { callAction } from '../api.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Sends everything collected in the browser to the server; returns the session id.
// Calls are chained so two overlapping saves never create two Session rows.
let queue = Promise.resolve()
function persist(extra = {}) {
  const run = queue.then(() => save(extra))
  queue = run.catch(() => {})
  return run
}

async function save(extra) {
  const s = store.getState()
  const { sessionId } = await callAction('saveSession', {
    sessionId: s.sessionId,
    transcript: s.transcript,
    slides: s.slides,
    openQuestions: s.openQuestions,
    summary: s.summary,
    ...extra,
  })
  if (sessionId !== s.sessionId) store.setState({ sessionId })
  return sessionId
}

export function Followup({ agent }) {
  const voiceEmail = useStore((s) => s.email)
  const summary = useStore((s) => s.summary)
  const [email, setEmail] = useState('')
  const [draft, setDraft] = useState(null)
  const [phase, setPhase] = useState('drafting') // drafting | ready | sending | sent | held | failed
  const [result, setResult] = useState(null)
  const asked = useRef(false)

  // Pitch is over: let the agent speak and ask for the email.
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (agent.status === 'connected') agent.sendUserMessage('[pitch ended]')
  }, [])

  // Voice capture fills the field (typing stays possible either way).
  useEffect(() => {
    if (voiceEmail) setEmail(voiceEmail)
  }, [voiceEmail])

  // (Re)draft on entry and whenever the agent hands over its summary.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sessionId = await persist()
        const d = await callAction('draftFollowup', { sessionId })
        if (!cancelled) {
          setDraft(d)
          setPhase((p) => (p === 'drafting' ? 'ready' : p))
        }
      } catch (err) {
        if (!cancelled) {
          setResult({ error: err.message })
          setPhase('failed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [summary])

  async function approve() {
    setPhase('sending')
    setResult(null)
    try {
      const sessionId = await persist({ email })
      const res = await callAction('sendFollowup', { sessionId, email })
      setResult(res)
      setPhase(res.status)
      if (res.status === 'sent' && agent.status === 'connected') agent.endSession()
    } catch (err) {
      setResult({ error: err.message })
      setPhase('failed')
    }
  }

  const validEmail = EMAIL_RE.test(email.trim())
  const busy = phase === 'drafting' || phase === 'sending'

  return (
    <main className="followup">
      <div className="field">
        <label htmlFor="email">[email label]</label>
        <input
          id="email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={phase === 'sent'}
        />
      </div>

      {draft && (
        <section className="draft" aria-busy={busy}>
          <h2>{draft.subject}</h2>
          {draft.summary && <p>{draft.summary}</p>}
          <DraftList title="[questions heading]" items={draft.questions} />
          <DraftList title="[slides heading]" items={draft.slides.map((s) => s.title)} />
          <DraftList title="[open questions heading]" items={draft.openQuestions} />
        </section>
      )}

      {phase === 'sent' ? (
        <p className="status-line">
          [sent message]{result?.dryRun ? ' (dry run)' : ''}
        </p>
      ) : (
        <button className="primary" disabled={!validEmail || busy || !draft} onClick={approve}>
          [approve button label]
        </button>
      )}

      {phase === 'held' && (
        <p className="status-line">
          [held message]{' '}
          {result?.approvalUrl && (
            <a href={result.approvalUrl} target="_blank" rel="noreferrer">
              [approval link label]
            </a>
          )}
        </p>
      )}
      {phase === 'failed' && <p className="error-text">{result?.error ?? '[send error message]'}</p>}
    </main>
  )
}

function DraftList({ title, items }) {
  if (!items?.length) return null
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {items.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  )
}

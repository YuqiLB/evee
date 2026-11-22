import { useEffect, useRef, useState } from 'react'
import { useStore, store } from '../state.js'
import { SlideStage } from '../components/Slide.jsx'
import { Toast } from '../components/Toast.jsx'

const MIC_ERROR = '[mic error message]'
const AGENT_ERROR = '[agent error message]'

export function Pitch({ agent }) {
  const slides = useStore((s) => s.slides)
  const images = useStore((s) => s.images)
  const toastAt = useStore((s) => s.toastAt)
  const [error, setError] = useState(null)
  const wasConnected = useRef(false)
  const started = useRef(false)

  const slide = slides[slides.length - 1] ?? null
  const image = slide?.imageId ? images.find((i) => i.id === slide.imageId) : null
  const coverImage = images.find((i) => i.page === 1 && i.kind === 'pdf') ?? null

  async function connect() {
    setError(null)
    wasConnected.current = false
    try {
      await agent.start()
    } catch (e) {
      setError(e?.name === 'NotAllowedError' || e?.name === 'NotFoundError' ? MIC_ERROR : e?.message || AGENT_ERROR)
    }
  }

  // Connect once on entry (guarded: React StrictMode runs effects twice in dev).
  useEffect(() => {
    if (started.current) return
    started.current = true
    connect()
  }, [])

  // Agent dropped mid-pitch → error state with retry.
  useEffect(() => {
    if (agent.status === 'connected') wasConnected.current = true
    if (agent.status === 'error' || (agent.status === 'disconnected' && wasConnected.current)) {
      setError((e) => e ?? agent.message ?? AGENT_ERROR)
    }
  }, [agent.status, agent.message])

  function end() {
    store.setState({ screen: 'followup' })
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && end()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const listening = agent.status === 'connected'
  const connecting = !error && !listening

  return (
    <main className="pitch">
      <SlideStage slide={slide} image={image} coverImage={coverImage} />

      <div className={`listening ${listening ? 'on' : ''}`} aria-live="polite">
        <span className="dot" />
        {listening ? '[listening label]' : connecting ? '[connecting label]' : null}
      </div>

      <button className="end-button" onClick={end}>
        [end button label]
      </button>

      {error && (
        <div className="pitch-error" role="alert">
          <span>{error}</span>
          <button className="link-button" onClick={connect}>
            [retry label]
          </button>
        </div>
      )}

      <Toast at={toastAt} text="Noted for follow-up" />
    </main>
  )
}

// Setup: dropbox + small textbox. Files are read in the browser into the context pack.
import { useRef, useState } from 'react'
import { store, useStore } from '../state.js'
import { addToPack, extractFile, isSupported, factsChunks } from '../lib/context.js'

const FILE_ERROR = '[file error message]'

export function Setup() {
  const files = useStore((s) => s.files)
  const facts = useStore((s) => s.facts)
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)

  const loading = files.some((f) => f.status === 'loading')
  const ready = !loading && (files.some((f) => f.status === 'ok') || facts.trim().length > 0)

  async function addFiles(list) {
    for (const file of Array.from(list)) {
      const key = `${file.name}-${file.size}-${file.lastModified}`
      if (store.getState().files.some((f) => f.key === key)) continue
      setFile({ key, name: file.name, status: 'loading' })
      if (!isSupported(file)) {
        setFile({ key, name: file.name, status: 'error', error: FILE_ERROR })
        continue
      }
      try {
        const extracted = await extractFile(file)
        const s = store.getState()
        const pack = addToPack({ chunks: s.chunks, images: s.images }, extracted)
        store.setState(pack)
        setFile({ key, name: file.name, status: 'ok', meta: summarize(extracted) })
        console.log(`[context] ${file.name}: ${extracted.chunks.length} text chunks, ${extracted.images.length} images (pack: ${pack.chunks.length} chunks, ${pack.images.length} images)`)
      } catch (err) {
        console.warn(`[context] could not read ${file.name}:`, err?.message ?? err)
        setFile({ key, name: file.name, status: 'error', error: FILE_ERROR })
      }
    }
  }

  // Starts the zoom into the fog; App switches to the pitch when the zoom ends.
  function start() {
    const s = store.getState()
    if (!ready || s.zooming) return
    console.log(`[context] starting with ${s.chunks.length + factsChunks(s.facts).length} text chunks, ${s.images.length} images`)
    store.setState({ zooming: true })
  }

  return (
    <main className="setup">
      <div
        className={`glass dropbox ${drag ? 'drag' : ''}`}
        role="button"
        tabIndex={0}
        aria-busy={loading}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          addFiles(e.dataTransfer.files)
        }}
      >
        [dropbox prompt]
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.key} className={f.status === 'error' ? 'bad' : ''}>
              <span>{f.name}</span>
              <span className="meta">{f.status === 'loading' ? '…' : f.status === 'error' ? f.error : f.meta}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="glass facts-box">
        <textarea
          className="facts"
          rows={1}
          placeholder="[textbox placeholder]"
          value={facts}
          onChange={(e) => store.setState({ facts: e.target.value })}
          onKeyDown={(e) => {
            // Enter starts (like sending a message); Shift+Enter adds a line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              start()
            }
          }}
        />
        <button className="send" disabled={!ready} onClick={start} aria-label="[start button label]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </button>
      </div>
    </main>
  )
}

function setFile(entry) {
  store.setState((s) => {
    const i = s.files.findIndex((f) => f.key === entry.key)
    const files = [...s.files]
    if (i === -1) files.push(entry)
    else files[i] = entry
    return { files }
  })
}

function summarize({ chunks, images }) {
  const parts = []
  if (chunks.length) parts.push(`${chunks.length} chunks`)
  if (images.length) parts.push(`${images.length} images`)
  return parts.join(' · ') || '0 chunks'
}

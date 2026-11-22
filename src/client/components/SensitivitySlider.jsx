// Vertical sensitivity slider: a glass capsule with a glossy knob, pinned
// bottom-left on Setup and during the pitch.
// Top (+) = Lively, the screen follows every turn; bottom (−) = Calm, it changes rarely.
// While dragging, the knob follows the pointer freely; on release it eases into
// the nearest of the three stops. The level updates live as the pointer crosses
// a stop, so it can be changed mid-pitch.
import { useRef, useState } from 'react'
import { store, useStore } from '../state.js'
import { LEVELS } from '../lib/sensitivity.js'

const ORDER = ['calm', 'normal', 'lively'] // bottom → top
const LAST = ORDER.length - 1
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function setIndex(i) {
  const id = ORDER[clamp(i, 0, LAST)]
  if (store.getState().sensitivity !== id) store.setState({ sensitivity: id })
}

export function SensitivitySlider({ tone = 'fog' }) {
  const value = useStore((s) => s.sensitivity)
  const index = Math.max(0, ORDER.indexOf(value))
  const railRef = useRef(null)
  const [drag, setDrag] = useState(null) // 0..1 while the pointer is down, else null

  function fromPointer(e) {
    // Sizes come from the rendered knob, so the CSS can change them freely.
    const rail = railRef.current
    const knob = rail.querySelector('.sens-knob')
    const r = rail.getBoundingClientRect()
    const size = knob.offsetHeight
    const pad = parseFloat(getComputedStyle(knob).bottom)
    const travel = rail.clientHeight - size - 2 * pad
    const inner = r.top + rail.clientTop + rail.clientHeight // bottom edge inside the border
    const t = clamp((inner - pad - size / 2 - e.clientY) / travel, 0, 1)
    setDrag(t)
    setIndex(Math.round(t * LAST))
  }

  function onKeyDown(e) {
    const step = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1 }[e.key]
    if (step) setIndex(index + step)
    else if (e.key === 'Home') setIndex(0)
    else if (e.key === 'End') setIndex(LAST)
    else return
    e.preventDefault()
    e.stopPropagation() // keep arrows from reaching the pitch's own shortcuts
  }

  const t = drag ?? index / LAST

  return (
    <div className={`sens sens--${tone}${drag !== null ? ' is-dragging' : ''}`} style={{ '--t': t }}>
      {/* The +/− ends are pointer shortcuts only; the slider itself carries keyboard and screen-reader use. */}
      <button className="sens-end" tabIndex={-1} aria-hidden="true" onClick={() => setIndex(index + 1)}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>

      <div
        ref={railRef}
        className="sens-rail"
        role="slider"
        tabIndex={0}
        aria-label="Sensitivity"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={LAST}
        aria-valuenow={index}
        aria-valuetext={LEVELS[ORDER[index]].label}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e)
        }}
        onPointerMove={(e) => drag !== null && fromPointer(e)}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        {ORDER.map((id, i) => (
          <span key={id} className="sens-stop" style={{ '--at': i / LAST }} />
        ))}
        <span className="sens-knob" />
      </div>

      <button className="sens-end" tabIndex={-1} aria-hidden="true" onClick={() => setIndex(index - 1)}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3 8h10" />
        </svg>
      </button>
    </div>
  )
}

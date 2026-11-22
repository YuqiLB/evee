import { useEffect, useState } from 'react'

// Shows `text` for 2.5 s every time `at` (a timestamp) changes.
export function Toast({ at, text }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!at) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2500)
    return () => clearTimeout(t)
  }, [at])
  return (
    <div className={`toast ${visible ? 'show' : ''}`} role="status" aria-live="polite">
      {visible ? text : ''}
    </div>
  )
}

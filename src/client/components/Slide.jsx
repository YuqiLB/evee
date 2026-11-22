// Fixed slide template: title, ≤3 bullets, optional stat, optional image.
// Drawn on a 1280×720 canvas at SPEC sizes (title 64, bullets 32), then scaled
// to fit the stage, so the layout is identical on a phone and a projector.
import { useLayoutEffect, useRef, useState } from 'react'
import { Eyes } from './Eyes.jsx'

const W = 1280
const H = 720

export function SlideStage({ slide, image, coverImage }) {
  const ref = useRef(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setScale(Math.min(width / W, height / H))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="stage" ref={ref}>
      <div className="slide" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {slide ? <Composed slide={slide} image={image} /> : <Empty coverImage={coverImage} />}
      </div>
    </div>
  )
}

function Composed({ slide, image }) {
  const hasSide = Boolean(image || slide.stat)
  return (
    <div className={`slide-body ${hasSide ? 'with-side' : ''}`} key={slide.id}>
      <div className="slide-main">
        <h1 className="slide-title">{slide.title}</h1>
        {slide.bullets.length > 0 && (
          <ul className="slide-bullets">
            {slide.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
      </div>
      {hasSide && (
        <div className="slide-side">
          {slide.stat && (
            <div className="slide-stat">
              <div className="slide-stat-value">{slide.stat.value}</div>
              <div className="slide-stat-label">{slide.stat.label}</div>
            </div>
          )}
          {image && <img className="slide-image" src={image.dataUrl} alt="" />}
        </div>
      )}
    </div>
  )
}

// Empty state: first page of the first PDF, or a blank title slide.
function Empty({ coverImage }) {
  if (coverImage) return <img className="slide-cover" src={coverImage.dataUrl} alt="" />
  return (
    <div className="slide-body slide-blank">
      <Eyes size={160} className="slide-blank-eyes" />
      <h1 className="slide-title">evee</h1>
    </div>
  )
}

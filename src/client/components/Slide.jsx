// Slide content: title, ≤3 bullets, optional stat, optional image, arranged by
// one of the layouts in ../layouts/layouts.json.
// Drawn on a 1280×720 canvas at SPEC sizes (title 64, bullets 32), then scaled
// to fit the stage, so the layout is identical on a phone and a projector.
import { useLayoutEffect, useRef, useState } from 'react'
import { Eyes } from './Eyes.jsx'
import { LAYOUT_COMPONENTS } from '../layouts/Layouts.jsx'
import { resolveLayout } from '../layouts/resolve.js'

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

// The agent's requested layout goes through resolveLayout() first, so a bad
// pick (big-stat with no number) falls back instead of drawing a broken slide.
function Composed({ slide, image }) {
  const Layout = LAYOUT_COMPONENTS[resolveLayout(slide, image)]
  return <Layout key={slide.id} slide={slide} image={image} />
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

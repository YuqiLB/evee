// One component per entry in layouts.json. Each one draws on the same 1280×720
// canvas and gets the same props, so <Slide> can swap them freely. They must not
// crash on missing content: resolveLayout() is supposed to stop a bad fit, but a
// layout still renders something sensible if one slips through.

function Bullets({ items, className = 'slide-bullets' }) {
  if (!items?.length) return null
  return (
    <ul className={className}>
      {items.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  )
}

function Stat({ stat, className = 'slide-stat' }) {
  if (!stat) return null
  return (
    <div className={className}>
      <div className="slide-stat-value">{stat.value}</div>
      {stat.label && <div className="slide-stat-label">{stat.label}</div>}
    </div>
  )
}

export function TitleBullets({ slide }) {
  return (
    <div className="slide-body layout-title-bullets">
      <h1 className="slide-title">{slide.title}</h1>
      <Bullets items={slide.bullets} />
    </div>
  )
}

export function Split({ slide, image }) {
  return (
    <div className="slide-body layout-split">
      <div className="slide-main">
        <h1 className="slide-title">{slide.title}</h1>
        <Bullets items={slide.bullets} />
      </div>
      <div className="slide-side">
        <Stat stat={slide.stat} />
        {image && <img className="slide-image" src={image.dataUrl} alt="" />}
      </div>
    </div>
  )
}

export function BigStat({ slide }) {
  return (
    <div className="slide-body layout-big-stat">
      <h1 className="slide-kicker">{slide.title}</h1>
      <Stat stat={slide.stat} className="slide-stat slide-stat--big" />
      {slide.bullets[0] && <p className="slide-caption">{slide.bullets[0]}</p>}
    </div>
  )
}

export function ImageFocus({ slide, image }) {
  return (
    <div className="slide-body layout-image-focus">
      <div className="layout-image-focus-head">
        <h1 className="slide-kicker">{slide.title}</h1>
        {slide.bullets[0] && <p className="slide-caption">{slide.bullets[0]}</p>}
      </div>
      {image && <img className="slide-image slide-image--focus" src={image.dataUrl} alt="" />}
    </div>
  )
}

export function Statement({ slide }) {
  return (
    <div className="slide-body layout-statement">
      <span className="statement-rule" aria-hidden="true" />
      <h1 className="slide-statement">{slide.title}</h1>
    </div>
  )
}

export function ThreeUp({ slide }) {
  return (
    <div className="slide-body layout-three-up">
      <h1 className="slide-title">{slide.title}</h1>
      <ol className="three-up-cols">
        {slide.bullets.slice(0, 3).map((b, i) => (
          <li key={i}>
            <span className="three-up-num">{String(i + 1).padStart(2, '0')}</span>
            <span>{b}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export const LAYOUT_COMPONENTS = {
  'title-bullets': TitleBullets,
  split: Split,
  'big-stat': BigStat,
  'image-focus': ImageFocus,
  statement: Statement,
  'three-up': ThreeUp,
}

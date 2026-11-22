// Decides which layout a slide is actually drawn with.
// The agent asks for a layout, but it picks fast and can be wrong (big-stat with
// no number, three-up with two bullets). This is the safety net between its
// choice and the screen.
import catalog from './layouts.json'

export const LAYOUT_IDS = catalog.map((l) => l.id)
const KNOWN = new Set(LAYOUT_IDS)

export function resolveLayout(slide, image) {
  const requested = KNOWN.has(slide.layout) ? slide.layout : null
  if (requested && fits(requested, slide, image)) return requested
  return guessLayout(slide, image)
}

// Does this slide's content suit the layout the agent asked for?
// Return false to drop the agent's choice and use guessLayout() instead.
//   slide.bullets: string[] (0-3)   slide.stat: {value, label} | null
//   image: the uploaded image object, or null when the slide has none
function fits(layout, slide, image) {
  // TODO(you): one rule per layout. See layouts.json "needs" for the intent.
  return true
}

// Used when the agent sent no layout, or one that didn't fit.
// Matches how slides looked before layouts existed.
function guessLayout(slide, image) {
  if (image || slide.stat) return 'split'
  return 'title-bullets'
}

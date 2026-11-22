// How eagerly the screen follows the conversation.
// The agent may call show_slide as often as it likes; this decides how much of
// that reaches the screen. It sits in the browser, so it works the same whatever
// backend sends the slides.
//
//   holdMs       a slide stays up at least this long. A new slide that arrives
//                sooner waits, and only the newest waiting one is shown when the
//                hold ends (so the screen never flickers but never ends up stale).
//   sameTitleMs  a slide with the same title as the one showing is ignored for
//                this long (the agent re-sending what's already up).
//   toast        whether "Noted for follow-up" pops up. The question is recorded
//                for the follow-up email either way.
//
// Tune the numbers here; nothing else needs to change.
export const LEVELS = {
  calm: { label: 'Calm', holdMs: 12000, sameTitleMs: 30000, toast: false },
  normal: { label: 'Normal', holdMs: 5000, sameTitleMs: 6000, toast: true },
  lively: { label: 'Lively', holdMs: 1500, sameTitleMs: 3000, toast: true },
}

export const LEVEL_IDS = Object.keys(LEVELS)
export const DEFAULT_LEVEL = 'normal'

export function levelOf(id) {
  return LEVELS[id] ?? LEVELS[DEFAULT_LEVEL]
}

const norm = (s) => String(s ?? '').trim().toLowerCase()

// What to do with a new slide, given the one on screen.
//   'show'   put it up now
//   'wait'   too soon after the last one: hold it for `waitMs`, then show it
//   'skip'   same slide is already showing
export function gateSlide(lastSlide, nextTitle, nowMs, level) {
  if (!lastSlide) return { action: 'show' }
  const sinceLast = nowMs - Date.parse(lastSlide.at)
  if (norm(lastSlide.title) === norm(nextTitle) && sinceLast < level.sameTitleMs) return { action: 'skip' }
  if (sinceLast < level.holdMs) return { action: 'wait', waitMs: level.holdMs - sinceLast }
  return { action: 'show' }
}

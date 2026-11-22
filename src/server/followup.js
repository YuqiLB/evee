// Actions: draftFollowup, sendFollowup. Signature (args, context) matches Wasp.
// The draft is templated from what happened in the session (no LLM on the server);
// the agent's own summary, written during the call, is included as-is.
import { httpError } from './session.js'

// Copy from SPEC.md is still placeholder text.
const SUBJECT = '[email subject]'
const INTRO = '[email intro]'

export function buildDraft(session) {
  const transcript = asArray(session.transcript)
  const slides = asArray(session.slides)
  const openQuestions = asArray(session.openQuestions)

  // Every question the agent reacted to: each show_slide trigger (including ones
  // dropped by the 6 s dedupe) and each log_followup question. The client records
  // them as transcript rows with role "question".
  const questions = transcript.filter((t) => t.role === 'question').map((t) => t.text)

  const lines = [INTRO, '']
  if (session.summary) lines.push(session.summary, '')
  if (questions.length) lines.push('Questions', ...questions.map((q) => `- ${q}`), '')
  if (slides.length)
    lines.push(
      'Slides shown',
      ...slides.flatMap((s) => [`- ${s.title}`, ...asArray(s.bullets).map((b) => `    · ${b}`)]),
      '',
    )
  if (openQuestions.length)
    lines.push('Open questions', ...openQuestions.map((o) => `- ${o.question}`), '')

  return {
    to: session.email ?? '',
    subject: SUBJECT,
    text: lines.join('\n').trim(),
    questions,
    slides: slides.map((s) => ({ id: s.id, title: s.title })),
    openQuestions: openQuestions.map((o) => o.question),
    summary: session.summary,
    status: session.status,
  }
}

export async function draftFollowup({ sessionId }, context) {
  return buildDraft(await getSession(sessionId, context))
}

// Approve-and-send. With Alter keys: Resend is called through Alter's proxy, which
// holds the Resend credential and may freeze the call until a human approves it.
// Without keys: a logged dry run, so the demo flow works end to end.
export async function sendFollowup({ sessionId, email }, context) {
  let session = await getSession(sessionId, context)
  if (email) session = await context.entities.Session.update({ where: { id: sessionId }, data: { email } })
  if (!session.email) throw httpError(400, 'email required')

  const draft = buildDraft(session)
  const payload = {
    from: process.env.FROM_EMAIL || 'evee <onboarding@resend.dev>',
    to: [draft.to],
    subject: draft.subject,
    text: draft.text,
  }

  const { ALTER_API_KEY, ALTER_RESEND_GRANT_ID } = process.env
  if (!ALTER_API_KEY || !ALTER_RESEND_GRANT_ID) {
    console.log('[dry-run] follow-up not sent (Alter keys missing). Payload:\n' + JSON.stringify(payload, null, 2))
    await setStatus(sessionId, 'sent', context)
    return { status: 'sent', dryRun: true }
  }

  const { App } = await import('@alter-ai/alter-sdk')
  const alter = new App({ apiKey: ALTER_API_KEY, caller: 'evee' })
  try {
    const res = await alter.proxyRequest({
      method: 'POST',
      url: 'https://api.resend.com/emails',
      grantId: ALTER_RESEND_GRANT_ID,
      json: payload,
      reason: `evee follow-up to ${draft.to}`,
    })
    // PendingApproval has status "pending": Alter is holding the call for a human.
    if ('status' in res && res.status === 'pending') {
      await setStatus(sessionId, 'held', context)
      return { status: 'held', approvalUrl: res.approvalUrl }
    }
    const ok = res.statusCode >= 200 && res.statusCode < 300
    await setStatus(sessionId, ok ? 'sent' : 'failed', context)
    return ok ? { status: 'sent' } : { status: 'failed', error: `Resend returned ${res.statusCode}` }
  } catch (err) {
    console.error('[sendFollowup] Alter error', err)
    await setStatus(sessionId, 'failed', context)
    return { status: 'failed', error: err.message }
  }
}

async function getSession(sessionId, context) {
  if (!sessionId) throw httpError(400, 'sessionId required')
  const session = await context.entities.Session.findUnique({ where: { id: sessionId } })
  if (!session) throw httpError(404, 'session not found')
  return session
}

function setStatus(id, status, context) {
  return context.entities.Session.update({ where: { id }, data: { status } })
}

function asArray(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return []
    }
  }
  return []
}

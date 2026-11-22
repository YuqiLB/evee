// Actions: startSession, saveSession. Signature (args, context) matches Wasp.

// Creates the Session row and hands the browser what it needs to open the agent:
// a short-lived signed URL (private agent, API key stays here) or, without a key,
// the agent id of a public agent. The API key itself never leaves the server.
export async function startSession(_args, context) {
  const agentId = process.env.ELEVENLABS_AGENT_ID
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!agentId) throw httpError(400, 'ELEVENLABS_AGENT_ID is not set in .env.server')

  const session = await context.entities.Session.create({ data: {} })

  if (!apiKey) return { sessionId: session.id, agentId }

  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`
  const res = await fetch(url, { headers: { 'xi-api-key': apiKey } })
  if (!res.ok) throw httpError(502, `ElevenLabs signed URL failed (${res.status})`)
  const { signed_url } = await res.json()
  return { sessionId: session.id, signedUrl: signed_url }
}

// Persists what the browser collected during the pitch. Creates the row if the
// agent never connected (e.g. mic denied), so the follow-up still works.
export async function saveSession(args, context) {
  const { sessionId, transcript, slides, openQuestions, email, summary } = args
  const data = {
    ...(transcript && { transcript }),
    ...(slides && { slides }),
    ...(openQuestions && { openQuestions }),
    ...(email !== undefined && { email: email || null }),
    ...(summary !== undefined && { summary }),
  }
  const saved = sessionId
    ? await context.entities.Session.update({ where: { id: sessionId }, data })
    : await context.entities.Session.create({ data })
  return { sessionId: saved.id }
}

export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

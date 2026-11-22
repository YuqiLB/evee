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

// Persists what the browser collected during the pitch.
export async function saveSession(args, context) {
  const { sessionId, transcript, slides, openQuestions, email, summary } = args
  if (!sessionId) throw httpError(400, 'sessionId required')
  return context.entities.Session.update({
    where: { id: sessionId },
    data: {
      ...(transcript && { transcript }),
      ...(slides && { slides }),
      ...(openQuestions && { openQuestions }),
      ...(email !== undefined && { email }),
      ...(summary !== undefined && { summary }),
    },
  })
}

export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

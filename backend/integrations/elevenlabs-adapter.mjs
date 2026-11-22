// Use in the browser with a session WebSocket. No API keys belong here.
export function createElevenLabsAdapter({sessionId, send, initialSeq = 0, includeAgent = false}) {
  let seq = initialSeq;
  const seen = new Set();
  const prefix = crypto.randomUUID();
  let turn = 0;

  function forward(text, speaker, eventId) {
    if (typeof text !== 'string' || !text.trim()) return null;
    if (text.length > 6000) throw new Error('Split transcript messages into segments of at most 6000 characters.');
    const id = eventId == null ? `${prefix}:${++turn}` : `${speaker}:${eventId}`;
    if (seen.has(id)) return null;
    const event = {
      v: 1, type: 'transcript.committed', event_id: id, session_id: sessionId, seq: seq++,
      payload: {segment_id: id, text, speaker_id: speaker}
    };
    send(JSON.stringify(event));
    seen.add(id);
    return event;
  }

  return {
    // Call when SessionHub connects, including after a reconnect, before forwarding.
    onEeveeMessage(event) {
      if (event.type === 'session.connected' && event.session_id === sessionId &&
          Number.isSafeInteger(event.payload?.next_seq)) {
        seq = Math.max(seq, event.payload.next_seq);
      }
    },
    // Raw ElevenLabs WebSocket events.
    onNativeEvent(event) {
      if (event.type === 'user_transcript') {
        const data = event.user_transcription_event;
        return forward(data?.user_transcript, 'user', data?.event_id);
      }
      if (includeAgent && event.type === 'agent_response') {
        const data = event.agent_response_event;
        return forward(data?.agent_response, 'agent', data?.event_id);
      }
      return null;
    },
    // The ElevenLabs JavaScript SDK's onMessage callback.
    onSdkMessage(message) {
      if (message.source === 'user') return forward(message.message, 'user', message.event_id);
      if (includeAgent && message.source === 'ai') return forward(message.message, 'agent', message.event_id);
      return null;
    }
  };
}

# App and ElevenLabs integration

The Worker now supports ElevenLabs Agents signed URLs. This is an Agent integration,
not the separate Scribe transcription product. Audio flows between the browser and
ElevenLabs. Cloudflare receives normalized text when the frontend forwards it.

## Signed connection URL

The trusted app backend calls either:

- `POST /v1/elevenlabs/signed-url` for a standalone pitch app connection.
- `POST /v1/sessions/:id/elevenlabs` for a listening Cloudflare dataset session.

Both require `Authorization: Bearer $APP_API_KEY`. The response is
`{agent_id, signed_url, session_id?}`. Return only the temporary signed URL to the
browser, then use `Conversation.startSession({signedUrl, connectionType: "websocket"})`.
Never put APP_API_KEY or ELEVENLABS_API_KEY in public frontend code.

The separate pitch app's `/api/startSession` handler can map `signed_url` to
`signedUrl` in its existing response. Its session persistence and client tools
remain that application's responsibility.

## Forward transcripts to a Cloudflare dataset session

1. Create/process a dataset and wait until it is ready.
2. Create a session and request `/v1/sessions/:id/stream-token` through the app backend.
3. Open the returned WebSocket path. Wait for `session.connected`.
4. Create the browser adapter from `integrations/elevenlabs-adapter.mjs`.
5. Pass the session.connected event to `adapter.onEeveeMessage(event)` before
   forwarding transcripts, including after each reconnect.
6. Send SDK `onMessage` callbacks to `adapter.onSdkMessage(message)`, or raw
   ElevenLabs frames to `adapter.onNativeEvent(event)`. Use one source per stream.

```js
const adapter = createElevenLabsAdapter({
  sessionId,
  send: frame => eeveeSocket.send(frame)
});
eeveeSocket.addEventListener('message', event => {
  adapter.onEeveeMessage(JSON.parse(event.data));
});
// Pass message => adapter.onSdkMessage(message) as the SDK onMessage callback.
// Start the agent only after the session.connected event has arrived.
```

User transcripts become `transcript.committed`. Agent speech is excluded by default;
set `includeAgent: true` to include it in the saved transcript. No artificial partial
results are created because Agent user_transcript events represent completed turns.
Provider event IDs are deduplicated when available. This is not a durable replay queue.

The adapter resumes sequence numbers from `session.connected.payload.next_seq`.
Segment/event IDs must be unique within the session, and sequence numbers strictly
increase across reconnects. Only one transcript-producing connection should own
sequencing for a session; observer connections can receive card updates.

## Cloudflare output events

| Event | App behavior |
|---|---|
| `session.connected` | Ready; initialize/resume transcript sequencing |
| `context.update` | Replace visible cards with payload.items |
| `context.clear` | Remove visible cards |
| `context.no_change` | Leave cards unchanged |
| `conversation.end_candidate` | End suggestion only; app explicitly ends the session |
| `context.error` | Keep connection open; try again on the next transcript |

Cards are `{id,type,title,text,image?,source}`. Image paths require authenticated
fetch through the app backend. A speaker turn ending never means the meeting ended.

To finish, call `POST /v1/sessions/:id/end` without a body, then poll the job or
summary endpoint. The backend saves the summary and does not send email.

Official ElevenLabs reference:
https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets

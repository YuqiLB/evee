# Learning evee

A map of the code, how a spoken question becomes a slide, the 5 ideas the app is built on, and 3 small exercises.

## File map

```
SPEC.md                     source of truth (features, screens, copy, "Done when")
package.json                `npm run dev` = Express server + Vite client, one command
vite.config.js              React, /api proxy → :3001, envPrefix that no secret uses
index.html                  loads Inter + src/client/main.jsx
schema.prisma, migrations/  Session table (SQLite file dev.db)
.env.server.example         every key, all optional in dev

server/index.js             Express: POST /api/<action> → src/server/*.js (Wasp-shaped)
src/server/session.js       startSession (signed URL / agent id), saveSession
src/server/followup.js      buildDraft, draftFollowup, sendFollowup (Alter or [dry-run])

src/client/main.jsx         React root
src/client/App.jsx          ConversationProvider above all screens + screen switch
src/client/state.js         tiny external store (browser memory)
src/client/api.js           callAction(name, args) → fetch /api/name
src/client/lib/context.js   uploads → context pack (pdf.js text + page images), serializePack
src/client/lib/agent.js     client tools (show_slide, log_followup, capture_email), dedupe, useEveeAgent
src/client/screens/Setup.jsx     dropbox, textbox, file list, start
src/client/screens/Pitch.jsx     slide stage, listening dot, toast, end / Esc, mic + agent errors
src/client/screens/Followup.jsx  email field, draft preview, approve-and-send
src/client/components/Slide.jsx  the fixed 1280×720 slide template, scaled to fit
src/client/components/Toast.jsx  "Noted for follow-up"
src/client/styles.css       SPEC tokens

agent/prompt.md             dashboard settings + system prompt (paste into ElevenLabs)
agent/tools.json            client tool schemas (paste into ElevenLabs)
prompts/wasp-wsl-port.md    prompt for the later move to Wasp in WSL2
samples/sample-pitch.pdf    2-page test PDF
```

## From a spoken question to a rendered slide

```
visitor: "How much does it cost?"
  │  mic audio streams to ElevenLabs (WebSocket/WebRTC, opened by useEveeAgent.start)
  ▼
ElevenLabs agent: speech-to-text → built-in LLM reads the system prompt + {{context_pack}}
  │  the LLM decides "the pack answers this" and emits a client tool call
  ▼
show_slide({ trigger, title, bullets, stat, imageId, sourceIds })   ← schema: agent/tools.json
  │  the SDK in the browser routes it to the handler registered with
  │  useConversationClientTool('show_slide', …)                   ← src/client/lib/agent.js
  ▼
toolHandlers.show_slide(args)
  │  cleans the args (bullets ≤ 3, ≤ 12 words; imageId must exist)
  │  shouldShowSlide(): drop it if the title is the same within 6 s
  │  store.setState({ slides: [...slides, slide] })               ← src/client/state.js
  ▼
<Pitch> re-renders (useStore) → <SlideStage slide image>        ← src/client/components/Slide.jsx
```

The server is not involved here at all. Speed comes from three things: the LLM's choice of tool, `expects_response: false`, and a purely local render.

## 5 key concepts

1. **Client tools.** The voice agent "acts" by calling functions that run in *your* browser. The schemas live in `agent/tools.json`, the handlers in `toolHandlers` in `src/client/lib/agent.js`, and `useConversationClientTool` connects them. Whatever a handler returns goes back to the agent as the tool result.
2. **Dynamic variables (the context pack).** `serializePack()` in `src/client/lib/context.js` turns the uploads into text with ids (`c1`, `i1`). `startSession` passes that text as `dynamicVariables: { context_pack }`, and it replaces `{{context_pack}}` in `agent/prompt.md`. Images stay in the browser; the agent sees only their ids and page text.
3. **Server actions.** The browser calls `callAction('startSession')` (`src/client/api.js`). `server/index.js` routes the call to `startSession(args, context)` in `src/server/session.js`. This is Wasp's operation shape, so a later port only has to re-declare the actions.
4. **Secrets stay server-side.**
   - `ELEVENLABS_API_KEY` is used only in `startSession` to mint a short-lived **signed URL**.
   - Alter holds the Resend key (`sendFollowup` in `src/server/followup.js`).
   - `vite.config.js` sets `envPrefix: 'EVEE_PUBLIC_'`, so nothing from `.env.server` can reach the bundle. `npm run build` followed by a grep of `dist/` confirms it.
5. **Approval-gated send (Alter).** `alter.proxyRequest({ method, url, grantId, json })` either runs the call or returns a `PendingApproval` (`status: 'pending'`, `approvalUrl`). evee maps these to the Session statuses `sent`, `held` and `failed`. With no keys, it logs `[dry-run]` and records `sent`.

## How to test without a mic

In dev, the browser console exposes the same handlers the agent calls:

```js
__evee.toolCall('show_slide', { trigger: 'Pricing?', title: 'Simple pricing', bullets: ['$49 per month'], stat: { value: '$49', label: 'per month' }, sourceIds: ['c1'] })
__evee.toolCall('log_followup', { question: 'Do you integrate with Salesforce?' })
__evee.toolCall('capture_email', { email: 'jo@example.com', summary: '...' })
__evee.state()
```

## 3 exercises

1. **Tune the dedupe** (`shouldShowSlide`, `src/client/lib/agent.js`). Right now a second `show_slide` with the same title within 6 s is dropped. Change it so a call with the same title but *more* bullets replaces the current slide instead of being dropped. Test with two `__evee.toolCall('show_slide', …)` calls.
2. **Chunk size vs. answer quality** (`CHUNK_CHARS`, `src/client/lib/context.js`). Drop `samples/sample-pitch.pdf` with the size set to 600, then to 150, and compare `__evee.state().chunks`. Smaller chunks give more precise `sourceIds` but split numbers from their labels. Which would you pick for a 20-page deck, and why?
3. **Show the source on the slide.** `slide.sourceIds` is stored but not shown. In `Slide.jsx`, add a tiny muted footer such as `deck.pdf p3`, looked up from `chunks` and `images` in the store. Keep it at 14px and #6B6B6B so it doesn't compete with the content.

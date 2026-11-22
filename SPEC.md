# evee: Spec v1

## One-liner
evee listens while a founder pitches and, within 5 seconds, puts up a slide composed from the founder's own uploaded material to match what is being said; afterwards it collects the visitor's email and sends a follow-up built from the exact questions and conversation.

## Users and core jobs
- **Founder (operator):** uploads pitch material, presents, approves the follow-up.
- **Visitor (stranger):** asks questions during the pitch, gives their email at the end.

## v1 features
1. **Upload context.** Drop PDFs, images and text files; type extra facts in a textbox. Check: each file appears in the list; the browser console logs the number of text chunks and images extracted.
2. **Listen.** Starting the pitch opens a live ElevenLabs Agent session that hears the room. Check: the listening indicator turns on after mic permission.
3. **Compose a slide in under 5 seconds.** When a question or a new topic comes up, the agent calls the `show_slide` client tool with content drawn only from the uploads; the browser renders it into a fixed slide template. Check: asking aloud a question that the uploads answer shows a matching slide (title, bullets, stat or image from the uploads) within 5 s of the question ending.
4. **Log what it can't answer.** If the uploads don't answer it, the agent calls `log_followup` instead of inventing content. Check: an off-topic question shows "Noted for follow-up" and no slide.
5. **Capture email.** Ending the pitch makes the agent ask for the visitor's email aloud and spell it back; a typed field is the fallback. Check: the email appears on the follow-up screen either way.
6. **Send the follow-up.** The server drafts an email from the session's questions, slides and open questions; the founder approves; it is sent through Alter. Check: the draft lists every question asked; after approval the send is recorded (or logged as a dry run when keys are missing).

## Out of scope for v1
PPTX or Google Slides import · AI image generation · editing slides by hand · login and accounts · saving sessions between restarts · CRM sync · Fiber AI and Maritime (stretch, after v1) · analytics.

## Screens
### Setup
- Purpose: load the pitch material.
- Components: dropbox, textbox, file list, start button.
- States: empty (dropbox only) / loading (extracting files) / error (unsupported or unreadable file) / filled (files listed, start enabled).

### Pitch (full screen)
- Purpose: show the current slide while evee listens.
- Components: slide stage, listening indicator, "Noted for follow-up" toast, end button (also `Esc`).
- Slide template: title, up to 3 bullets (≤ 12 words each), optional stat (value + label), optional image from the uploads.
- States: empty (first page of the first PDF, or a blank title slide) / loading (connecting to the agent) / error (mic denied or agent disconnected, with retry) / filled (latest composed slide).

### Follow-up
- Purpose: capture the email and approve the follow-up.
- Components: email field, draft preview (questions, slides shown, open questions), approve-and-send button.
- States: empty (waiting for email) / loading (drafting or sending) / error (send failed or held by Alter) / filled (sent).

## Data model
| Entity | Fields (type) | Stored in |
|---|---|---|
| ContextChunk | id (string), source (string), page (number), text (string) | browser memory |
| ContextImage | id (string), source (string), page (number), dataUrl (string) | browser memory |
| Slide | id (string), at (ISO string), trigger (string), title (string), bullets (string[]), stat ({value, label} \| null), imageId (string \| null), sourceIds (string[]) | browser memory, then server |
| OpenQuestion | question (string), at (ISO string) | browser memory, then server |
| Session | id (string), startedAt (DateTime), transcript (Json: {role, text, at}[]), slides (Json: Slide[]), openQuestions (Json: OpenQuestion[]), email (String?), summary (String), status (String: "draft" \| "held" \| "sent" \| "failed") | Prisma entity, SQLite in dev |

## Stack and structure
- Stack: Wasp (React client + Node server + Prisma, runs in WSL2 on Windows), `@elevenlabs/react` (agent session with client tools), `pdfjs-dist` (PDF text and page images in the browser), `@alter-ai/alter-sdk` (approval-gated send), Resend (email delivery behind Alter). No Wasp auth.
- How a slide is made in under 5 s:
    1. On upload, the browser builds a context pack: text chunks with ids, and images with ids and the text of the page they came from.
    2. At pitch start, the client calls the Wasp action `startSession` (returns a signed URL and session id) and starts the agent with the context pack as the dynamic variable `{{context_pack}}`.
    3. The agent stays silent (skip turn) and acts only through client tools: `show_slide({trigger, title, bullets, stat, imageId, sourceIds})` and `log_followup({question})`. Use the fastest LLM option in the agent settings.
    4. The client renders the tool arguments into the slide template locally; there is no server round trip. Ignore a `show_slide` call that arrives within 6 s of the last one, unless its title is different.
- Folder layout:
  ```
  main.wasp          app, routes/pages (Setup, Pitch, Follow-up), actions (startSession, saveSession, draftFollowup, sendFollowup)
  schema.prisma      Session entity
  src/client/        screens, components, lib/context.js (context pack), lib/agent.js (ElevenLabs session + client tools)
  src/server/        actions: session.js, followup.js (draft + Alter/Resend send)
  agent/             prompt.md (system prompt) and tools.json (client tool schemas), pasted into the ElevenLabs dashboard
  .env.server.example   ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ALTER_API_KEY, RESEND_API_KEY, FROM_EMAIL
  ```
- Run with: `wasp db migrate-dev` once, then `wasp start` (inside WSL2).

## Design direction
- References: none. The base screen is just a dropbox and a small textbox.
- Feel: clean, quiet, fast.
- Avoid: dashboards, sidebars, decorative illustrations, extra panels or text.
- Tokens: background #FFFFFF, text #111111, muted text #6B6B6B, border #E5E5E5, accent #2F6BFF, error #D92D20; font Inter with system-ui fallback; type scale 14 / 16 / 24 / 40 / 64 px (slide title 64, slide bullets 32); spacing 4 / 8 / 16 / 24 / 48 px; radius 12 px. Light mode only.

## Copy
- App name: evee
- Toast: Noted for follow-up
- Setup heading: [setup heading]
- Dropbox prompt: [dropbox prompt]
- Textbox placeholder: [textbox placeholder]
- Start button: [start button label]
- Unsupported file error: [file error message]
- Listening indicator: [listening label]
- Mic denied error: [mic error message]
- End button: [end button label]
- Email field label: [email label]
- Approve button: [approve button label]
- Sent confirmation: [sent message]
- Agent's email request (spoken): [email request line]
- Follow-up email subject and body intro: [email subject], [email intro]

## Learning goals
- How a client tool call from the voice agent becomes a rendered slide (tool schema → React state → template).
- Building the context pack from uploads (pdf.js text and page images).
- Keeping secrets server-side: signed URL for the agent, Alter for the send.

## Assumptions
- The agent hears both founder and visitor, without telling them apart; it reacts to questions and clear topic changes, not to every sentence.
- "Generating" a slide means composing it from uploaded text and images, never AI image generation.
- The ElevenLabs Agent's built-in LLM chooses the slide content and writes the summary passed to the follow-up; no Claude API key is needed.
- Email goes through Resend, called via Alter's `proxy_request` with approval required; without keys the send is a logged dry run.
- One pitch session at a time on the device.

## Done when
1. `wasp start` runs client and server with one command, with no console errors.
2. Dropping a PDF lists it, and its text and page images are extracted.
3. Starting the pitch turns on the listening indicator.
4. A spoken question the uploads answer shows a matching composed slide within 5 s.
5. An off-topic question shows "Noted for follow-up" and creates no slide.
6. Ending the pitch makes the agent ask for the email; voice or typed entry both fill the email field.
7. The follow-up draft lists every question, slide and open question from the session; approving sends it through Alter, or logs a dry run when keys are missing.
8. No API key appears in the client bundle; `.env.server.example` lists every key.
9. LEARNING.md exists.

# Prompt: port evee from Vite + Express to Wasp (in WSL2)

Paste everything below the line into a fresh Claude Code session opened in `C:\Users\bondl\ElevenHackathon`.

---

You're porting **evee** (see `SPEC.md`, which is the source of truth) from its v1 stack to Wasp, the stack the spec names.
- **v1 stack:** React + Vite client, Express server, Prisma + SQLite. It runs natively on Windows with `npm run dev`.
- **Target:** Wasp (React + Node + Prisma), running inside WSL2.

The app's behaviour must not change.

## Constraints
- There is no Claude API key. The ElevenLabs Agent's built-in LLM does all the reasoning, and slides are rendered in the browser from the `show_slide` client tool arguments.
- Keys stay on the server, in `.env.server`. Nothing secret may end up in the client bundle. `.env.server.example` lists every key.
- When the Alter keys are missing, the follow-up send must still be a logged dry run.
- Keep the UI minimal: a dropbox, a small textbox, and a slide stage. Add no extra text or elements.
- Use only copy from `SPEC.md`; anything else stays a `[placeholder]`.

## Step 1 — environment (timebox: 10 minutes, then stop and report)
State as found on 2026-11-22:
- WSL2 is running with Ubuntu 26.04 (`wsl --status`).
- **Wasp is not installed** inside WSL.
- **Linux Node is not installed** either. The only `npm` on the WSL PATH is Windows' `/mnt/c/Program Files/nodejs/npm`, and Wasp can't use it.
- Recent Wasp releases need Node ≥ 24.14.1 on the Linux side.

Run these inside WSL (`wsl -d Ubuntu`):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh && nvm install 24 && nvm alias default 24
which node npm            # both must be under ~/.nvm, not /mnt/c
curl -sSL https://get.wasp.sh/installer.sh | sh
wasp version
```
If any step fails and you can't fix it within the timebox, stop and tell the user. v1 already works without Wasp.

## Step 2 — location
Try running from `/mnt/c/Users/bondl/ElevenHackathon` first, so the files stay where the team expects them.

Move the project to `~/evee` inside WSL and work there instead if either of these happens:
- `npm install` takes more than about 5 minutes.
- File watching or the SQLite database misbehaves on the `/mnt/c` mount (hot reload doesn't fire, or "database is locked").

Setting `CHOKIDAR_USEPOLLING=1` is an acceptable middle ground. Tell the user which option you picked.

## Step 3 — port map (v1 path → Wasp)
| v1 | Wasp |
|---|---|
| `server/index.js` (Express, `POST /api/:action`) | delete; declare `action startSession / saveSession / draftFollowup / sendFollowup` in `main.wasp` with `entities: [Session]` |
| `src/server/session.js`, `src/server/followup.js` | keep as-is: they already use the Wasp signature `(args, context)` and `context.entities.Session` |
| `src/client/api.js` `callAction('startSession', args)` | `import { startSession } from 'wasp/client/operations'` and call `startSession(args)` |
| `src/client/App.jsx` screen switch (`store.screen`) | either keep the single-page switch on one `route RootRoute { path: "/" }`, or split it into `/`, `/pitch`, `/followup` routes. Keep one `ConversationProvider` above all screens so the agent session survives Pitch → Follow-up |
| `schema.prisma` (root) | stays at the root (Wasp 0.15+ reads `schema.prisma`). If Wasp's pinned Prisma version doesn't support `Json` on SQLite (support arrived in 6.2), change `transcript`, `slides` and `openQuestions` to `String`, and `JSON.stringify` them in `saveSession`. `buildDraft` in `followup.js` already parses strings |
| `.env.server` / `.env.server.example` | same file names; Wasp reads `.env.server` natively. Drop `DATABASE_URL` for SQLite |
| `vite.config.js` (`envPrefix`, `/api` proxy) | not needed; Wasp only exposes `REACT_APP_*` to the client, and nothing evee needs has that prefix |
| `npm run dev` | `wasp db migrate-dev` once, then `wasp start` |
| `agent/`, `LEARNING.md`, `prompts/` | unchanged; update `LEARNING.md`'s file map afterwards |

There's also a dev-only hook, `window.__evee.toolCall(name, args)` in `src/client/lib/agent.js`, guarded by `import.meta.env.DEV`. Keep it, because it's how you test slides without a microphone.

## Step 4 — done when
- `wasp db migrate-dev` and then `wasp start` run the client and server with one command, with no console errors.
- Every item in the `SPEC.md` "Done when" list (1–9) still passes. Read `wasp start` in item 1 literally.
- Verify through the browser at 375 px and 1280 px wide.
  - Slides: `window.__evee.toolCall('show_slide', {...})`.
  - Toast: `window.__evee.toolCall('log_followup', {question: '...'})`.
  - Send: approving on the Follow-up screen without Alter keys prints `[dry-run]` in the server log.
- `grep` the built client (`.wasp/out/web-app/build` after `wasp build`) to confirm it contains no key values.
- Commit on a branch named `wasp-port`. Don't merge it.

Final message: what changed, anything that behaves differently from v1, and anything not done.

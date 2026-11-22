# Eevee proof-of-concept setup

Work from `/data/Downloads/eevee-system/cloudflare`. Use Node 24:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 24
cd /data/Downloads/eevee-system/cloudflare
npm run setup:local
npm run verify:elevenlabs
```

`setup:local` keeps existing real credentials, replaces placeholder service
secrets, and synchronizes the shared tokens into `../maritime/.env`. It never
prints credentials. ElevenLabs credentials live only in `.dev.vars`.

## 1. Deploy the Cloudflare backend

The D1, R2 and queue names in `wrangler.jsonc` already reference the existing
resources. This updates the existing `eevee` Worker. No new D1/R2/queues are needed.

```bash
npx wrangler whoami
# Only if not signed in:
npx wrangler login
npm run secrets:upload
npm run migrate:remote
npm run deploy
```

`secrets:upload` sends only the six needed credentials over stdin to Wrangler.
Resend credentials and email delivery are no longer used. In mock mode, only
the AI processing is simulated; the ElevenLabs connection always uses its real API.

## 2. Create the Maritime service

```bash
npm run package:maritime
```

1. Sign in at https://maritime.sh/login and create an agent named `eevee-ai`.
2. Choose a custom/Docker agent with a ZIP source. Upload
   `/data/Downloads/eevee-system/maritime-deploy.zip`. Its root contains the Dockerfile.
3. Add the five variables from `maritime/.env` in the agent's Env tab. Keep both
   `*_TOKEN` entries secret. Do not upload `.env` or paste it into chat.
4. Add `ANTHROPIC_API_KEY` (a Claude API key from https://platform.claude.com) as a
   secret in the Env tab. A Claude Pro/Max plan does not include API access.
5. Deploy. Keep the platform-injected `PORT`; the app binds `0.0.0.0:$PORT`.
6. Enable its public URL so Cloudflare can call it without Maritime login.
   All `/v1/*` processing routes still require `MARITIME_SERVICE_TOKEN`.
7. Copy the HTTPS URL from the Overview, then run:

```bash
npm run connect:maritime -- https://YOUR_AGENT_ID.mtm.sh
npm run deploy
```

`connect:maritime` verifies the authenticated `/v1/ready` configuration endpoint
before updating the origin and disabling mock AI. Readiness confirms required
environment variables exist; the first ingestion/context request verifies the
selected model and billing access. Model IDs default to `claude-opus-5-5` for document
ingestion/summaries and `claude-haiku-5-5` for live card selection.

Official setup details:
- https://maritime.sh/docs/frameworks/custom
- https://maritime.sh/docs/web-apps
- https://maritime.sh/docs/llm

## 3. Connect the app

The trusted app server calls `POST /v1/elevenlabs/signed-url` with the app bearer
key, then returns only `signed_url` to the browser. For a Cloudflare dataset
session, use `POST /v1/sessions/:id/elevenlabs` instead. This checks that the
session exists and is listening.

The pitch frontend described in the supplied PROTOCOL/WORKFLOW is a separate
application. Its `/api/startSession` handler can request the signed URL from
this Worker and map `signed_url` to its existing `signedUrl` field. Its existing
`show_slide` and `log_followup` client tools continue in that application.
No frontend files were present in this backend workspace.

See `APP_AND_ELEVENLABS_HANDOFF.md` for session transcript forwarding. Email
capture, drafting and sending are outside this backend's proof-of-concept flow.

## Local development

```bash
npm run migrate:local
npm run dev
```

In a second terminal:

```bash
curl http://127.0.0.1:8787/health
```

Only one dev server should bind port 8787. Stop the previous Wrangler process
before starting another from Konsole or VS Code.

Checks:

```bash
npm run check
npm test
```

# Eevee proof-of-concept progress

## Prepared and checked locally

- Existing Cloudflare bindings and dataset/session API.
- Authenticated ElevenLabs signed-URL endpoint and browser transcript adapter.
- Reconnect sequence initialization in SessionHub.
- Generated shared service secrets and matching Maritime environment.
- Maritime Docker service, readiness endpoint, and source-only deployment archive.
- Scripts for secrets upload, live-origin configuration, and deployment.
- Saved summaries without email delivery.
- TypeScript, seven Node integration tests, and Wrangler deployment build passed.

## Pending live setup

- Create the Maritime custom agent and enable model access.
- Add its service environment and deploy the container.
- Verify ElevenLabs credentials against the actual API.
- Upload Cloudflare secrets, apply remote migration, and deploy Worker.
- Connect Maritime and disable mock AI.
- Exercise a real document upload, speech session, and saved summary.
- Integrate the separate pitch frontend; its source is outside this workspace.

See SETUP.md for commands and APP_AND_ELEVENLABS_HANDOFF.md for the protocol.

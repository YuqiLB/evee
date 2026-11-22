# Eevee conversation intelligence backend

Cloudflare stores uploaded documents in R2 and metadata in D1, queues document
processing and summaries, and streams conversation cards through a Durable Object.
A custom Maritime service handles document extraction, card selection and summaries.
ElevenLabs Agent connections are authenticated server-side with temporary signed URLs.

**Current state:** local code/configuration prepared. Cloud deployment and live provider
verification are required. AI stays in mock mode until Maritime is configured.

Start with [docs/SETUP.md](docs/SETUP.md). Existing Cloudflare resources are Worker
`eevee`, D1 `d1-eevee`, R2 `r2-eevee`, Queue `queue-eevee`, and DLQ `queue-eevee-dlq`.
The Worker also uses the SQLite-backed `SessionHub` Durable Object.

## Proof-of-concept scope

- Dataset create, append, upload, versioned ingestion and job status.
- PDF, image, text, Markdown, CSV, JSON, DOCX, XLSX and PPTX ingestion.
- FTS5 candidate search with Maritime model selection and source references.
- Session WebSockets with signed stream tokens, committed transcripts and replacement cards.
- Maximum six visible cards, at most three with images.
- ElevenLabs signed-URL endpoint and browser transcript adapter.
- Final conversation summaries saved to D1. Email delivery is removed.

The supplied pitch frontend has a separate server and client-side slide tools.
It is not present in this directory; see the app handoff for its integration points.

## API

All `/v1` HTTP routes require `Authorization: Bearer $APP_API_KEY`, except the
WebSocket stream, which uses its own short-lived token. Keep the app API key in
trusted server code. Only the signed ElevenLabs URL and session stream token reach
the browser. Internal routes use a separate service token.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Public health and AI mode |
| POST | `/v1/elevenlabs/signed-url` | Temporary connection URL for the configured ElevenLabs Agent |
| POST | `/v1/datasets` | Create a dataset |
| GET | `/v1/datasets/:id` | Dataset status/version |
| POST | `/v1/datasets/:id/files` | Upload raw file bytes; Content-Type, Content-Length and X-Filename required |
| POST | `/v1/datasets/:id/process` | Queue pending file processing |
| GET | `/v1/jobs/:id` | Job state/result |
| POST | `/v1/sessions` | Start a session on a ready dataset |
| POST | `/v1/sessions/:id/elevenlabs` | Signed ElevenLabs URL for a listening session |
| POST | `/v1/sessions/:id/stream-token` | One-minute stream token |
| WS | `/v1/sessions/:id/stream?token=...` | Transcripts in, card updates out |
| POST | `/v1/sessions/:id/end` | Queue final summary; no request body needed |
| GET | `/v1/sessions/:id/summary` | Saved summary and session status |
| GET | `/v1/cards/:id/asset?dataset_id=...&version=...` | Private image bytes |

Maritime exposes public `/health`, authenticated `/v1/ready`, and authenticated
`/v1/ingest`, `/v1/context`, `/v1/summarize` routes. It never receives direct D1/R2
credentials. Original files and derived assets pass through Cloudflare internal routes.

## Limits

This is a single trusted app proof of concept. It does not yet implement per-user
identity/authorization, semantic vector search, transcript replay/acknowledgements,
or storage deletion/retention. Uploads are capped at 12 MiB and PDFs at 40 pages.
DOCX/PPTX extraction is primarily text. Local tests simulate Cloudflare bindings;
Wrangler and deployed end-to-end tests are still needed.

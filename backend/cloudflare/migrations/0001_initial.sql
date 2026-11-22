-- D1 / SQLite schema. Apply via wrangler d1 migrations apply d1-eevee --remote.
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  replaces_dataset_id TEXT,
  active_version INTEGER NOT NULL DEFAULT 0,
  processing_version INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','processing','ready','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  version_added INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_dataset ON files(dataset_id,version_added);
CREATE TABLE IF NOT EXISTS cards (
  card_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  version INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN('text','image','text_image')),
  title TEXT NOT NULL,
  body TEXT,
  image_key TEXT,
  hints_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  source_file_id TEXT NOT NULL REFERENCES files(id),
  source_page INTEGER,
  PRIMARY KEY(dataset_id,version,card_id)
);
CREATE INDEX IF NOT EXISTS idx_cards_dataset ON cards(dataset_id,version);
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  dataset_id UNINDEXED, version UNINDEXED, card_id UNINDEXED, search_text
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('ingest','finalize')),
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed')),
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  dataset_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'listening' CHECK(status IN('listening','finalizing','completed','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_dataset ON sessions(dataset_id);
CREATE TABLE IF NOT EXISTS transcript_segments (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  segment_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  speaker_id TEXT,
  text TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  PRIMARY KEY(session_id,segment_id)
);
CREATE INDEX IF NOT EXISTS idx_transcript_seq ON transcript_segments(session_id,seq);
CREATE TABLE IF NOT EXISTS summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('queued','accepted','delivered','bounced','complained','failed','skipped')),
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id,recipient)
);

CREATE TABLE IF NOT EXISTS email_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

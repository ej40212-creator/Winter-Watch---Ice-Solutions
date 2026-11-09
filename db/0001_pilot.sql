-- Private-pilot identity, review, and refresh schema.
-- Apply after drizzle/0000_greedy_apocalypse.sql. This file does not delete sites.

CREATE TABLE IF NOT EXISTS weather_cache (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  site_id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_site_id TEXT NOT NULL,
  source_site_id_raw TEXT NOT NULL,
  address TEXT NOT NULL,
  address_normalized TEXT NOT NULL,
  state TEXT NOT NULL,
  region TEXT NOT NULL,
  classification TEXT NOT NULL,
  status TEXT NOT NULL,
  operational INTEGER NOT NULL DEFAULT 0,
  merged_into_site_id TEXT,
  content_fp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sites_source_idx ON sites(source_site_id, state);
CREATE INDEX IF NOT EXISTS sites_fp_idx ON sites(content_fp);
CREATE INDEX IF NOT EXISTS sites_system_idx ON sites(source_system);

CREATE TABLE IF NOT EXISTS site_import_batches (
  batch_id TEXT PRIMARY KEY,
  source_file_sha256 TEXT NOT NULL UNIQUE,
  source_filename TEXT NOT NULL,
  sheet TEXT,
  imported_at TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  contract_version TEXT NOT NULL,
  source_system TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_source_rows (
  batch_id TEXT NOT NULL,
  provisional_key TEXT NOT NULL,
  excel_row INTEGER,
  source_site_id TEXT NOT NULL,
  content_fp TEXT NOT NULL,
  site_id TEXT,
  match_method TEXT NOT NULL,
  review_status TEXT NOT NULL,
  address TEXT NOT NULL,
  state TEXT NOT NULL,
  classification TEXT NOT NULL,
  PRIMARY KEY (batch_id, provisional_key)
);

CREATE TABLE IF NOT EXISTS site_review_queue (
  review_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  provisional_key TEXT,
  site_id TEXT,
  reason TEXT NOT NULL,
  detail TEXT,
  candidate_site_ids TEXT,
  dedupe_key TEXT NOT NULL,
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS site_review_open_dedupe
  ON site_review_queue(reason, dedupe_key)
  WHERE resolution IS NULL;

CREATE TABLE IF NOT EXISTS refresh_leases (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  cycle_id TEXT
);

CREATE TABLE IF NOT EXISTS refresh_cycles (
  cycle_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sites_due INTEGER NOT NULL DEFAULT 0,
  batch_limit INTEGER NOT NULL,
  ok_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS refresh_jobs (
  cycle_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  effect_token TEXT,
  PRIMARY KEY (cycle_id, site_id)
);

CREATE TABLE IF NOT EXISTS refresh_effects (
  effect_token TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_refresh_state (
  site_id TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER
);

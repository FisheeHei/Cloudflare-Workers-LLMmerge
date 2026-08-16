CREATE TABLE IF NOT EXISTS llmmerge_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

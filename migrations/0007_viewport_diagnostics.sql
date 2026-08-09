-- Temporary geometry traces for the mobile chat keyboard investigation.
-- No message content, user agent, or network identity is recorded.

CREATE TABLE viewport_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_path TEXT,
  captured_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  metrics TEXT NOT NULL
);

CREATE INDEX idx_viewport_diagnostics_received
  ON viewport_diagnostics (received_at);

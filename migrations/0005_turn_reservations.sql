-- One active model turn per anonymous conversation.
--
-- The reservation closes two races: parallel requests reading the same stale
-- history, and a follow-up arriving after the final token but before the prior
-- turn is durable. A stale timestamp lets the next request recover from an
-- isolate that disappeared without releasing its reservation.

ALTER TABLE conversations
  ADD COLUMN turn_status TEXT NOT NULL DEFAULT 'idle'
  CHECK (turn_status IN ('idle', 'active'));

ALTER TABLE conversations ADD COLUMN turn_started_at INTEGER;

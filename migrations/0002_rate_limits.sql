-- Per-caller request counter, as a backstop to the CHAT_RATE_LIMITER binding.
--
-- The binding turns away bursts but not a paced script: 40 sequential requests
-- against production all passed, because its counters do not span the isolates
-- a sequence of requests gets spread across. D1 has one primary, so a count
-- kept here is the same count for every request regardless of where it lands.
--
-- `id` is a truncated HMAC-SHA-256 of the caller's address and current day,
-- keyed by the dedicated RATE_LIMIT_KEY Worker secret. It is a counter key
-- rather than an address: a D1 reader cannot enumerate ordinary IPv4 values,
-- and the key stops matching new requests at midnight. Rows are swept hourly.

CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);

-- Chat persistence for the site assistant.
--
-- Deliberately minimal: a conversation is an opaque client-held id and its
-- messages. No IP addresses, user agents, or anything else that would turn an
-- anonymous question into a person — the transcript is the only thing worth
-- keeping, and it is the only thing kept.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  -- Bumped on every turn so per-conversation rate limiting can read one row
  -- instead of aggregating messages.
  last_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every read of a transcript is "this conversation, in order".
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

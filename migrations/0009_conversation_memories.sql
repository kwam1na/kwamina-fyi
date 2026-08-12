-- Rolling model memory for conversations whose durable transcript is longer
-- than the bounded verbatim context window.
CREATE TABLE conversation_memories (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
  content TEXT NOT NULL,
  summarized_through_id INTEGER NOT NULL,
  summarized_message_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_conversation_id ON messages (conversation_id, id);

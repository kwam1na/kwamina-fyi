-- Make transcript quality measurable without collecting visitor identity.
-- Conversation-level fields separate real site use from evaluation fixtures
-- and local development from deployed traffic. Assistant-message fields tie
-- each answer to the exact prompt, corpus, and model configuration that made
-- it, plus end-to-end generation latency.

ALTER TABLE conversations ADD COLUMN source TEXT NOT NULL DEFAULT 'site';
ALTER TABLE conversations ADD COLUMN environment TEXT;

ALTER TABLE messages ADD COLUMN assistant_version TEXT;
ALTER TABLE messages ADD COLUMN corpus_version TEXT;
ALTER TABLE messages ADD COLUMN model TEXT;
ALTER TABLE messages ADD COLUMN latency_ms INTEGER;

CREATE INDEX idx_conversations_source_last_message
  ON conversations (source, last_message_at);

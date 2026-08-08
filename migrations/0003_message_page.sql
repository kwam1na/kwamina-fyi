-- Which page the reader was on when they sent a message.
--
-- Without this, a transcript records that someone asked "what about this page?"
-- but not what "this page" was. Replaying that history to the model gives it a
-- conversation full of unattributed page talk, and a single system line naming
-- the current page loses to it: the model answers about whichever page the
-- previous turns discussed. Storing it per message makes every turn resolve
-- against the page it was actually asked from.
--
-- Only ever written from the server's own page table, never from the value the
-- browser reported, so this column cannot hold an arbitrary string.

ALTER TABLE messages ADD COLUMN page_path TEXT;

-- Ownership token for active turn reservations.
--
-- A generation that exceeds the stale timeout may be superseded. Requiring
-- this token on release and persistence prevents that older Worker instance
-- from clearing or appending through the replacement reservation.

ALTER TABLE conversations ADD COLUMN turn_token TEXT;

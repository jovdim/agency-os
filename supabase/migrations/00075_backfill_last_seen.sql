-- Cold-start backfill for profiles.last_seen_at.
--
-- Migration 00074 added the column but it stays NULL until each user
-- hits the middleware heartbeat on their next page nav. The super-admin
-- overview pages render that as "Never", which is misleading for staff
-- who haven't opened the app yet today. Seed from auth.users.last_sign_in_at
-- so everyone who's ever logged in shows a real timestamp; the heartbeat
-- takes over from there as people browse.

UPDATE profiles p
SET last_seen_at = u.last_sign_in_at
FROM auth.users u
WHERE p.id = u.id
  AND p.last_seen_at IS NULL
  AND u.last_sign_in_at IS NOT NULL;

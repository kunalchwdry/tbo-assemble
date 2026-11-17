-- Rollback of 2026-11-17-event-ownership.up.sql. Drops ONLY the two tables it created (and with them any ownership
-- grants and booking capabilities issued since). No existing table or row is touched. Deploy application code with
-- OWNER_SCOPE_API off (or a release without these models) before running it. Requires the same approval as the up step.
BEGIN;
DROP TABLE IF EXISTS "BookingAccess";
DROP TABLE IF EXISTS "EventMember";
COMMIT;

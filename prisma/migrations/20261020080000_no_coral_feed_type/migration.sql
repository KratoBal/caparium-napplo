-- Task caparium-hibak-1, item 4 (Balázs 2026-10-20 07:54 UTC, msg 1562011110079725631: "olyan hogy koralltáp nincs
-- külön, az az apró és folyékony takarmányban van benne"). DATA ONLY, no schema change.
--
-- The feeds of the KORALL type move to APRO ("Apró és folyékony takarmány"), one MASTER_CHANGE audit row each by the
-- System user, then the empty KORALL type is deleted (only feed.typeId points at feed_type, RESTRICT, so the delete
-- fails rather than orphan a feed). The basic data no longer lists KORALL, so a restart does not bring it back.
-- Where there is no KORALL type (a fresh database before its basic data) this changes nothing. A coral feed dose
-- (coral_feed_dose) belongs to the feed, not to the type: it stays with the moved feed.
-- ROLLBACK: a new migration recreating the type and moving the feeds named in these audit rows back.
WITH "korall" AS (
  SELECT "id" FROM "feed_type" WHERE "code" = 'KORALL'
), "apro" AS (
  SELECT "id" FROM "feed_type" WHERE "code" = 'APRO'
), "moved" AS (
  UPDATE "feed" SET "typeId" = (SELECT "id" FROM "apro")
  WHERE "typeId" IN (SELECT "id" FROM "korall") AND EXISTS (SELECT 1 FROM "apro")
  RETURNING "id"
)
INSERT INTO "audit_entry" ("userId", "action", "entityType", "entityId", "changes", "reason")
SELECT '00000000-0000-0000-0000-000000000001', 'MASTER_CHANGE', 'Feed', "id"::text,
       '{"type": {"before": "KORALL", "after": "APRO"}}'::jsonb,
       'Nincs külön koralltáp típus: az apró és folyékony takarmány része (caparium-hibak-1).'
FROM "moved";

DELETE FROM "feed_type" WHERE "code" = 'KORALL';

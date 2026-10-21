-- 6fe63c9b item 7 (Balázs approved the plan, acrobot 34486 "6. így jó"): until the zoo decides how coral feed is
-- dosed ("ezt még meg kell fejteni"), the coral feeds are a TICK on the feeding sheet (given or not), without a
-- quantity; the item form still takes a quantity.
--
-- feed.sheetTick, false for every feed; then true for the two coral feeds of the description's list, found by any
-- name they ever carried, one MASTER_CHANGE audit row each by the System user (R-12). Where they do not exist (a
-- fresh database before its basic data) only the column is added; the initial data creates them with the flag.
-- ROLLBACK: UPDATE "feed" SET "sheetTick" = false for the feeds named in these audit rows (the column may stay).
ALTER TABLE "feed" ADD COLUMN "sheetTick" BOOLEAN NOT NULL DEFAULT false;

WITH "ticked" AS (
  UPDATE "feed" SET "sheetTick" = true
  WHERE "id" IN (SELECT "feedId" FROM "feed_name" WHERE "name" IN ('RE+ Coral nutrition AB+', 'AF Power elixir'))
  RETURNING "id"
)
INSERT INTO "audit_entry" ("userId", "action", "entityType", "entityId", "changes", "reason")
SELECT '00000000-0000-0000-0000-000000000001', 'MASTER_CHANGE', 'Feed', "id"::text,
       '{"sheetTick": {"before": false, "after": true}}'::jsonb,
       'Koralltáp: a takarmánylapon pipa, mennyiség nélkül (6fe63c9b, 7. pont).'
FROM "ticked";

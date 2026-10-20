-- Task caparium-hibak-1, items 2 and 3 (Balázs 2026-10-20 07:51-07:53 UTC, msg 1562010379683364927 and
-- 1562010874733002755): the description's animals and feeds go onto the test system (src/lib/initial-data.ts,
-- loaded with the basic data, the animals only there), and the synthetic test master data the seed made there
-- steps aside. DATA ONLY.
--
-- Nothing is deleted (feeding rows, exports and audit_entry name these rows):
-- - the synthetic feeds become INACTIVE, as an admin's "Inaktiválás" does (src/lib/feeds.ts updateFeed), one
--   MASTER_CHANGE audit row each. "Litopenaeus vannamei" is not synthetic: the real list has it.
-- - the synthetic animals still alive get a RELEASE event now, by the System user, and their open placement and
--   membership close at the same instant: exactly what deriveLifecycle (src/lib/animals.ts) builds from a terminal
--   event, so a later rebuild gives the same rows. One CREATE audit row per event, as createLifecycleEvent writes.
--   An animal with a valid event at or after now is left alone (the release would not be its last event).
-- - the synthetic group becomes inactive.
-- Where these rows do not exist (a live system, a fresh CI or e2e database before its seed) this changes nothing.
-- The seed makes only MISSING synthetic rows (by name), so on the test system it does not bring them back.
-- ROLLBACK: an admin turns a feed back on in Beállítások, and invalidates the RELEASE event of an animal (its
-- placement comes back with the rebuild).
WITH "off" AS (
  UPDATE "feed" SET "active" = false
  WHERE "active" = true AND "id" IN (
    SELECT "feedId" FROM "feed_name"
    WHERE "name" IN ('Teszt kagyló', 'Teszt hal', 'Teszt tintahal', 'Teszt plankton', 'Teszt koralltáp')
  )
  RETURNING "id"
)
INSERT INTO "audit_entry" ("userId", "action", "entityType", "entityId", "changes", "reason")
SELECT '00000000-0000-0000-0000-000000000001', 'MASTER_CHANGE', 'Feed', "id"::text,
       '{"active": {"before": true, "after": false}}'::jsonb,
       'A szintetikus teszt-takarmányok helyett a leírás takarmánylistája (caparium-hibak-1).'
FROM "off";

WITH "target" AS (
  SELECT a."id" FROM "animal" a
  WHERE EXISTS (
      SELECT 1 FROM "animal_name" n
      WHERE n."animalId" = a."id" AND n."name" IN ('Teszt Egy', 'Teszt Kettő', 'Teszt Három', 'Teszt Négy')
    )
    AND EXISTS (SELECT 1 FROM "placement" p WHERE p."animalId" = a."id" AND p."validTo" IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM "lifecycle_event" e
      WHERE e."animalId" = a."id" AND e."status" = 'VALID'
        AND (e."type" IN ('DEATH', 'RELEASE') OR e."occurredAt" >= CURRENT_TIMESTAMP)
    )
), "released" AS (
  INSERT INTO "lifecycle_event" ("id", "animalId", "type", "occurredAt", "businessDay", "note", "requestId", "createdById", "updatedById")
  SELECT gen_random_uuid(), "id", 'RELEASE', CURRENT_TIMESTAMP, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Budapest')::date,
         'Szintetikus tesztállat: a leírás állatlistája váltja (caparium-hibak-1).',
         'migracio-szintetikus-kiadas-' || "id"::text,
         '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
  FROM "target"
  RETURNING "id", "animalId", "occurredAt", "note"
), "placements" AS (
  UPDATE "placement" SET "validTo" = CURRENT_TIMESTAMP
  WHERE "validTo" IS NULL AND "animalId" IN (SELECT "id" FROM "target")
  RETURNING 1
), "memberships" AS (
  UPDATE "animal_group_membership" SET "validTo" = CURRENT_TIMESTAMP
  WHERE "validTo" IS NULL AND "animalId" IN (SELECT "id" FROM "target")
  RETURNING 1
)
INSERT INTO "audit_entry" ("userId", "action", "entityType", "entityId", "changes", "requestId")
SELECT '00000000-0000-0000-0000-000000000001', 'CREATE', 'LifecycleEvent', "id"::text,
       jsonb_build_object(
         'animalId', jsonb_build_object('before', NULL, 'after', "animalId"::text),
         'type', jsonb_build_object('before', NULL, 'after', 'RELEASE'),
         'occurredAt', jsonb_build_object('before', NULL, 'after', to_char("occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
         'note', jsonb_build_object('before', NULL, 'after', "note")
       ),
       'migracio-szintetikus-kiadas-' || "animalId"::text
FROM "released";

UPDATE "animal_group" SET "active" = false
WHERE "active" = true AND "id" IN (SELECT "groupId" FROM "animal_group_name" WHERE "name" = 'Teszt csoport');

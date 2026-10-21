-- The ZIMS unit of ORP (task caparium-zims-millivolt; the zoo's answer to NY-01, 2026-10-21 09:15 UTC, Balázs in
-- the Cápárium thread, message_id 1562393801920745503: "milivolt a jó a zimsnek!"). The ZIMS sample file of the
-- description writes the unit "millivolt"; its table wrote "mV", and v1 followed the table until the trial import
-- decided (DN-05). DATA ONLY.
--
-- A CORRECTION, not a change (adatmodell K3): "mV" was never what ZIMS takes, so the current generic row of the
-- mV unit is fixed in place and acts on past measurements too (a re-export writes "millivolt" for them as well).
-- One MASTER_CORRECTION audit row, by the System user, as an admin's correction writes. A parameter-specific row,
-- or one an admin already set to something else, is left alone. Where the row does not exist (a fresh CI or e2e
-- database before its basic data) this changes nothing, and the basic data now creates "millivolt".
-- ROLLBACK: the same UPDATE back to 'mV'.
WITH "fixed" AS (
  UPDATE "zims_unit_name" SET "zimsUnit" = 'millivolt'
  WHERE "zimsUnit" = 'mV' AND "parameterId" IS NULL AND "validTo" IS NULL
    AND "unitId" IN (SELECT "id" FROM "unit" WHERE "symbol" = 'mV')
  RETURNING "id"
)
INSERT INTO "audit_entry" ("userId", "action", "entityType", "entityId", "changes", "reason")
SELECT '00000000-0000-0000-0000-000000000001', 'MASTER_CORRECTION', 'ZimsUnitName', "id"::text,
       '{"zimsUnit": {"before": "mV", "after": "millivolt"}}'::jsonb,
       'A ZIMS az ORP egységét "millivolt" alakban fogadja (az állatkert válasza, 2026-10-21).'
FROM "fixed";

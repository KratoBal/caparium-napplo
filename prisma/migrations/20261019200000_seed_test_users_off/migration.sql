-- Task caparium-tesztfiok-inaktivalas (acrobot 33258; Balázs 2026-10-19 21:31 UTC: the real users are in, the
-- three seed test accounts may go). DATA ONLY, no schema change.
--
-- The three seed accounts are DEACTIVATED, not deleted: four RESTRICT keys point at app_user (monogram, ZIMS name,
-- module permission, session), about 26 plain *ById columns name their rows, and audit_entry is append-only. An
-- inactive user cannot log in and has no live session (src/lib/auth.ts); the history keeps their names. The same
-- three steps an admin's "Inaktiválás" takes (src/lib/admin.ts updateUser): active=false with deactivatedAt, every
-- session gone, one MASTER_CHANGE audit row each, here by the System user.
--
-- Where they do not exist (a live system, a fresh CI or e2e database before its seed) this changes nothing. The
-- seed creates only MISSING users, so on the test system it does not bring them back.
-- ROLLBACK: an admin turns the account back on in Beállítások -> Felhasználók (it writes its own audit row).
WITH "off" AS (
  UPDATE "app_user"
  SET "active" = false, "deactivatedAt" = CURRENT_TIMESTAMP
  WHERE "loginId" IN ('teszt.admin', 'teszt.akvarista1', 'teszt.akvarista2') AND "active" = true AND "role" <> 'SYSTEM'
  RETURNING "id"
), "logged_out" AS (
  DELETE FROM "session" WHERE "userId" IN (SELECT "id" FROM "off")
  RETURNING 1
)
INSERT INTO "audit_entry" ("userId", "action", "entityType", "entityId", "changes", "reason")
SELECT '00000000-0000-0000-0000-000000000001', 'MASTER_CHANGE', 'User', "id"::text,
       '{"active": {"before": true, "after": false}}'::jsonb,
       'A seed tesztfiókjai a valódi felhasználók felvétele után inaktívak (caparium-tesztfiok-inaktivalas).'
FROM "off";

-- Lili 2026-10-29 (Caparium thread 1565358650732585063, Bálint's feedback; caparium-finomitas-1, item 3): on the small
-- tanks' daily measurement the Ragadozós and the Korallos rows change places. The ROW moves, the pool itself: its
-- measurements, units and name go with it, nothing is renamed. Only the two rows' places in the group are swapped
-- (Ragadozós first, Inkubátor stays second, Korallos last); a database without the group gets it from the basic data
-- (src/lib/base-data.ts) in the new order. Nothing else changes.
-- ROLLBACK: the same statement again (it swaps the two back).
WITH g AS (SELECT "id" FROM "measurement_group" WHERE "code" = 'NAPI_KIS'),
k AS (
  SELECT gm."id", gm."sortOrder" FROM "group_membership" gm JOIN "pool" p ON p."id" = gm."poolId" JOIN g ON g."id" = gm."groupId"
  WHERE p."code" = 'KORALLOS' AND gm."validTo" IS NULL
),
r AS (
  SELECT gm."id", gm."sortOrder" FROM "group_membership" gm JOIN "pool" p ON p."id" = gm."poolId" JOIN g ON g."id" = gm."groupId"
  WHERE p."code" = 'RAGADOZOS' AND gm."validTo" IS NULL
)
UPDATE "group_membership" gm
SET "sortOrder" = CASE WHEN gm."id" = (SELECT "id" FROM k) THEN (SELECT "sortOrder" FROM r) ELSE (SELECT "sortOrder" FROM k) END
WHERE gm."id" IN (SELECT "id" FROM k UNION ALL SELECT "id" FROM r)
  AND (SELECT count(*) FROM k) = 1 AND (SELECT count(*) FROM r) = 1;

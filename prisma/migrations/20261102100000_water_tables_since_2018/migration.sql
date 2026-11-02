-- Lili 2026-11-01 (point 14: every existing element gets the start of the history) and acrobot 2026-11-02 (39955): the water
-- tables reach back to 2018-12-07, as the pool periods do (20261101210000_pool_periods). On 2025-06-02 the daily table had no
-- rows and only the new SG column: its members and its built-in columns began on 2026-01-01.
--
-- Moved: the rows that began on 2026-01-01 00:00 Europe/Budapest (the base data's start) and are still open, to 2018-12-07
-- 00:00 Europe/Budapest. A row closed since, or one that began later, stays as it is; so does everything else of that thing.
-- Today every list shows what it showed before (a row open today stays open); only the days before 2026 get the tables, the
-- names, the ZIMS names and the references that stand today.
--
-- barracuda on #187: a row is moved only where the same thing (the table's own key) has no row beginning before 2026-01-01;
-- otherwise the two would overlap, and nothing (no unique or exclusion constraint) would stop it.
UPDATE "group_membership" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "group_membership" e WHERE e."groupId" IS NOT DISTINCT FROM t."groupId" AND e."poolId" IS NOT DISTINCT FROM t."poolId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "group_parameter" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "group_parameter" e WHERE e."groupId" IS NOT DISTINCT FROM t."groupId" AND e."parameterId" IS NOT DISTINCT FROM t."parameterId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "pool_name" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "pool_name" e WHERE e."poolId" IS NOT DISTINCT FROM t."poolId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "parameter_name" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "parameter_name" e WHERE e."parameterId" IS NOT DISTINCT FROM t."parameterId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "reference_range" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "reference_range" e WHERE e."parameterId" IS NOT DISTINCT FROM t."parameterId" AND e."poolId" IS NOT DISTINCT FROM t."poolId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "zims_parameter_name" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "zims_parameter_name" e WHERE e."parameterId" IS NOT DISTINCT FROM t."parameterId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "zims_unit_name" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "zims_unit_name" e WHERE e."unitId" IS NOT DISTINCT FROM t."unitId" AND e."parameterId" IS NOT DISTINCT FROM t."parameterId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "user_monogram" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "user_monogram" e WHERE e."userId" IS NOT DISTINCT FROM t."userId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

UPDATE "user_zims_name" t SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00'
WHERE t."validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND t."validTo" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "user_zims_name" e WHERE e."userId" IS NOT DISTINCT FROM t."userId" AND e."validFrom" < TIMESTAMPTZ '2025-12-31 23:00:00+00');

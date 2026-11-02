-- Lili 2026-11-01 (point 14: every existing element gets the start of the history) and acrobot 2026-11-02 (39955): the water
-- tables reach back to 2018-12-07, as the pool periods do (20261101210000_pool_periods). On 2025-06-02 the daily table had no
-- rows and only the new SG column: its members and its built-in columns began on 2026-01-01.
--
-- Moved: the rows that began on 2026-01-01 00:00 Europe/Budapest (the base data's start) and are still open, to 2018-12-07
-- 00:00 Europe/Budapest. A row closed since, or one that began later, stays as it is; so does everything else of that thing.
-- Today every list shows what it showed before (a row open today stays open); only the days before 2026 get the tables, the
-- names, the ZIMS names and the references that stand today.
UPDATE "group_membership"    SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "group_parameter"     SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "pool_name"           SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "parameter_name"      SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "reference_range"     SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "zims_parameter_name" SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "zims_unit_name"      SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "user_monogram"       SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;
UPDATE "user_zims_name"      SET "validFrom" = TIMESTAMPTZ '2018-12-06 23:00:00+00' WHERE "validFrom" = TIMESTAMPTZ '2025-12-31 23:00:00+00' AND "validTo" IS NULL;

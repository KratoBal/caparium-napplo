-- Lili 2026-11-01 (point 16): a pool's periods of use

-- CreateTable
CREATE TABLE "pool_period" (
    "id" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "firstDay" DATE NOT NULL,
    "lastDay" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pool_period_poolId_firstDay_idx" ON "pool_period"("poolId", "firstDay");

-- AddForeignKey
ALTER TABLE "pool_period" ADD CONSTRAINT "pool_period_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pool_period" ADD CONSTRAINT "pool_period_days" CHECK ("lastDay" IS NULL OR "lastDay" >= "firstDay");

-- Every pool gets a period from 2018-12-07, so today the same pools are in use (the hard condition of points 14 and 16). An active
-- pool's is open. An inactive pool's ends the day before it was switched off (its last "active: false" audit entry, Budapest day;
-- without one, the day before the migration): its old measurements and the animals placed then fall into it. The system user (R-12)
-- records it. Re-runnable: a pool with a period already gets none.
INSERT INTO "pool_period" ("id", "poolId", "firstDay", "lastDay", "createdById")
SELECT gen_random_uuid(), p."id", DATE '2018-12-07',
       CASE WHEN p."active" THEN NULL ELSE GREATEST(DATE '2018-12-07', COALESCE(
         (SELECT (max(a."at") AT TIME ZONE 'Europe/Budapest')::date - 1
            FROM "audit_entry" a
           WHERE a."entityType" = 'Pool' AND a."entityId" = p."id"::text AND a."changes" -> 'active' ->> 'after' = 'false'),
         (now() AT TIME ZONE 'Europe/Budapest')::date - 1)) END,
       '00000000-0000-0000-0000-000000000001'
FROM "pool" p
WHERE NOT EXISTS (SELECT 1 FROM "pool_period" q WHERE q."poolId" = p."id");

-- the periods are edited (a correction moves a day, a wrong one is removed): the application role may delete them
GRANT DELETE ON "pool_period" TO caparium_app;

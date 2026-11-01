-- Lili 2026-11-01 (point 14): a feed's feeding periods

-- CreateTable
CREATE TABLE "feed_period" (
    "id" UUID NOT NULL,
    "feedId" UUID NOT NULL,
    "firstDay" DATE NOT NULL,
    "lastDay" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_period_feedId_firstDay_idx" ON "feed_period"("feedId", "firstDay");

-- AddForeignKey
ALTER TABLE "feed_period" ADD CONSTRAINT "feed_period_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- a period ends on or after its first day
ALTER TABLE "feed_period" ADD CONSTRAINT "feed_period_days" CHECK ("lastDay" IS NULL OR "lastDay" >= "firstDay");

-- Lili 2026-11-01 14:24 UTC (msg 1566457887839223860): every feed gets a period from 2018-12-07, so today's lists do not change. The
-- active ones open; the inactive ones end the day before the migration (Budapest), so today they are not offered, as before; Lili
-- corrects them afterwards. The system user (R-12) records it. Re-runnable: a feed with a period already gets none.
INSERT INTO "feed_period" ("id", "feedId", "firstDay", "lastDay", "createdById")
SELECT gen_random_uuid(), f."id", DATE '2018-12-07',
       CASE WHEN f."active" THEN NULL ELSE GREATEST(DATE '2018-12-07', ((now() AT TIME ZONE 'Europe/Budapest')::date - 1)) END,
       '00000000-0000-0000-0000-000000000001'
FROM "feed" f
WHERE NOT EXISTS (SELECT 1 FROM "feed_period" p WHERE p."feedId" = f."id");

-- the periods are edited (a correction moves a day, a wrong one is removed): the application role may delete them
GRANT DELETE ON "feed_period" TO caparium_app;

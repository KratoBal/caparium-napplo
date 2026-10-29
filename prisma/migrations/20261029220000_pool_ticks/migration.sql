-- Lili 2026-10-29 (Caparium channel msg 1565439824826077305 and 1565439885244895296; task caparium-lili-nagyobb-m, item 8):
-- the daily water measurement's ticks "Visszamosás" and "Rátöltés" (big pools) and "Vízcsere" (small tanks). One row per pool,
-- business day and kind while the tick is on; unticking deletes the row (the audit entry keeps the history). Not part of the
-- ZIMS export. A new table only; nothing existing changes.
-- ROLLBACK: DROP TABLE "pool_tick"; DROP TYPE "PoolTickKind";

-- CreateEnum
CREATE TYPE "PoolTickKind" AS ENUM ('BACKWASH', 'TOPUP', 'WATER_CHANGE');

-- CreateTable
CREATE TABLE "pool_tick" (
    "poolId" UUID NOT NULL,
    "businessDay" DATE NOT NULL,
    "kind" "PoolTickKind" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_tick_pkey" PRIMARY KEY ("poolId","businessDay","kind")
);

-- AddForeignKey
ALTER TABLE "pool_tick" ADD CONSTRAINT "pool_tick_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unticking removes the row.
GRANT DELETE ON "pool_tick" TO caparium_app;

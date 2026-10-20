-- Task caparium-hibak-3 (Balázs 2026-10-20 08:44-08:45 UTC, msg 1562023625652183062 and 1562023866203906099).
-- ADDITIVE: two nullable columns, an index and a foreign key; no row is changed.
-- - pool.volumeLiters: the pool's volume in litres (the chemical calculator works with it); null = not given yet.
-- - reference_range.poolId: a range of ONE pool. The existing rows keep poolId NULL: they stay the common range,
--   which every pool starts from (the pool's own valid range wins, else the common one, src/lib/master.ts
--   referenceAt). So today's value is every pool's starting value without copying it, and the measurements keep
--   the range they were judged by (measurement.referenceRangeId, K4).
-- ROLLBACK: drop the two columns (a pool's own ranges would be lost: export them first).
-- AlterTable
ALTER TABLE "pool" ADD COLUMN     "volumeLiters" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "reference_range" ADD COLUMN     "poolId" UUID;

-- CreateIndex
CREATE INDEX "reference_range_parameterId_poolId_validFrom_idx" ON "reference_range"("parameterId", "poolId", "validFrom");

-- AddForeignKey
ALTER TABLE "reference_range" ADD CONSTRAINT "reference_range_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- a volume is a positive amount
ALTER TABLE "pool" ADD CONSTRAINT "pool_volume_positive" CHECK ("volumeLiters" IS NULL OR "volumeLiters" > 0);

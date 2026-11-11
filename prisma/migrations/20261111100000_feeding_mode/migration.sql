-- f0552bd4 (Lili 2026-11-11): the day's feeding mode, one choice for the day; null = not chosen yet. One new nullable
-- column; no row is changed.
-- ROLLBACK: ALTER TABLE "feeding_day" DROP COLUMN "feedingMode"; DROP TYPE "FeedingMode";
CREATE TYPE "FeedingMode" AS ENUM ('DIVING', 'SURFACE', 'NONE');
ALTER TABLE "feeding_day" ADD COLUMN "feedingMode" "FeedingMode";

-- 6fe63c9b (Lili's request, Balázs 2026-10-21 10:38 UTC "mehet"): the day's feeds, chosen in the list's second step.
-- Additive: an empty array means "not chosen", and then every active feed is offered, as before.
-- Back: ALTER TABLE "feeding_day" DROP COLUMN "feedIds";
ALTER TABLE "feeding_day" ADD COLUMN "feedIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

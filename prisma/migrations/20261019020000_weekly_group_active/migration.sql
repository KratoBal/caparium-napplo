-- The weekly measurement UI exists from the second working part (VIZ-05, VIZ-06):
-- the weekly group, seeded inactive until now, becomes active. No-op where it was never seeded.
UPDATE "measurement_group" SET "active" = true WHERE "code" = 'HETI';

-- VIZ-06: dilution 1–100 at the storage level too, not only in the API schema.
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_dilution_range" CHECK ("dilution" IS NULL OR "dilution" BETWEEN 1 AND 100);

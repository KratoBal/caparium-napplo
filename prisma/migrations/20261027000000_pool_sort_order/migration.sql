-- The fixed order of the pools in the water report PDF (Lili 2026-10-26, Caparium channel msg 1564418747047874581): Nagymedence,
-- Karantén, Kismedence, Ragadozós, Korallos, Inkubátor, then the salt pools; a pool added later takes the next number. The starting
-- values go to the pools that exist; a database without them yet gets them from the basic data (src/lib/base-data.ts).

-- AlterTable
ALTER TABLE "pool" ADD COLUMN "sortOrder" INTEGER;

UPDATE "pool" SET "sortOrder" = CASE "code"
  WHEN 'NAGY' THEN 0
  WHEN 'KARANTEN' THEN 1
  WHEN 'KIS' THEN 2
  WHEN 'RAGADOZOS' THEN 3
  WHEN 'KORALLOS' THEN 4
  WHEN 'INKUBATOR' THEN 5
  WHEN 'KIS_SOZO' THEN 6
  WHEN 'SOZO' THEN 7
END
WHERE "code" IN ('NAGY', 'KARANTEN', 'KIS', 'RAGADOZOS', 'KORALLOS', 'INKUBATOR', 'KIS_SOZO', 'SOZO');

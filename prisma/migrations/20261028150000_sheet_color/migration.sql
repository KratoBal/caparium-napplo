-- Lili 2026-10-28 13:49 UTC (acrobot 37542): an animal's or a group's row colour on the feeding sheet, set in
-- Beállítások. Nullable, none by default; display only, no export reads it.
-- ROLLBACK: ALTER TABLE "animal" DROP COLUMN "sheetColor"; ALTER TABLE "animal_group" DROP COLUMN "sheetColor"; (only the colours are lost)
ALTER TABLE "animal" ADD COLUMN "sheetColor" TEXT;
ALTER TABLE "animal_group" ADD COLUMN "sheetColor" TEXT;

-- Lili 2026-10-26 (card f67b1a06, item 4): the admin drags the animals into their own order; the lists and the
-- exports follow it. Nullable: an animal nobody has placed yet keeps the old order (by name) after the placed ones.
-- ROLLBACK: ALTER TABLE "animal" DROP COLUMN "sortOrder"; (only the order is lost, no other data depends on it)
ALTER TABLE "animal" ADD COLUMN "sortOrder" INTEGER;

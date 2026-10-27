-- Lili 2026-10-27 15:43 UTC: on one day a withdrawal for that day's feeding and another for the next day's. The cell of a
-- withdrawal item is (day, feed, other name, USE DAY): two use days are two items, one use day still carries one valid item
-- (T-02). Widening a unique key cannot fail on existing rows.
DROP INDEX "withdrawal_item_one_valid";
CREATE UNIQUE INDEX "withdrawal_item_one_valid" ON "withdrawal_item"
  ("withdrawalDayId", "feedId", lower(COALESCE("otherName", '')), "useDay") WHERE "status" = 'VALID';

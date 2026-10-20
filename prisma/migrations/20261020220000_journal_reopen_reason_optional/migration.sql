-- caparium-indoklas-ki: with the reasons off (src/lib/reasons.ts) a reopening may come without a reason.
-- Additive: the reasons already stored stay. Back: fill the nulls, then SET NOT NULL.
ALTER TABLE "journal_reopen" ALTER COLUMN "reason" DROP NOT NULL;

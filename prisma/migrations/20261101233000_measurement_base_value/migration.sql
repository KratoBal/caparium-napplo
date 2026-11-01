-- Lili 2026-11-01 22:35 UTC: the weekly dilution becomes a factor; the value before it is kept
ALTER TABLE "measurement" ADD COLUMN     "baseValue" DECIMAL(14,4);

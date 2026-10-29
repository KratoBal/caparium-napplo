-- A pool's system, coral or fish (Lili 2026-10-29, package item 5b): the chemical calculator's daily raise limit follows
-- it (Balázs, 2026-10-29 18:59 UTC). Added, nullable: every pool starts "not set", and nothing existing changes.
CREATE TYPE "PoolSystemType" AS ENUM ('CORAL', 'FISH');
ALTER TABLE "pool" ADD COLUMN "systemType" "PoolSystemType";

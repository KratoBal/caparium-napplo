-- Lili 2026-11-01 (point 9): a parameter of a group measured in some of its pools only; empty = every pool, as every existing row
ALTER TABLE "group_parameter" ADD COLUMN     "poolIds" UUID[] DEFAULT ARRAY[]::UUID[];

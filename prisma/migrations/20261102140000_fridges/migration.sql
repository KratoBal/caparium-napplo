-- Lili 2026-11-02 12:34 and 13:21 UTC (Caparium thread 1562408242083004466, msg 1566792513673764997 and 1566804526357413899;
-- task caparium-hutok): the fridges' and freezers' daily temperature book. Two new tables of their own and two new export
-- kinds; nothing existing changes (the measurement, parameter and group tables are untouched, so the water exports, the
-- weekly table and the ZIMS do not see a fridge). No DELETE grant: a fridge is closed, a reading invalidated.
-- ROLLBACK: DROP TABLE "fridge_reading"; DROP TABLE "fridge"; DROP TYPE "FridgeKind"; (the two ExportKind values stay: an enum
-- value is not dropped in place, and no row uses them without the tables)

-- CreateEnum
CREATE TYPE "FridgeKind" AS ENUM ('FRIDGE', 'FREEZER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExportKind" ADD VALUE 'EXCEL_FRIDGE';
ALTER TYPE "ExportKind" ADD VALUE 'PDF_FRIDGE';

-- CreateTable
CREATE TABLE "fridge" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FridgeKind" NOT NULL,
    "minC" DECIMAL(5,1) NOT NULL,
    "maxC" DECIMAL(5,1) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fridge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fridge_reading" (
    "id" UUID NOT NULL,
    "fridgeId" UUID NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "businessDay" DATE NOT NULL,
    "temperatureC" DECIMAL(5,1) NOT NULL,
    "minC" DECIMAL(5,1) NOT NULL,
    "maxC" DECIMAL(5,1) NOT NULL,
    "defrost" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fridge_reading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fridge_name_key" ON "fridge"("name");

-- CreateIndex
CREATE UNIQUE INDEX "fridge_reading_requestId_key" ON "fridge_reading"("requestId");

-- CreateIndex
CREATE INDEX "fridge_reading_businessDay_idx" ON "fridge_reading"("businessDay");

-- CreateIndex
CREATE INDEX "fridge_reading_fridgeId_businessDay_idx" ON "fridge_reading"("fridgeId", "businessDay");

-- AddForeignKey
ALTER TABLE "fridge_reading" ADD CONSTRAINT "fridge_reading_fridgeId_fkey" FOREIGN KEY ("fridgeId") REFERENCES "fridge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The range is a range: the lower limit below the upper one (the form says so too; this keeps a direct write honest).
ALTER TABLE "fridge" ADD CONSTRAINT "fridge_range_check" CHECK ("minC" < "maxC");

-- CreateTable
CREATE TABLE "body_weight" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "measuredOn" DATE NOT NULL,
    "weightKg" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_weight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculator_run" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "bwKg" DECIMAL(12,4) NOT NULL,
    "frWeekPct" DECIMAL(5,2) NOT NULL,
    "nWeek" INTEGER NOT NULL,
    "frDayPct" DECIMAL(8,4) NOT NULL,
    "fKg" DECIMAL(12,4) NOT NULL,
    "fG" DECIMAL(14,4) NOT NULL,
    "fwG" DECIMAL(14,4) NOT NULL,
    "savedAsReference" BOOLEAN NOT NULL DEFAULT false,
    "requestId" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculator_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_reference" (
    "id" UUID NOT NULL,
    "animalId" UUID,
    "groupId" UUID,
    "quantityG" DECIMAL(14,4) NOT NULL,
    "calculatorRunId" UUID,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeding_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "body_weight_requestId_key" ON "body_weight"("requestId");

-- CreateIndex
CREATE INDEX "body_weight_animalId_measuredOn_idx" ON "body_weight"("animalId", "measuredOn");

-- CreateIndex
CREATE UNIQUE INDEX "calculator_run_requestId_key" ON "calculator_run"("requestId");

-- CreateIndex
CREATE INDEX "calculator_run_animalId_createdAt_idx" ON "calculator_run"("animalId", "createdAt");

-- CreateIndex
CREATE INDEX "feeding_reference_animalId_validFrom_idx" ON "feeding_reference"("animalId", "validFrom");

-- CreateIndex
CREATE INDEX "feeding_reference_groupId_validFrom_idx" ON "feeding_reference"("groupId", "validFrom");

-- AddForeignKey
ALTER TABLE "body_weight" ADD CONSTRAINT "body_weight_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculator_run" ADD CONSTRAINT "calculator_run_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reference" ADD CONSTRAINT "feeding_reference_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reference" ADD CONSTRAINT "feeding_reference_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "animal_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reference" ADD CONSTRAINT "feeding_reference_calculatorRunId_fkey" FOREIGN KEY ("calculatorRunId") REFERENCES "calculator_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- a reference belongs to an animal or a group, exactly one
ALTER TABLE "feeding_reference" ADD CONSTRAINT "feeding_reference_one_recipient" CHECK (("animalId" IS NULL) <> ("groupId" IS NULL));
-- one open reference version per recipient
CREATE UNIQUE INDEX "feeding_reference_open_animal" ON "feeding_reference" ("animalId") WHERE "validTo" IS NULL AND "animalId" IS NOT NULL;
CREATE UNIQUE INDEX "feeding_reference_open_group" ON "feeding_reference" ("groupId") WHERE "validTo" IS NULL AND "groupId" IS NOT NULL;
-- the calculator's inputs (KALK-01): FR 1..8 % a week, N 1..7 feedings a week, a positive weight
ALTER TABLE "calculator_run" ADD CONSTRAINT "calculator_run_inputs" CHECK ("frWeekPct" >= 1 AND "frWeekPct" <= 8 AND "nWeek" BETWEEN 1 AND 7 AND "bwKg" > 0);
ALTER TABLE "body_weight" ADD CONSTRAINT "body_weight_positive" CHECK ("weightKg" > 0);

-- review note on #13: "Tintahal" and "tintahal" are one other feed, as the KIV-04 count already says;
-- the cell index follows it (lower() folds ASCII only here; the service also compares in full Unicode)
DROP INDEX "withdrawal_item_one_valid";
CREATE UNIQUE INDEX "withdrawal_item_one_valid" ON "withdrawal_item"
  ("withdrawalDayId", "feedId", lower(COALESCE("otherName", ''))) WHERE "status" = 'VALID';

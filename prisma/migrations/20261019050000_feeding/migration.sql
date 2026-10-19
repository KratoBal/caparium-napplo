-- CreateEnum
CREATE TYPE "ListState" AS ENUM ('NOT_FINALIZED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "EatingState" AS ENUM ('EATEN', 'PARTIAL', 'NOT_EATEN', 'FASTING');

-- CreateEnum
CREATE TYPE "StatusSource" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateTable
CREATE TABLE "feeding_day" (
    "id" UUID NOT NULL,
    "businessDay" DATE NOT NULL,
    "journalDayId" UUID NOT NULL,
    "listState" "ListState" NOT NULL DEFAULT 'NOT_FINALIZED',
    "finalizedById" UUID,
    "finalizedAt" TIMESTAMPTZ(3),

    CONSTRAINT "feeding_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_selection" (
    "id" UUID NOT NULL,
    "feedingDayId" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeding_selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_item" (
    "id" UUID NOT NULL,
    "feedingDayId" UUID NOT NULL,
    "animalId" UUID,
    "groupId" UUID,
    "feedId" UUID NOT NULL,
    "otherName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeding_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_quantity" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitId" UUID NOT NULL,
    "dimension" "Dimension" NOT NULL,

    CONSTRAINT "feeding_quantity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_participant" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "animalId" UUID NOT NULL,

    CONSTRAINT "feeding_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eating_status" (
    "id" UUID NOT NULL,
    "feedingDayId" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "state" "EatingState" NOT NULL,
    "source" "StatusSource" NOT NULL DEFAULT 'MANUAL',
    "vitamin" BOOLEAN NOT NULL DEFAULT false,
    "medicine" BOOLEAN NOT NULL DEFAULT false,
    "medicineNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eating_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feeding_day_businessDay_key" ON "feeding_day"("businessDay");

-- CreateIndex
CREATE UNIQUE INDEX "feeding_day_journalDayId_key" ON "feeding_day"("journalDayId");

-- CreateIndex
CREATE UNIQUE INDEX "feeding_selection_requestId_key" ON "feeding_selection"("requestId");

-- CreateIndex
CREATE INDEX "feeding_selection_feedingDayId_idx" ON "feeding_selection"("feedingDayId");

-- CreateIndex
CREATE UNIQUE INDEX "feeding_item_requestId_key" ON "feeding_item"("requestId");

-- CreateIndex
CREATE INDEX "feeding_item_feedingDayId_idx" ON "feeding_item"("feedingDayId");

-- CreateIndex
CREATE UNIQUE INDEX "feeding_quantity_itemId_dimension_key" ON "feeding_quantity"("itemId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "feeding_participant_itemId_animalId_key" ON "feeding_participant"("itemId", "animalId");

-- CreateIndex
CREATE UNIQUE INDEX "eating_status_requestId_key" ON "eating_status"("requestId");

-- CreateIndex
CREATE INDEX "eating_status_feedingDayId_idx" ON "eating_status"("feedingDayId");

-- AddForeignKey
ALTER TABLE "feeding_day" ADD CONSTRAINT "feeding_day_journalDayId_fkey" FOREIGN KEY ("journalDayId") REFERENCES "journal_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_selection" ADD CONSTRAINT "feeding_selection_feedingDayId_fkey" FOREIGN KEY ("feedingDayId") REFERENCES "feeding_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_selection" ADD CONSTRAINT "feeding_selection_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_item" ADD CONSTRAINT "feeding_item_feedingDayId_fkey" FOREIGN KEY ("feedingDayId") REFERENCES "feeding_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_item" ADD CONSTRAINT "feeding_item_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_item" ADD CONSTRAINT "feeding_item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "animal_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_item" ADD CONSTRAINT "feeding_item_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_quantity" ADD CONSTRAINT "feeding_quantity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "feeding_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_quantity" ADD CONSTRAINT "feeding_quantity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_participant" ADD CONSTRAINT "feeding_participant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "feeding_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_participant" ADD CONSTRAINT "feeding_participant_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eating_status" ADD CONSTRAINT "eating_status_feedingDayId_fkey" FOREIGN KEY ("feedingDayId") REFERENCES "feeding_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eating_status" ADD CONSTRAINT "eating_status_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- T-02 / R-3: one valid selection, one valid item per cell, one valid eating status per (day, animal)
CREATE UNIQUE INDEX "feeding_selection_one_valid" ON "feeding_selection" ("feedingDayId", "animalId") WHERE "status" = 'VALID';
CREATE UNIQUE INDEX "feeding_item_one_valid" ON "feeding_item"
  ("feedingDayId", COALESCE("animalId", "groupId"), "feedId", COALESCE("otherName", '')) WHERE "status" = 'VALID';
CREATE UNIQUE INDEX "eating_status_one_valid" ON "eating_status" ("feedingDayId", "animalId") WHERE "status" = 'VALID';
-- an item goes to exactly one recipient: an animal or a group
ALTER TABLE "feeding_item" ADD CONSTRAINT "feeding_item_one_recipient" CHECK (("animalId" IS NULL) <> ("groupId" IS NULL));
-- the quantities and participants of an item are replaced when the item is edited (the item itself is versioned and audited)
GRANT DELETE ON "feeding_quantity", "feeding_participant" TO caparium_app;

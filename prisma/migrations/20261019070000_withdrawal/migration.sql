-- CreateTable
CREATE TABLE "withdrawal_day" (
    "id" UUID NOT NULL,
    "businessDay" DATE NOT NULL,
    "journalDayId" UUID NOT NULL,

    CONSTRAINT "withdrawal_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_item" (
    "id" UUID NOT NULL,
    "withdrawalDayId" UUID NOT NULL,
    "useDay" DATE NOT NULL,
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

    CONSTRAINT "withdrawal_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_quantity" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitId" UUID NOT NULL,
    "dimension" "Dimension" NOT NULL,

    CONSTRAINT "withdrawal_quantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_day_businessDay_key" ON "withdrawal_day"("businessDay");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_day_journalDayId_key" ON "withdrawal_day"("journalDayId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_item_requestId_key" ON "withdrawal_item"("requestId");

-- CreateIndex
CREATE INDEX "withdrawal_item_withdrawalDayId_idx" ON "withdrawal_item"("withdrawalDayId");

-- CreateIndex
CREATE INDEX "withdrawal_item_useDay_idx" ON "withdrawal_item"("useDay");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_quantity_itemId_dimension_key" ON "withdrawal_quantity"("itemId", "dimension");

-- AddForeignKey
ALTER TABLE "withdrawal_day" ADD CONSTRAINT "withdrawal_day_journalDayId_fkey" FOREIGN KEY ("journalDayId") REFERENCES "journal_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_item" ADD CONSTRAINT "withdrawal_item_withdrawalDayId_fkey" FOREIGN KEY ("withdrawalDayId") REFERENCES "withdrawal_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_item" ADD CONSTRAINT "withdrawal_item_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_quantity" ADD CONSTRAINT "withdrawal_quantity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "withdrawal_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_quantity" ADD CONSTRAINT "withdrawal_quantity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- one valid withdrawal item per (day, feed, other name) (T-02 as for the feeding items)
CREATE UNIQUE INDEX "withdrawal_item_one_valid" ON "withdrawal_item"
  ("withdrawalDayId", "feedId", COALESCE("otherName", '')) WHERE "status" = 'VALID';
-- the quantities of an item are replaced when the item is edited (the item itself is versioned and audited)
GRANT DELETE ON "withdrawal_quantity" TO caparium_app;
-- KIV-05: the withdrawal Excel is an export run too
ALTER TYPE "ExportKind" ADD VALUE 'EXCEL_WITHDRAWAL';

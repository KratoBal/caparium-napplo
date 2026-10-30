-- CreateTable
CREATE TABLE "feed_intake_item" (
    "id" UUID NOT NULL,
    "intakeDay" DATE NOT NULL,
    "feedId" UUID NOT NULL,
    "otherName" TEXT,
    "note" TEXT,
    "returned" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_intake_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_intake_quantity" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitId" UUID NOT NULL,
    "dimension" "Dimension" NOT NULL,

    CONSTRAINT "feed_intake_quantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_intake_item_requestId_key" ON "feed_intake_item"("requestId");

-- CreateIndex
CREATE INDEX "feed_intake_item_intakeDay_idx" ON "feed_intake_item"("intakeDay");

-- CreateIndex
CREATE INDEX "feed_intake_item_feedId_idx" ON "feed_intake_item"("feedId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_intake_quantity_itemId_dimension_key" ON "feed_intake_quantity"("itemId", "dimension");

-- AddForeignKey
ALTER TABLE "feed_intake_item" ADD CONSTRAINT "feed_intake_item_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_intake_quantity" ADD CONSTRAINT "feed_intake_quantity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "feed_intake_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_intake_quantity" ADD CONSTRAINT "feed_intake_quantity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- the quantities of an item are replaced when the item is edited (the item itself is versioned and audited), as on the withdrawal items
GRANT DELETE ON "feed_intake_quantity" TO caparium_app;

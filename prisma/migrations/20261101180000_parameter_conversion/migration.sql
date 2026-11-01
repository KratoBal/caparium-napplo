-- Lili 2026-11-01 (point 13): a tester's reading converted to the value (Hanna HI755, HI736)

-- AlterTable
ALTER TABLE "measurement" ADD COLUMN     "conversionId" UUID,
ADD COLUMN     "rawReading" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "parameter_conversion" (
    "id" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "factor" DECIMAL(20,10) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parameter_conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parameter_conversion_parameterId_validFrom_idx" ON "parameter_conversion"("parameterId", "validFrom");

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "parameter_conversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_conversion" ADD CONSTRAINT "parameter_conversion_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- the reading and its conversion travel together: both or neither
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_raw_reading_pair" CHECK (("rawReading" IS NULL) = ("conversionId" IS NULL));

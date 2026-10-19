-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('INTAKE', 'USAGE', 'CORRECTION');

-- CreateTable
CREATE TABLE "chemical" (
    "id" UUID NOT NULL,
    "stockUnitId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chemical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_name" (
    "id" UUID NOT NULL,
    "chemicalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "chemical_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dosing" (
    "id" UUID NOT NULL,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "businessDay" DATE NOT NULL,
    "poolId" UUID NOT NULL,
    "chemicalId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitId" UUID NOT NULL,
    "performedById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "chemicalId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "originalQuantity" DECIMAL(14,4) NOT NULL,
    "originalUnitId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "businessDay" DATE NOT NULL,
    "dosingId" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chemical_name_chemicalId_validFrom_idx" ON "chemical_name"("chemicalId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "dosing_requestId_key" ON "dosing"("requestId");

-- CreateIndex
CREATE INDEX "dosing_businessDay_idx" ON "dosing"("businessDay");

-- CreateIndex
CREATE INDEX "dosing_chemicalId_businessDay_idx" ON "dosing"("chemicalId", "businessDay");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_dosingId_key" ON "stock_movement"("dosingId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_requestId_key" ON "stock_movement"("requestId");

-- CreateIndex
CREATE INDEX "stock_movement_chemicalId_businessDay_idx" ON "stock_movement"("chemicalId", "businessDay");

-- AddForeignKey
ALTER TABLE "chemical" ADD CONSTRAINT "chemical_stockUnitId_fkey" FOREIGN KEY ("stockUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_name" ADD CONSTRAINT "chemical_name_chemicalId_fkey" FOREIGN KEY ("chemicalId") REFERENCES "chemical"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosing" ADD CONSTRAINT "dosing_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosing" ADD CONSTRAINT "dosing_chemicalId_fkey" FOREIGN KEY ("chemicalId") REFERENCES "chemical"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosing" ADD CONSTRAINT "dosing_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosing" ADD CONSTRAINT "dosing_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_chemicalId_fkey" FOREIGN KEY ("chemicalId") REFERENCES "chemical"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_originalUnitId_fkey" FOREIGN KEY ("originalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_dosingId_fkey" FOREIGN KEY ("dosingId") REFERENCES "dosing"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- a USAGE movement goes out, an INTAKE comes in; a correction may be either (R-16)
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign" CHECK (
  ("type" = 'USAGE' AND "quantity" < 0) OR ("type" = 'INTAKE' AND "quantity" > 0) OR ("type" = 'CORRECTION' AND "quantity" <> 0));
ALTER TABLE "dosing" ADD CONSTRAINT "dosing_positive" CHECK ("quantity" > 0);

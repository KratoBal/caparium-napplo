-- AlterTable
ALTER TABLE "parameter" ADD COLUMN     "baseCode" TEXT,
ADD COLUMN     "predecessorId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "parameter_predecessorId_key" ON "parameter"("predecessorId");

-- AddForeignKey
ALTER TABLE "parameter" ADD CONSTRAINT "parameter_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


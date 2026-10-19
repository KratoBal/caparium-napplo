-- CreateTable
CREATE TABLE "feeding_plan" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "weekdays" INTEGER[],
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeding_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feeding_plan_animalId_validFrom_idx" ON "feeding_plan"("animalId", "validFrom");

-- AddForeignKey
ALTER TABLE "feeding_plan" ADD CONSTRAINT "feeding_plan_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- one open plan per animal; weekdays 1..7 (Monday..Sunday), no repeats checked in the service
CREATE UNIQUE INDEX "feeding_plan_open_animal" ON "feeding_plan" ("animalId") WHERE "validTo" IS NULL;
ALTER TABLE "feeding_plan" ADD CONSTRAINT "feeding_plan_weekdays" CHECK ("weekdays" <@ ARRAY[1,2,3,4,5,6,7]);

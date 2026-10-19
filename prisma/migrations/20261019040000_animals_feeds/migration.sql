-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LifecycleType" AS ENUM ('ARRIVAL', 'TRANSFER', 'GROUP_CHANGE', 'DEATH', 'RELEASE');

-- CreateTable
CREATE TABLE "species" (
    "id" UUID NOT NULL,
    "scientificName" TEXT NOT NULL,
    "hungarianName" TEXT,
    "synonyms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal" (
    "id" UUID NOT NULL,
    "speciesId" UUID NOT NULL,
    "sex" "Sex" NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_name" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "animal_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_group" (
    "id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animal_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_group_name" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "animal_group_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycle_event" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "type" "LifecycleType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "businessDay" DATE NOT NULL,
    "toPoolId" UUID,
    "toGroupId" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "eventId" UUID NOT NULL,

    CONSTRAINT "placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_group_membership" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "eventId" UUID NOT NULL,

    CONSTRAINT "animal_group_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "emoji" TEXT,

    CONSTRAINT "feed_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed" (
    "id" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "allowedDimensions" "Dimension"[],
    "defaultUnitId" UUID NOT NULL,
    "temporary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_name" (
    "id" UUID NOT NULL,
    "feedId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "feed_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coral_feed_dose" (
    "id" UUID NOT NULL,
    "feedId" UUID NOT NULL,
    "dose" DECIMAL(14,4) NOT NULL,
    "unitId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "coral_feed_dose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "animal_name_animalId_validFrom_idx" ON "animal_name"("animalId", "validFrom");

-- CreateIndex
CREATE INDEX "animal_group_name_groupId_validFrom_idx" ON "animal_group_name"("groupId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_event_requestId_key" ON "lifecycle_event"("requestId");

-- CreateIndex
CREATE INDEX "lifecycle_event_animalId_occurredAt_idx" ON "lifecycle_event"("animalId", "occurredAt");

-- CreateIndex
CREATE INDEX "placement_animalId_validFrom_idx" ON "placement"("animalId", "validFrom");

-- CreateIndex
CREATE INDEX "placement_poolId_validFrom_idx" ON "placement"("poolId", "validFrom");

-- CreateIndex
CREATE INDEX "animal_group_membership_animalId_validFrom_idx" ON "animal_group_membership"("animalId", "validFrom");

-- CreateIndex
CREATE INDEX "animal_group_membership_groupId_validFrom_idx" ON "animal_group_membership"("groupId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "feed_type_code_key" ON "feed_type"("code");

-- CreateIndex
CREATE INDEX "feed_name_feedId_validFrom_idx" ON "feed_name"("feedId", "validFrom");

-- CreateIndex
CREATE INDEX "coral_feed_dose_feedId_validFrom_idx" ON "coral_feed_dose"("feedId", "validFrom");

-- AddForeignKey
ALTER TABLE "animal" ADD CONSTRAINT "animal_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_name" ADD CONSTRAINT "animal_name_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_group_name" ADD CONSTRAINT "animal_group_name_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "animal_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_toPoolId_fkey" FOREIGN KEY ("toPoolId") REFERENCES "pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "animal_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement" ADD CONSTRAINT "placement_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement" ADD CONSTRAINT "placement_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_group_membership" ADD CONSTRAINT "animal_group_membership_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_group_membership" ADD CONSTRAINT "animal_group_membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "animal_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed" ADD CONSTRAINT "feed_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "feed_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed" ADD CONSTRAINT "feed_defaultUnitId_fkey" FOREIGN KEY ("defaultUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_name" ADD CONSTRAINT "feed_name_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coral_feed_dose" ADD CONSTRAINT "coral_feed_dose_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coral_feed_dose" ADD CONSTRAINT "coral_feed_dose_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Placements and group memberships are derived from the valid lifecycle events and rebuilt per
-- animal on every event change (src/lib/animals.ts), so the server role may replace them. The
-- events themselves are never deleted (K5); the derived rows carry the id of the event behind them,
-- on purpose without a foreign key: every rebuild rewrites them from the events.
GRANT DELETE ON "placement", "animal_group_membership" TO caparium_app;

-- INV (adatmodell 6.): an animal is in at most one pool and one group at a time
CREATE UNIQUE INDEX "placement_one_open_per_animal" ON "placement" ("animalId") WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX "membership_one_open_per_animal" ON "animal_group_membership" ("animalId") WHERE "validTo" IS NULL;
-- one valid event per animal and instant: the order of the events is their time, a tie has none
CREATE UNIQUE INDEX "lifecycle_event_one_valid_per_instant" ON "lifecycle_event" ("animalId", "occurredAt") WHERE "status" = 'VALID';

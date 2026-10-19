-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AQUARIST', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AppModule" AS ENUM ('WATER', 'FEEDING', 'WITHDRAWAL', 'DOSING', 'SETTINGS', 'EXPORT');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('NONE', 'READ', 'RECORD', 'ADMIN');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "Dimension" AS ENUM ('MASS', 'COUNT', 'VOLUME', 'CONCENTRATION', 'TEMPERATURE', 'VOLTAGE', 'HARDNESS', 'DIMENSIONLESS');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('VALID', 'INVALIDATED', 'PENDING');

-- CreateEnum
CREATE TYPE "DiluentWater" AS ENUM ('RO', 'SW');

-- CreateEnum
CREATE TYPE "TrialResult" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('WATER', 'FEEDING', 'WITHDRAWAL', 'DOSING');

-- CreateEnum
CREATE TYPE "JournalDayState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CloseMode" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'INVALIDATE', 'CLOSE', 'REOPEN', 'MASTER_CHANGE', 'MASTER_CORRECTION', 'EXPORT', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'CONFLICT_REJECTED', 'PENDING_CREATED', 'PENDING_APPROVED', 'PENDING_REJECTED', 'ANONYMIZE');

-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('ZIMS_CSV', 'EXCEL_WATER', 'PDF_WATER');

-- CreateEnum
CREATE TYPE "ExportPurpose" AS ENUM ('SUBMISSION', 'TRIAL', 'PREVIEW');

-- CreateEnum
CREATE TYPE "SubmissionState" AS ENUM ('CREATED', 'SUBMITTED', 'REJECTED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_monogram" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "monogram" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "user_monogram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_zims_name" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "zimsName" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "user_zims_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_permission" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "module" "AppModule" NOT NULL,
    "level" "PermissionLevel" NOT NULL,

    CONSTRAINT "module_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "emoji" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_name" (
    "id" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "pool_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_group" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "measurement_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_membership" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "group_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_parameter" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "group_parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "factorToBase" DECIMAL(20,10),
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "unitId" UUID NOT NULL,
    "decimals" INTEGER NOT NULL,
    "plausibleMin" DECIMAL(14,4),
    "plausibleMax" DECIMAL(14,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter_name" (
    "id" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "parameter_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_range" (
    "id" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "min" DECIMAL(14,4),
    "max" DECIMAL(14,4),
    "unitId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_range_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_round" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "businessDay" DATE NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "unitId" UUID NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "businessDay" DATE NOT NULL,
    "dilution" INTEGER,
    "diluentWater" "DiluentWater",
    "responsibleUserId" UUID NOT NULL,
    "traineePerformed" BOOLEAN NOT NULL DEFAULT false,
    "referenceRangeId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'VALID',
    "invalidationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTimestamp" TIMESTAMPTZ(3),
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zims_parameter_name" (
    "id" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "zimsName" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "zims_parameter_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zims_unit_name" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "parameterId" UUID,
    "zimsUnit" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "zims_unit_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zims_export_profile" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "datePattern" TEXT NOT NULL,
    "timePattern" TEXT NOT NULL,
    "decimalSeparator" TEXT NOT NULL,
    "fieldSeparator" TEXT NOT NULL,
    "lineEnding" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "allRowsFilled" BOOLEAN NOT NULL,
    "timeZone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "approvedByTrialId" UUID,

    CONSTRAINT "zims_export_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zims_trial_import" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "profileId" UUID NOT NULL,
    "exportRunId" UUID,
    "result" "TrialResult" NOT NULL,
    "deviations" TEXT,
    "checkedBy" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zims_trial_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_day" (
    "id" UUID NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "groupId" UUID,
    "businessDay" DATE NOT NULL,
    "state" "JournalDayState" NOT NULL DEFAULT 'OPEN',
    "closeMode" "CloseMode",
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "closeRanAt" TIMESTAMPTZ(3),

    CONSTRAINT "journal_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_reopen" (
    "id" UUID NOT NULL,
    "journalDayId" UUID NOT NULL,
    "reopenedById" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "reclosedAt" TIMESTAMPTZ(3),

    CONSTRAINT "journal_reopen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entry" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "requestId" TEXT,
    "client" TEXT,
    "clientTimestamp" TIMESTAMPTZ(3),

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_run" (
    "id" UUID NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "purpose" "ExportPurpose" NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "zimsProfileId" UUID,
    "templateVersionId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionState" "SubmissionState",
    "submittedById" UUID,
    "submittedAt" TIMESTAMPTZ(3),

    CONSTRAINT "export_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_file" (
    "id" UUID NOT NULL,
    "exportRunId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,

    CONSTRAINT "export_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_item" (
    "id" UUID NOT NULL,
    "exportRunId" UUID NOT NULL,
    "measurementId" UUID NOT NULL,
    "measurementVersion" INTEGER NOT NULL,
    "rowSha256" TEXT NOT NULL,

    CONSTRAINT "export_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_version" (
    "id" UUID NOT NULL,
    "templateKind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" UUID NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_loginId_key" ON "app_user"("loginId");

-- CreateIndex
CREATE INDEX "user_monogram_userId_validFrom_idx" ON "user_monogram"("userId", "validFrom");

-- CreateIndex
CREATE INDEX "user_zims_name_userId_validFrom_idx" ON "user_zims_name"("userId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "module_permission_userId_module_key" ON "module_permission"("userId", "module");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pool_code_key" ON "pool"("code");

-- CreateIndex
CREATE INDEX "pool_name_poolId_validFrom_idx" ON "pool_name"("poolId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_group_code_key" ON "measurement_group"("code");

-- CreateIndex
CREATE INDEX "group_membership_groupId_validFrom_idx" ON "group_membership"("groupId", "validFrom");

-- CreateIndex
CREATE INDEX "group_parameter_groupId_validFrom_idx" ON "group_parameter"("groupId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "unit_symbol_key" ON "unit"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_code_key" ON "parameter"("code");

-- CreateIndex
CREATE INDEX "parameter_name_parameterId_validFrom_idx" ON "parameter_name"("parameterId", "validFrom");

-- CreateIndex
CREATE INDEX "reference_range_parameterId_validFrom_idx" ON "reference_range"("parameterId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_round_groupId_businessDay_seq_key" ON "measurement_round"("groupId", "businessDay", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_requestId_key" ON "measurement"("requestId");

-- CreateIndex
CREATE INDEX "measurement_businessDay_poolId_idx" ON "measurement"("businessDay", "poolId");

-- CreateIndex
CREATE INDEX "measurement_roundId_idx" ON "measurement"("roundId");

-- CreateIndex
CREATE INDEX "zims_parameter_name_parameterId_validFrom_idx" ON "zims_parameter_name"("parameterId", "validFrom");

-- CreateIndex
CREATE INDEX "zims_unit_name_unitId_validFrom_idx" ON "zims_unit_name"("unitId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "zims_export_profile_version_key" ON "zims_export_profile"("version");

-- CreateIndex
CREATE INDEX "journal_day_businessDay_idx" ON "journal_day"("businessDay");

-- CreateIndex
CREATE INDEX "audit_entry_entityType_entityId_idx" ON "audit_entry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_entry_at_idx" ON "audit_entry"("at");

-- CreateIndex
CREATE INDEX "audit_entry_requestId_idx" ON "audit_entry"("requestId");

-- CreateIndex
CREATE INDEX "export_item_measurementId_idx" ON "export_item"("measurementId");

-- CreateIndex
CREATE UNIQUE INDEX "template_version_templateKind_version_key" ON "template_version"("templateKind", "version");

-- CreateIndex
CREATE INDEX "setting_key_validFrom_idx" ON "setting"("key", "validFrom");

-- AddForeignKey
ALTER TABLE "user_monogram" ADD CONSTRAINT "user_monogram_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_zims_name" ADD CONSTRAINT "user_zims_name_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_permission" ADD CONSTRAINT "module_permission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_name" ADD CONSTRAINT "pool_name_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "measurement_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_parameter" ADD CONSTRAINT "group_parameter_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "measurement_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_parameter" ADD CONSTRAINT "group_parameter_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter" ADD CONSTRAINT "parameter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_name" ADD CONSTRAINT "parameter_name_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_range" ADD CONSTRAINT "reference_range_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_range" ADD CONSTRAINT "reference_range_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_round" ADD CONSTRAINT "measurement_round_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "measurement_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "measurement_round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_referenceRangeId_fkey" FOREIGN KEY ("referenceRangeId") REFERENCES "reference_range"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zims_parameter_name" ADD CONSTRAINT "zims_parameter_name_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zims_unit_name" ADD CONSTRAINT "zims_unit_name_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zims_unit_name" ADD CONSTRAINT "zims_unit_name_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "parameter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zims_trial_import" ADD CONSTRAINT "zims_trial_import_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "zims_export_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_day" ADD CONSTRAINT "journal_day_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "measurement_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_reopen" ADD CONSTRAINT "journal_reopen_journalDayId_fkey" FOREIGN KEY ("journalDayId") REFERENCES "journal_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_run" ADD CONSTRAINT "export_run_zimsProfileId_fkey" FOREIGN KEY ("zimsProfileId") REFERENCES "zims_export_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_run" ADD CONSTRAINT "export_run_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "template_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_file" ADD CONSTRAINT "export_file_exportRunId_fkey" FOREIGN KEY ("exportRunId") REFERENCES "export_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_item" ADD CONSTRAINT "export_item_exportRunId_fkey" FOREIGN KEY ("exportRunId") REFERENCES "export_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_item" ADD CONSTRAINT "export_item_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in the Prisma schema)
-- ---------------------------------------------------------------------------

-- T-02: a grid cell (round, pool, parameter) carries at most one VALID value.
-- Invalidated and pending rows do not count (adatmodell 4. és K5).
CREATE UNIQUE INDEX "measurement_one_valid_per_cell"
  ON "measurement" ("roundId", "poolId", "parameterId")
  WHERE "status" = 'VALID';

-- R-4: one lock per (kind, group, day). Two partial indexes instead of NULLS NOT DISTINCT,
-- because a NULL group (non-water journals) must collide too, and Prisma's drift check
-- ignores partial indexes (a NULLS NOT DISTINCT index would show up as drift).
CREATE UNIQUE INDEX "journal_day_kind_group_day"
  ON "journal_day" ("kind", "groupId", "businessDay") WHERE "groupId" IS NOT NULL;
CREATE UNIQUE INDEX "journal_day_kind_day_nogroup"
  ON "journal_day" ("kind", "businessDay") WHERE "groupId" IS NULL;

-- K6 / R-12: the audit log is append-only at the storage level, not only in the UI.
CREATE FUNCTION "audit_entry_append_only"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_entry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION "audit_entry_append_only"();

CREATE TRIGGER "audit_entry_no_truncate"
  BEFORE TRUNCATE ON "audit_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_entry_append_only"();

-- R-12: the System user exists from the start, so automatic operations always have an actor.
INSERT INTO "app_user" ("id", "fullName", "loginId", "passwordHash", "role", "active")
VALUES ('00000000-0000-0000-0000-000000000001', 'Rendszer', '__system__', NULL, 'SYSTEM', true);

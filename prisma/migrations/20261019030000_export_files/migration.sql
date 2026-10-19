-- AlterTable
ALTER TABLE "export_file" ADD COLUMN     "content" TEXT,
ADD COLUMN     "poolId" UUID;

-- AlterTable
ALTER TABLE "export_run" ADD COLUMN     "warnings" JSONB NOT NULL DEFAULT '[]';


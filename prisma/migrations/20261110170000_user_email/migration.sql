-- The user's own e-mail address (task e7f9e84d): optional, the password reset's address. No row is changed.
-- ROLLBACK: DROP INDEX "app_user_email_key"; ALTER TABLE "app_user" DROP COLUMN "email";
-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

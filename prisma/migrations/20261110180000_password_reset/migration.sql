-- One-time password reset links (task e7f9e84d). One new, empty table; no row is changed.
-- ROLLBACK: DROP TABLE "password_reset";
-- CreateTable
CREATE TABLE "password_reset" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_userId_idx" ON "password_reset"("userId");

-- AddForeignKey
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

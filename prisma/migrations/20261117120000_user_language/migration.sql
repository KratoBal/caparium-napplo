-- t-20261117-caparium-angol-alap (Lili 2026-11-17): the user's default language of the screens. One new column with a
-- default; every existing user gets HU, no row's other data changes.
-- ROLLBACK: ALTER TABLE "app_user" DROP COLUMN "language"; DROP TYPE "UiLanguage";
CREATE TYPE "UiLanguage" AS ENUM ('HU', 'EN');
ALTER TABLE "app_user" ADD COLUMN "language" "UiLanguage" NOT NULL DEFAULT 'HU';

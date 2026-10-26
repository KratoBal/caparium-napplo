-- Named feeding lists (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1): templates an admin composes
-- (animals and feeds) and a user applies to the day's list. A template, not a fact.
-- CreateTable
CREATE TABLE "feeding_list" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeding_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_list_animal" (
    "listId" UUID NOT NULL,
    "animalId" UUID NOT NULL,

    CONSTRAINT "feeding_list_animal_pkey" PRIMARY KEY ("listId","animalId")
);

-- CreateTable
CREATE TABLE "feeding_list_feed" (
    "listId" UUID NOT NULL,
    "feedId" UUID NOT NULL,

    CONSTRAINT "feeding_list_feed_pkey" PRIMARY KEY ("listId","feedId")
);

-- AddForeignKey
ALTER TABLE "feeding_list_animal" ADD CONSTRAINT "feeding_list_animal_listId_fkey" FOREIGN KEY ("listId") REFERENCES "feeding_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_list_animal" ADD CONSTRAINT "feeding_list_animal_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_list_feed" ADD CONSTRAINT "feeding_list_feed_listId_fkey" FOREIGN KEY ("listId") REFERENCES "feeding_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_list_feed" ADD CONSTRAINT "feeding_list_feed_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active list per name, in any case. Archived lists keep their name free.
CREATE UNIQUE INDEX "feeding_list_one_active_name" ON "feeding_list" (lower("name")) WHERE "active";

-- The members are replaced when the admin edits a list (the template is not journal data; the day's list it fills is
-- written through the usual selection and audit). The list rows themselves are never deleted, only archived.
GRANT DELETE ON "feeding_list_animal", "feeding_list_feed" TO caparium_app;

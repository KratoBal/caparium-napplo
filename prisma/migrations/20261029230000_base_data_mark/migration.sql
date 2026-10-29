-- What the basic data step created once, by the list's key (Lili 2026-10-29, package item 14): the feeds were looked up
-- by name at every container start, so a feed renamed by a correction came back as a new one. Added, empty: the step
-- fills it at the next start, claiming the feeds that are there (src/lib/base-feed-marks.ts).
CREATE TABLE "base_data_mark" (
    "key" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "base_data_mark_pkey" PRIMARY KEY ("key")
);

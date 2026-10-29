-- One open base amount per feed (barracuda on #113): setDose closes the open row and creates the next one; the feed
-- row's lock in updateFeed (FOR NO KEY UPDATE) serializes two changes of one feed, and this index makes a second open
-- row impossible whatever writes it. The partial-index pattern of feeding_reference_open_animal (20261019080000).
CREATE UNIQUE INDEX "coral_feed_dose_one_open" ON "coral_feed_dose" ("feedId") WHERE "validTo" IS NULL;

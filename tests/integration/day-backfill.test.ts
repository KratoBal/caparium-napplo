// An old day keyed in afterwards (Lili 2026-11-02, Caparium channel msg 1566837786617847809..1566839158171766897; task
// caparium-kivetel-regi-nap-zaras): the day stays open while its rows go in and is closed once, by hand, however long ago it was
// (back to 2018). Before: the first row made the day's lock OPEN, the scheduled close closed it within a minute, and the page,
// still showing "Nyitott", offered a close the server refused. Days in May and June 2019, used by no other file.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setDayFeeds } from "@/lib/feeding";
import { dayStatus, recloseDay, runJournalJob } from "@/lib/journal";
import { BACKFILL_REASON, entryToday } from "@/lib/master";
import { createMeasurement } from "@/lib/measurements";
import { saveWithdrawalItem } from "@/lib/withdrawal";
import { dayToDate } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
// the moment the old days are keyed in: an afternoon weeks after them. In 2019 too, so the scheduled close these tests run touches
// no day before it that another file keeps open
const NOW = new Date("2019-06-24T16:30:00+02:00");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let f2: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
  f2 = f;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

// a second row of the same feed needs another use day (one item per feed and use day)
const take = (day: string, grams: string, actor = f?.admin, now = NOW, useDay = day) =>
  saveWithdrawalItem(actor, { requestId: rid(), day, useDay, feedId: feed["Teszt hal"], quantities: [{ value: grams, unitId: unit.g }] }, now);
const lock = (day: string) => prisma.journalDay.findFirstOrThrow({ where: { kind: "WITHDRAWAL", groupId: null, businessDay: dayToDate(day) } });

describe("an old withdrawal day keyed in afterwards", () => {
  it("stays open between its rows, through the scheduled close, until it is closed once by hand; then the close holds", async () => {
    const day = "2019-05-06";
    await take(day, "233");
    expect(await dayStatus(null, day, "WITHDRAWAL")).toMatchObject({ state: "OPEN", backfill: true });
    // the scheduled close runs every minute: it passes this day over
    await runJournalJob(later(1));
    expect((await lock(day)).state).toBe("OPEN");
    await take(day, "90", f.admin, later(2), "2019-05-07");
    await runJournalJob(later(3));
    expect((await lock(day)).state).toBe("OPEN");
    // the one close at the end, from the page's "Nap lezárása"
    await recloseDay(f.admin, { requestId: rid(), kind: "WITHDRAWAL", day }, later(4));
    expect(await dayStatus(null, day, "WITHDRAWAL")).toMatchObject({ state: "CLOSED", closeMode: "MANUAL", reopened: false, backfill: false });
    await runJournalJob(later(5));
    expect((await lock(day)).state).toBe("CLOSED");
    // who opened it and why is in the audit, as an admin's reopen would be
    const opened = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "JournalDay", entityId: (await lock(day)).id, action: "REOPEN" } });
    expect([opened.userId, opened.reason]).toEqual([f.admin.id, BACKFILL_REASON]);
  });

  it("an old day nobody has keyed in shows open, and its close button closes it (no refusal)", async () => {
    const day = "2019-05-07";
    expect(await dayStatus(null, day, "WITHDRAWAL")).toMatchObject({ state: "OPEN", backfill: false });
    await recloseDay(f.admin, { requestId: rid(), kind: "WITHDRAWAL", day }, NOW);
    expect((await lock(day)).state).toBe("CLOSED");
  });

  it("today's day is not a backfill: it closes by itself after midnight, as before", async () => {
    const today = "2019-06-24";
    await take(today, "50", f.aq1);
    expect(await dayStatus(null, today, "WITHDRAWAL")).toMatchObject({ state: "OPEN", reopened: false, backfill: false });
    await runJournalJob(new Date("2019-06-25T00:05:00+02:00"));
    expect((await lock(today)).state).toBe("CLOSED");
  });

  it("a day closed before stays closed when a row is added to it (an admin reopens it as before)", async () => {
    const day = "2019-05-08";
    await take(day, "10");
    await recloseDay(f.admin, { requestId: rid(), kind: "WITHDRAWAL", day }, later(1));
    await take(day, "20", f.admin, later(2), "2019-05-09");
    expect(await dayStatus(null, day, "WITHDRAWAL")).toMatchObject({ state: "CLOSED", backfill: false });
  });

  it("an aquarist still records on today only: an old day is refused and opens nothing", async () => {
    const day = "2019-05-09";
    await expect(take(day, "10", f.aq1)).rejects.toMatchObject({ code: "NOT_TODAY" });
    expect(await prisma.journalDay.count({ where: { kind: "WITHDRAWAL", businessDay: dayToDate(day) } })).toBe(0);
  });
});

// acrobot 40134: the same for the feeding sheet and the water measurement (Lili keys old data in back to 2018); the dosing has no
// manual close and no day state on its page, so it keeps the old behaviour (acrobot 40152)
describe("the same on the feeding sheet and the water measurement", () => {
  it("an old feeding day keyed in stays open through the scheduled close and closes once by hand; an untouched one closes from its button", async () => {
    const day = "2019-05-13";
    // the day's feeds (the synthetic animals arrive in 2025, so an old day has none to tick)
    await setDayFeeds(f2.admin, { requestId: rid(), day, feedIds: [feed["Teszt hal"]] }, NOW);
    expect(await dayStatus(null, day, "FEEDING")).toMatchObject({ state: "OPEN", backfill: true });
    await runJournalJob(later(1));
    expect(await dayStatus(null, day, "FEEDING")).toMatchObject({ state: "OPEN", backfill: true });
    await recloseDay(f2.admin, { requestId: rid(), kind: "FEEDING", day }, later(2));
    expect(await dayStatus(null, day, "FEEDING")).toMatchObject({ state: "CLOSED", closeMode: "MANUAL", backfill: false });
    // a feeding day nobody keyed in: its close makes the day (with its feeding row) and closes it
    const empty = "2019-05-14";
    await recloseDay(f2.admin, { requestId: rid(), kind: "FEEDING", day: empty }, NOW);
    expect(await dayStatus(null, empty, "FEEDING")).toMatchObject({ state: "CLOSED" });
    expect(await prisma.feedingDay.count({ where: { businessDay: dayToDate(empty) } })).toBe(1);
  });

  it("an old water day keyed in stays open, shows its close (a water day closes by hand only after a reopen) and closes once", async () => {
    const day = "2019-05-15";
    const group = f2.group("NAPI_NAGY");
    await createMeasurement(f2.admin, { requestId: rid(), groupId: group, poolId: f2.pool("NAGY"), parameterId: f2.param("PH"), value: "8.1", measuredAtLocal: `${day}T08:00` }, NOW);
    expect(await dayStatus(group, day)).toMatchObject({ state: "OPEN", reopened: true, backfill: true });
    await runJournalJob(later(1));
    expect(await dayStatus(group, day)).toMatchObject({ state: "OPEN", backfill: true });
    await recloseDay(f2.admin, { requestId: rid(), kind: "WATER", groupId: group, day }, later(2));
    expect(await dayStatus(group, day)).toMatchObject({ state: "CLOSED", closeMode: "MANUAL", backfill: false });
  });

  it("a save made yesterday evening that arrives after midnight is yesterday's own entry, not a backfill (the K9 late rule decides it)", () => {
    expect(entryToday(new Date("2019-06-25T00:20:00+02:00"), new Date("2019-06-24T23:50:00+02:00"))).toBe("2019-06-24");
    // a client clock more than 48 hours behind is not trusted: the server's day
    expect(entryToday(new Date("2019-06-25T00:20:00+02:00"), new Date("2019-06-20T23:50:00+02:00"))).toBe("2019-06-25");
    expect(entryToday(new Date("2019-06-25T00:20:00+02:00"), null)).toBe("2019-06-25");
  });
});

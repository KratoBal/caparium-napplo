// An old withdrawal day keyed in afterwards (Lili 2026-11-02, Caparium channel msg 1566837786617847809..1566839158171766897; task
// caparium-kivetel-regi-nap-zaras): the day stays open while its rows go in and is closed once, by hand, however long ago it was
// (back to 2018). Before: the first row made the day's lock OPEN, the scheduled close closed it within a minute, and the page,
// still showing "Nyitott", offered a close the server refused. Days in May and June 2019, used by no other file.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dayStatus, recloseDay, runJournalJob } from "@/lib/journal";
import { BACKFILL_REASON } from "@/lib/master";
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

beforeAll(async () => {
  f = await fixtures();
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

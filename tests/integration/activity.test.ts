// The admin's activity page on real saves (card 70cadcf8). An audit row's time is the database's now(), whatever day
// the save is for, so each test measures teszt.akvarista2's numbers for TODAY before and after its own save. The saves
// themselves are for DAY, a day no other file uses: a save for today would change what the later files see today
// (feeding-log.test.ts's "TODAY" fasting check failed on it).
import { beforeAll, describe, expect, it } from "vitest";
import { groupSaves, loadActivityRows, summarize } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { prisma, SYSTEM_USER_ID } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { setSelection } from "@/lib/feeding";
import { businessDayOf } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const DAY = "2026-04-22";
const onDay = new Date(`${DAY}T08:00:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
});

async function todayFor(userId: string) {
  const today = businessDayOf(new Date());
  const rows = await loadActivityRows({ from: today, to: today }, userId);
  const saves = groupSaves(rows);
  return { rows: rows.length, saves, counts: summarize(saves).find((r) => r.day === today)?.counts ?? {} };
}

describe("the activity of real saves", () => {
  it("a feeding save of two animals is one Takarmánynapló save, however many rows it wrote", async () => {
    const before = await todayFor(f.aq2.id);
    await setSelection(f.aq2, { requestId: rid("act"), day: DAY, animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], selected: true }, onDay);
    const after = await todayFor(f.aq2.id);
    expect(after.rows - before.rows, "the save wrote more than one audit row").toBeGreaterThan(1);
    expect((after.counts.feeding ?? 0) - (before.counts.feeding ?? 0)).toBe(1);
    expect(after.counts.eating ?? 0).toBe(before.counts.eating ?? 0);
  });

  it("an eating status alone is one Evési napló save", async () => {
    const before = await todayFor(f.aq2.id);
    await setEatingStatus(f.aq2, { requestId: rid("act"), day: DAY, animalId: a["Teszt Egy"], state: "EATEN" }, new Date(`${DAY}T10:00:00+02:00`));
    const after = await todayFor(f.aq2.id);
    expect((after.counts.eating ?? 0) - (before.counts.eating ?? 0)).toBe(1);
    expect(after.counts.feeding ?? 0).toBe(before.counts.feeding ?? 0);
  });

  it("leaves out the system's rows and the logins, read for everybody", async () => {
    const today = businessDayOf(new Date());
    const marker = `act-system-${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, { userId: SYSTEM_USER_ID, action: "CLOSE", entityType: "JournalDay", entityId: marker, requestId: marker });
      await writeAudit(tx, { userId: f.aq2.id, action: "LOGIN", entityType: "User", entityId: f.aq2.id, requestId: `${marker}-login` });
      // the control: an ordinary row written the same way IS read, so the two above are left out by the rule
      await writeAudit(tx, { userId: f.aq2.id, action: "CREATE", entityType: "Dosing", entityId: marker, requestId: `${marker}-dosing` });
    });
    const rows = await loadActivityRows({ from: today, to: today });
    const ids = rows.map((r) => r.requestId);
    expect(ids).toContain(`${marker}-dosing`);
    expect(ids).not.toContain(marker);
    expect(ids).not.toContain(`${marker}-login`);
  });
});

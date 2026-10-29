// Eating statuses and the automatic fasting days (adatmodell 8., 10.; EVE-01..EVE-05, EVE-11, T-01,
// R-1, R-2, R-3). Days in March 2026: no other file writes feeding days there. Animals that other
// files add stay alive, so the assertions name the seeded animals instead of counting rows.
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { eatingDayView, invalidateEatingStatus, setEatingStatus } from "@/lib/eating";
import { AppError } from "@/lib/errors";
import { finalizeList, recomputeFasting, setSelection } from "@/lib/feeding";
import { recloseDay, reopenDay } from "@/lib/journal";
import { addDays, dayToDate } from "@/lib/time";
import { fixtures, rid, withReasons } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
let speciesId = "";

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  speciesId = (await prisma.species.findFirstOrThrow({ where: { active: true } })).id;
});

const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
}

const select = (d: string, names: string[], selected = true, actor = f?.aq1, now = at(d, "08:00"), extra = {}) =>
  setSelection(actor, { requestId: rid(), day: d, animalIds: names.map((n) => a[n] ?? n), selected, ...extra }, now);
const finalize = (d: string) => finalizeList(f.aq1, { requestId: rid(), day: d }, at(d, "09:00"));
const close = (d: string) => recloseDay(f.admin, { requestId: rid(), kind: "FEEDING", day: d }, at(d, "20:00"));
const eat = (d: string, name: string, state: "EATEN" | "PARTIAL" | "NOT_EATEN" | "FASTING", actor = f?.aq1, extra = {}) =>
  setEatingStatus(actor, { requestId: rid(), day: d, animalId: a[name] ?? name, state, ...extra }, at(d, "10:00"));

async function statuses(d: string, name: string) {
  const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } });
  return prisma.eatingStatus.findMany({ where: { feedingDayId: fd.id, animalId: a[name] ?? name, status: "VALID" } });
}
const fasting = async (d: string, name: string) => (await statuses(d, name)).filter((s) => s.state === "FASTING").map((s) => s.source);

describe("automatic fasting days (EVE-11, T-01)", () => {
  it("come at the close of a finalized list for the unselected animals, once", async () => {
    const d = "2026-03-02";
    await select(d, ["Teszt Egy"]);
    await finalize(d);
    expect(await fasting(d, "Teszt Kettő")).toEqual([]); // open day: nothing stored yet
    await close(d);
    expect(await fasting(d, "Teszt Egy")).toEqual([]);
    for (const n of ["Teszt Kettő", "Teszt Három", "Teszt Négy"]) expect(await fasting(d, n)).toEqual(["AUTOMATIC"]);
    const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } });
    expect(await prisma.$transaction((tx) => recomputeFasting(tx, fd.id, f.admin.id, null))).toEqual({ created: 0, removed: 0 });
    // an automatic row follows the list, it is not invalidated by hand
    const row = (await statuses(d, "Teszt Kettő"))[0];
    await expectCode(invalidateEatingStatus(f.admin, row.id, { requestId: rid(), expectedVersion: row.version, reason: "teszt" }, at(d, "21:00")), "AUTOMATIC");
  });

  it("a day whose list was not finalized gives no fasting day", async () => {
    const d = "2026-03-03";
    await select(d, ["Teszt Egy"]);
    await close(d);
    expect(await fasting(d, "Teszt Kettő")).toEqual([]);
  });
});

describe("eating statuses (EVE-01, EVE-02, EVE-04, EVE-05)", () => {
  it("ate, partly or not for a selected animal; a fasting day only for one not selected", async () => {
    const d = "2026-03-04";
    await select(d, ["Teszt Egy", "Teszt Kettő"]);
    const view = await eatingDayView(d);
    const row = (n: string) => view.rows.find((r) => r.animalId === a[n])!;
    expect([row("Teszt Egy").pendingFasting, row("Teszt Három").pendingFasting]).toEqual([false, true]);

    const ok = (await eat(d, "Teszt Egy", "EATEN", f.aq1, { vitamin: true })) as { statusId: string; version: number };
    await expectCode(eat(d, "Teszt Kettő", "FASTING"), "SELECTED_NOT_FASTING");
    await expectCode(eat(d, "Teszt Három", "EATEN"), "NOT_SELECTED");
    await expectCode(eat(d, "Teszt Kettő", "NOT_EATEN", f.aq1, { medicineNote: "fél tabletta" }), "NOTE_WITHOUT_MEDICINE");
    await expectCode(eat(d, "Teszt Egy", "NOT_EATEN", f.aq2), "CELL_TAKEN");
    // Lili 2026-10-29 ("Legyen javítható nyugodtan.", acrobot 37985): another aquarist corrects it too, audited under them
    const other = rid();
    await setEatingStatus(f.aq2, { requestId: other, day: d, animalId: a["Teszt Egy"], state: "NOT_EATEN", statusId: ok.statusId, expectedVersion: 1 }, at(d, "10:00"));
    expect((await prisma.auditEntry.findFirstOrThrow({ where: { requestId: other } })).userId).toBe(f.aq2.id);
    await eat(d, "Teszt Egy", "PARTIAL", f.aq1, { statusId: ok.statusId, expectedVersion: 2, medicine: true, medicineNote: "fél tabletta" });
    await expectCode(eat(d, "Teszt Egy", "EATEN", f.aq1, { statusId: ok.statusId, expectedVersion: 2 }), "VERSION_CONFLICT");
    expect((await statuses(d, "Teszt Egy")).map((s) => [s.state, s.vitamin, s.medicine, s.medicineNote, s.version])).toEqual([["PARTIAL", false, true, "fél tabletta", 3]]);
    // ...and invalidates it; a past day stays the admin's
    const st = (await statuses(d, "Teszt Egy"))[0]!;
    await expectCode(invalidateEatingStatus(f.aq2, st.id, { requestId: rid(), expectedVersion: st.version, reason: "masnap" }, at(addDays(d, 1), "08:00")), "NOT_TODAY");
    await invalidateEatingStatus(f.aq2, st.id, { requestId: rid(), expectedVersion: st.version, reason: "rossz allat" }, at(d, "10:30"));
    expect(await statuses(d, "Teszt Egy")).toEqual([]);
    await eat(d, "Teszt Egy", "EATEN", f.aq1);

    // R-3: removing the animal from the list takes its status too, after a confirmation
    await expectCode(select(d, ["Teszt Egy"], false), "HAS_RECORDS");
    await select(d, ["Teszt Egy"], false, f.aq1, at(d, "08:00"), { confirmCascade: true });
    expect(await statuses(d, "Teszt Egy")).toEqual([]);
  });

  it("a manual fasting day (with medicine) stays at the close; selecting the animal needs a confirmation", async () => {
    const d = "2026-03-05";
    await select(d, ["Teszt Egy"]);
    await eat(d, "Teszt Három", "FASTING", f.aq1, { medicine: true, medicineNote: "gyógyszer etetés nélkül" });
    await eat(d, "Teszt Négy", "FASTING");
    await expectCode(select(d, ["Teszt Négy"]), "HAS_RECORDS");
    await select(d, ["Teszt Négy"], true, f.aq1, at(d, "08:00"), { confirmCascade: true });
    expect(await statuses(d, "Teszt Négy")).toEqual([]);
    await finalize(d);
    await close(d);
    expect(await fasting(d, "Teszt Három")).toEqual(["MANUAL"]);
    expect(await fasting(d, "Teszt Kettő")).toEqual(["AUTOMATIC"]);
    expect(await fasting(d, "Teszt Négy")).toEqual([]);
  });
});

describe("a closed day changes later (T-01/6, R-1, R-2)", () => {
  it("an admin's later selection and removal move the automatic fasting days, under one request id", async () => {
    const d = "2026-03-06";
    const next = at("2026-03-07", "09:00");
    await select(d, ["Teszt Egy"]);
    await finalize(d);
    await close(d);
    await expectCode(select(d, ["Teszt Kettő"], true, f.aq1, next), "NOT_TODAY");
    await withReasons(() => expectCode(select(d, ["Teszt Kettő"], true, f.admin, next), "REASON_REQUIRED"));
    const req = rid();
    await setSelection(f.admin, { requestId: req, day: d, animalIds: [a["Teszt Kettő"]], selected: true, reason: "utólag derült ki" }, next);
    expect(await fasting(d, "Teszt Kettő")).toEqual([]);
    const audits = await prisma.auditEntry.findMany({ where: { requestId: req } });
    expect(audits.map((x) => `${x.action} ${x.entityType}`).sort()).toEqual(["CREATE FeedingSelection", "INVALIDATE EatingStatus"]);
    await select(d, ["Teszt Egy"], false, f.admin, next, { reason: "mégsem evett" });
    expect(await fasting(d, "Teszt Egy")).toEqual(["AUTOMATIC"]);
  });

  it("a reopened day keeps its fasting days until it is closed again", async () => {
    const d = "2026-03-09";
    const next = at("2026-03-10", "09:00");
    await select(d, ["Teszt Egy"]);
    await finalize(d);
    await close(d);
    await reopenDay(f.admin, { requestId: rid(), kind: "FEEDING", day: d, reason: "pótlás" });
    expect((await eatingDayView(d)).reopened).toBe(true);
    await select(d, ["Teszt Kettő"], true, f.admin, next, { reason: "pótlás" });
    expect(await fasting(d, "Teszt Kettő")).toEqual(["AUTOMATIC"]); // R-2: the day does not jump while open
    await close(d);
    expect(await fasting(d, "Teszt Kettő")).toEqual([]);
    expect(await fasting(d, "Teszt Három")).toEqual(["AUTOMATIC"]);
  });

  it("a death recorded later removes the fasting day after it; manual rows after it stop the change (R-1)", async () => {
    const arrive = async (name: string) =>
      (
        await createLifecycleEvent(
          f.admin,
          { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name, sex: "MALE" }, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-03-10T09:00", reason: "teszt" },
          at("2026-03-10", "10:00"),
        )
      ).animalId;
    const late = await arrive("Március Egy");
    const fed = await arrive("Március Kettő");
    const d = "2026-03-12";
    await select(d, ["Teszt Egy"]);
    await finalize(d);
    await close(d);
    expect(await fasting(d, late)).toEqual(["AUTOMATIC"]);
    const death = (animalId: string, when: string) =>
      createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId, occurredAtLocal: when, reason: "utólag rögzítve" }, at("2026-03-13", "10:00"));
    await death(late, "2026-03-11T08:00");
    expect(await fasting(d, late)).toEqual([]);

    await select("2026-03-13", [fed], true, f.aq1, at("2026-03-13", "08:00"));
    const e = await expectCode(death(fed, "2026-03-12T08:00"), "MANUAL_ROWS_CONFLICT");
    expect((e.details as { rows: { kind: string; day: string }[] }).rows.map((r) => `${r.kind} ${r.day}`)).toEqual(["FeedingSelection 2026-03-13"]);
    expect(await prisma.lifecycleEvent.count({ where: { animalId: fed, type: "DEATH" } })).toBe(0);
  });
});

describe("the writers of one feeding day wait for each other (review of #10)", () => {
  /** Holds a row lock in its own transaction until release() is called. */
  async function hold(table: "feeding_day" | "animal", id: string) {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const done = prisma.$transaction(
      async (tx) => {
        if (table === "feeding_day") await tx.$queryRaw`SELECT "id" FROM "feeding_day" WHERE "id" = ${id}::uuid FOR UPDATE`;
        else await tx.$queryRaw`SELECT "id" FROM "animal" WHERE "id" = ${id}::uuid FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    return { release: async () => (release(), await done) };
  }
  const pending = (p: Promise<unknown>) => Promise.race([p.then(() => "done", () => "done"), new Promise((r) => setTimeout(() => r("waiting"), 400))]);

  it("a removal and an eating status at the same moment end consistent", async () => {
    const d = "2026-03-16";
    await select(d, ["Teszt Egy"]);
    const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } });
    const h = await hold("feeding_day", fd.id);
    const removal = select(d, ["Teszt Egy"], false, f.aq2, at(d, "10:00"));
    const eating = eat(d, "Teszt Egy", "EATEN");
    expect([await pending(removal), await pending(eating)], "both must wait for the day").toEqual(["waiting", "waiting"]);
    await h.release();
    await Promise.allSettled([removal, eating]);
    const selected = (await eatingDayView(d)).rows.find((r) => r.animalId === a["Teszt Egy"])!.selected;
    const manual = (await statuses(d, "Teszt Egy")).filter((s) => s.source === "MANUAL").length;
    // either the removal won (no selection, no status) or the status did (both stay)
    expect([selected, manual]).toSatisfy(([s, m]: [boolean, number]) => (s && m === 1) || (!s && m === 0));
  });

  it("a lifecycle change and a selection on the same closed day do not deadlock", async () => {
    const d = "2026-03-17";
    const animal = (
      await createLifecycleEvent(
        f.admin,
        { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: "Március Zár", sex: "MALE" }, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-03-14T09:00", reason: "teszt" },
        at("2026-03-14", "10:00"),
      )
    ).animalId;
    await select(d, ["Teszt Egy"]);
    await finalize(d);
    await close(d);
    const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } });
    const next = at("2026-03-18", "09:00");
    const h = await hold("feeding_day", fd.id);
    // the selection queues for the day first; then the event takes the animal and queues for the day
    const selection = select(d, [animal], true, f.admin, next, { reason: "utólag" });
    await new Promise((r) => setTimeout(r, 300));
    const event = createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: animal, toPoolId: f.pool("KIS"), occurredAtLocal: `${d}T12:00`, reason: "utólag" }, next);
    await new Promise((r) => setTimeout(r, 300));
    await h.release();
    const res = await Promise.allSettled([selection, event]);
    expect(res.map((r) => (r.status === "rejected" ? String((r.reason as Error).message).slice(0, 120) : "ok"))).toEqual(["ok", "ok"]);
  });

  it("the medicine note cannot start like a formula", async () => {
    await expect(eat("2026-03-16", "Teszt Kettő", "FASTING", f.aq1, { medicine: true, medicineNote: "=1+1" })).rejects.toThrow();
  });
});

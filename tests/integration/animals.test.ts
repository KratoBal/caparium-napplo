// Animals, lifecycle and feeds against a real database (adatmodell 6., 7., 11.; DAT-05, R-1, NY-20).
// Days in February 2026: no other test file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent, editAnimal, invalidateLifecycleEvent, listAnimals, rebuildAnimal, renameEntity } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createFeed, updateFeed } from "@/lib/feeds";
import { fixtures, rid, withReasons } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let speciesId: string;
beforeAll(async () => {
  f = await fixtures();
  speciesId = (await prisma.species.findFirstOrThrow()).id;
});

const at = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`);

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

async function openPlacement(animalId: string) {
  return prisma.placement.findFirst({ where: { animalId, validTo: null } });
}

async function arrive(name: string, day = "2026-02-02") {
  const r = await createLifecycleEvent(
    f.admin,
    { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name, sex: "FEMALE" }, toPoolId: f.pool("NAGY"), occurredAtLocal: `${day}T09:00`, reason: "teszt" },
    at(day, "10:00"),
  );
  return r.animalId;
}

describe("lifecycle (DAT-05, T-09)", () => {
  it("an arrival is admin work and creates the animal with its placement", async () => {
    await expectCode(
      createLifecycleEvent(f.aq1, { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: "X", sex: "MALE" }, toPoolId: f.pool("NAGY") }),
      "ADMIN_ONLY",
    );
    const id = await arrive("Érkező");
    expect((await openPlacement(id))?.poolId).toBe(f.pool("NAGY"));
  });

  // Lili 2026-10-26 09:51 UTC (Caparium channel msg 1564214896453750805) overrides NY-20 ("an aquarist moves an
  // animal today"): the animal list is seen and managed by admins only, so every lifecycle event is admin work.
  it("Lili 10-26: an aquarist records no lifecycle event at all (transfer, group change, death, release), an admin does", async () => {
    const id = await arrive("Költöző");
    for (const event of [
      { type: "TRANSFER" as const, toPoolId: f.pool("KARANTEN") },
      { type: "DEATH" as const },
      { type: "RELEASE" as const },
    ])
      await expectCode(
        createLifecycleEvent(f.admin, { requestId: rid(), animalId: id, occurredAtLocal: "2026-02-03T08:00", ...event }, at("2026-02-03", "08:05")),
        "ADMIN_ONLY",
      );
    // nothing was written by the refused calls
    expect(await prisma.lifecycleEvent.count({ where: { animalId: id } })).toBe(1);
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KARANTEN"), occurredAtLocal: "2026-02-03T08:00" }, at("2026-02-03", "08:05"));
    expect((await openPlacement(id))?.poolId).toBe(f.pool("KARANTEN"));
    expect(await prisma.placement.count({ where: { animalId: id } })).toBe(2);
  });

  it("an admin's transfer for an earlier day needs a reason when the reasons are on", async () => {
    const id = await arrive("Késői Költöző");
    await withReasons(() =>
      expectCode(
        createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-02-03T20:00" }, at("2026-02-04", "08:00")),
        "REASON_REQUIRED",
      ),
    );
  });

  it("after a death nothing is open, a later event is refused and nothing is written", async () => {
    const id = await arrive("Elhulló");
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: id, occurredAtLocal: "2026-02-05T07:00" }, at("2026-02-05", "07:30"));
    expect(await openPlacement(id)).toBeNull();
    const events = await prisma.lifecycleEvent.count({ where: { animalId: id } });
    await expectCode(
      createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: "2026-02-05T09:00" }, at("2026-02-05", "09:05")),
      "LIFECYCLE_INVALID",
    );
    expect(await prisma.lifecycleEvent.count({ where: { animalId: id } })).toBe(events);
    const row = (await listAnimals(at("2026-02-06", "09:00"))).find((a) => a.id === id)!;
    expect(row).toMatchObject({ alive: false, ended: { type: "DEATH", day: "2026-02-05" } });
  });

  it("invalidating a death (by its recorder, today) reopens the placement; the arrival under later events cannot go", async () => {
    const id = await arrive("Tévedés");
    const d = await createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: id, occurredAtLocal: "2026-02-06T07:00" }, at("2026-02-06", "07:30"));
    await invalidateLifecycleEvent(f.admin, d.eventId, { requestId: rid(), expectedVersion: 1, reason: "rossz állatra rögzítve" }, at("2026-02-06", "08:00"));
    expect((await openPlacement(id))?.poolId).toBe(f.pool("NAGY"));
    const arrival = await prisma.lifecycleEvent.findFirstOrThrow({ where: { animalId: id, type: "ARRIVAL" } });
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: "2026-02-06T09:00" }, at("2026-02-06", "09:05"));
    await expectCode(
      invalidateLifecycleEvent(f.admin, arrival.id, { requestId: rid(), expectedVersion: 1, reason: "teszt" }, at("2026-02-06", "10:00")),
      "LIFECYCLE_INVALID",
    );
  });

  it("an animal name change keeps the old name for the past (K3)", async () => {
    const id = await arrive("Régi Név");
    await renameEntity(f.admin, "animal", id, { requestId: rid(), name: "Új Név", mode: "change" });
    const names = await prisma.animalName.findMany({ where: { animalId: id }, orderBy: { validFrom: "asc" } });
    expect(names.map((n) => n.name)).toEqual(["Régi Név", "Új Név"]);
  });

  it("two events for one animal at the same moment: one wins, the other sees it (review of #9)", async () => {
    const d = "2026-02-10";
    const id = await arrive("Párhuzamos", "2026-02-09");
    // hold the animal's row lock so both calls are in flight together (without the hold the first one
    // finishes before the second starts, and the race never shows)
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "animal" WHERE "id" = ${id}::uuid FOR UPDATE`;
      locked();
      await held;
    });
    await isLocked;
    const death = createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: id, occurredAtLocal: `${d}T09:00` }, at(d, "09:15"));
    const move = createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: `${d}T09:10` }, at(d, "09:15"));
    const settled = Promise.allSettled([death, move]);
    const early = await Promise.race([settled.then(() => "done"), new Promise((r) => setTimeout(() => r("waiting"), 500))]);
    expect(early, "an event change must wait for the animal's lock").toBe("waiting");
    release();
    await holder;
    const res = await settled;
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const events = await prisma.lifecycleEvent.findMany({ where: { animalId: id, status: "VALID" }, orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => e.type)).not.toEqual(["ARRIVAL", "DEATH", "TRANSFER"]);
    // the animal stays usable: its state rebuilds without an error
    await prisma.$transaction((tx) => rebuildAnimal(tx, id));
  });

  it("one valid event per animal and instant", async () => {
    const d = "2026-02-11";
    const id = await arrive("Egy Pillanat", "2026-02-09");
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: `${d}T09:00` }, at(d, "09:05"));
    await expectCode(
      createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("NAGY"), occurredAtLocal: `${d}T09:00` }, at(d, "09:06")),
      "SAME_INSTANT",
    );
  });
});

describe("editing an animal (caparium-hibak-5)", () => {
  const now = at("2026-02-25", "10:00");
  const arrivalOf = (id: string) => prisma.lifecycleEvent.findFirstOrThrow({ where: { animalId: id, type: "ARRIVAL", status: "VALID" } });

  it("whoever may record an arrival may edit; species and sex in place, one audit row with before and after", async () => {
    const id = await arrive("Szerkesztendő", "2026-02-20");
    await expectCode(editAnimal(f.aq1, id, { requestId: rid(), sex: "MALE" }, now), "ADMIN_ONLY");
    await expectCode(editAnimal(f.admin, id, { requestId: rid(), sex: "FEMALE" }, now), "NO_CHANGE");
    const other = await prisma.species.create({ data: { scientificName: "Teszt faj szerkesztéshez" } });
    const req = rid();
    await editAnimal(f.admin, id, { requestId: req, speciesId: other.id, sex: "MALE" }, now);
    const a = await prisma.animal.findUniqueOrThrow({ where: { id } });
    expect([a.speciesId, a.sex]).toEqual([other.id, "MALE"]);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: req } });
    expect([audit.action, audit.entityType, audit.entityId]).toEqual(["MASTER_CHANGE", "Animal", id]);
    expect(audit.changes).toMatchObject({ sex: { before: "FEMALE", after: "MALE" }, species: { after: "Teszt faj szerkesztéshez" } });
    // a replay changes nothing more
    expect(await editAnimal(f.admin, id, { requestId: req, sex: "UNKNOWN" }, now)).toEqual({ replayed: true });
  });

  it("the name: a correction (reason needed) fixes the current one; a change opens a new one from now", async () => {
    const id = await arrive("Elgépelt", "2026-02-20");
    await withReasons(() => expectCode(editAnimal(f.admin, id, { requestId: rid(), name: "Elgépelt2", nameMode: "correction" }, now), "REASON_REQUIRED"));
    await editAnimal(f.admin, id, { requestId: rid(), name: "Javított", nameMode: "correction", reason: "elírás a felvételkor" }, now);
    expect((await prisma.animalName.findMany({ where: { animalId: id } })).map((n) => [n.name, n.validTo])).toEqual([["Javított", null]]);
    await editAnimal(f.admin, id, { requestId: rid(), name: "Új név", nameMode: "change" }, now);
    const names = await prisma.animalName.findMany({ where: { animalId: id }, orderBy: { validFrom: "asc" } });
    expect(names.map((n) => [n.name, n.validTo?.getTime() ?? null])).toEqual([["Javított", now.getTime()], ["Új név", null]]);
  });

  it("the arrival: pool, group, time and note corrected as a past fact; the placement follows; a reason is needed", async () => {
    const id = await arrive("Rossz medence", "2026-02-20");
    const arr = await arrivalOf(id);
    await withReasons(() => expectCode(editAnimal(f.admin, id, { requestId: rid(), arrival: { expectedVersion: arr.version, toPoolId: f.pool("KIS") } }, now), "REASON_REQUIRED"));
    const group = await prisma.animalGroup.create({ data: { names: { create: { name: "Szerkesztési csoport", validFrom: at("2026-01-01", "00:00") } } } });
    await editAnimal(
      f.admin,
      id,
      { requestId: rid(), arrival: { expectedVersion: arr.version, toPoolId: f.pool("KIS"), toGroupId: group.id, occurredAtLocal: "2026-02-19T15:30", note: "a karanténból jött" }, reason: "rossz medencébe rögzítve" },
      now,
    );
    const p = await prisma.placement.findMany({ where: { animalId: id } });
    expect(p.map((x) => [x.poolId, x.validFrom.toISOString(), x.validTo])).toEqual([[f.pool("KIS"), at("2026-02-19", "15:30").toISOString(), null]]);
    expect((await prisma.animalGroupMembership.findMany({ where: { animalId: id } })).map((m) => m.groupId)).toEqual([group.id]);
    const after = await arrivalOf(id);
    expect([after.version, after.note, after.id]).toEqual([arr.version + 1, "a karanténból jött", arr.id]);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "Animal", entityId: id, action: "MASTER_CORRECTION" } });
    expect(audit.changes).toMatchObject({ arrivalPool: { before: f.pool("NAGY"), after: f.pool("KIS") }, arrivalNote: { before: null, after: "a karanténból jött" } });
    // the version the form saw is gone now
    await expectCode(editAnimal(f.admin, id, { requestId: rid(), arrival: { expectedVersion: arr.version, note: "x" }, reason: "teszt" }, now), "VERSION_CONFLICT");
  });

  it("an arrival moved after a later event is refused, and nothing changes", async () => {
    const id = await arrive("Áthelyezett", "2026-02-20");
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KARANTEN"), occurredAtLocal: "2026-02-21T09:00", reason: "teszt" }, at("2026-02-21", "10:00"));
    const arr = await arrivalOf(id);
    await expectCode(
      editAnimal(f.admin, id, { requestId: rid(), arrival: { expectedVersion: arr.version, occurredAtLocal: "2026-02-22T09:00" }, reason: "teszt" }, now),
      "LIFECYCLE_INVALID",
    );
    expect((await arrivalOf(id)).occurredAt.getTime()).toBe(arr.occurredAt.getTime());
    expect((await openPlacement(id))?.poolId).toBe(f.pool("KARANTEN"));
  });
});

describe("feeds (DAT-02, TAK-07, T-08)", () => {
  it("a feed in pieces and grams; the default unit must be one of its dimensions; admin only", async () => {
    const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
    const g = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "g" } })).id;
    const db = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "db" } })).id;
    await expectCode(createFeed(f.aq1, { requestId: rid(), typeId: type.id, name: "Teszt rák", dimensions: ["MASS"], defaultUnitId: g }), "ADMIN_ONLY");
    await expectCode(createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Teszt rák", dimensions: ["MASS"], defaultUnitId: db }), "UNIT_DIMENSION");
    const r = await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Teszt rák", dimensions: ["MASS", "COUNT"], defaultUnitId: g });
    const feed = await prisma.feed.findUniqueOrThrow({ where: { id: r.id } });
    expect(feed.allowedDimensions.sort()).toEqual(["COUNT", "MASS"]);
    await updateFeed(f.admin, r.id, { requestId: rid(), active: false });
    expect((await prisma.feed.findUniqueOrThrow({ where: { id: r.id } })).active).toBe(false);
  });

  it("an aquarist who records feeding may add an Egyéb feed, no other type; a read-only one may not (caparium-hibak-4)", async () => {
    const egyeb = await prisma.feedType.findUniqueOrThrow({ where: { code: "EGYEB" } });
    const g = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "g" } })).id;
    const r = await createFeed(f.aq1, { requestId: rid(), typeId: egyeb.id, name: "Teszt egyéb tápláló", dimensions: ["MASS"], defaultUnitId: g });
    const feed = await prisma.feed.findUniqueOrThrow({ where: { id: r.id }, include: { type: true } });
    expect(feed.type.code).toBe("EGYEB");
    expect(await prisma.auditEntry.count({ where: { entityType: "Feed", entityId: r.id, userId: f.aq1.id } })).toBe(1);
    // the change of an existing feed stays the admin's
    await expectCode(updateFeed(f.aq1, r.id, { requestId: rid(), active: false }), "ADMIN_ONLY");
    const reader = await prisma.user.create({ data: { loginId: `olvaso-${rid()}`, fullName: "Olvasó Akvarista", role: "AQUARIST", passwordHash: "x" } });
    await prisma.modulePermission.create({ data: { userId: reader.id, module: "FEEDING", level: "READ" } });
    await expectCode(createFeed({ id: reader.id, role: "AQUARIST" }, { requestId: rid(), typeId: egyeb.id, name: "Teszt olvasó egyéb", dimensions: ["MASS"], defaultUnitId: g }), "READ_ONLY");
  });
});

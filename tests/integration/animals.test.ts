// Animals, lifecycle and feeds against a real database (adatmodell 6., 7., 11.; DAT-05, R-1, NY-20).
// Days in February 2026: no other test file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent, invalidateLifecycleEvent, listAnimals, rebuildAnimal, renameEntity } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createFeed, updateFeed } from "@/lib/feeds";
import { fixtures, rid } from "./fixtures";

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

  it("an aquarist moves an animal today; an earlier day needs an admin and a reason (NY-20 default)", async () => {
    const id = await arrive("Költöző");
    await createLifecycleEvent(f.aq1, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KARANTEN"), occurredAtLocal: "2026-02-03T08:00" }, at("2026-02-03", "08:05"));
    expect((await openPlacement(id))?.poolId).toBe(f.pool("KARANTEN"));
    expect(await prisma.placement.count({ where: { animalId: id } })).toBe(2);
    await expectCode(
      createLifecycleEvent(f.aq1, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-02-03T20:00" }, at("2026-02-04", "08:00")),
      "NOT_TODAY",
    );
    await expectCode(
      createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-02-03T20:00" }, at("2026-02-04", "08:00")),
      "REASON_REQUIRED",
    );
  });

  it("after a death nothing is open, a later event is refused and nothing is written", async () => {
    const id = await arrive("Elhulló");
    await createLifecycleEvent(f.aq1, { requestId: rid(), type: "DEATH", animalId: id, occurredAtLocal: "2026-02-05T07:00" }, at("2026-02-05", "07:30"));
    expect(await openPlacement(id)).toBeNull();
    const events = await prisma.lifecycleEvent.count({ where: { animalId: id } });
    await expectCode(
      createLifecycleEvent(f.aq1, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: "2026-02-05T09:00" }, at("2026-02-05", "09:05")),
      "LIFECYCLE_INVALID",
    );
    expect(await prisma.lifecycleEvent.count({ where: { animalId: id } })).toBe(events);
    const row = (await listAnimals(at("2026-02-06", "09:00"))).find((a) => a.id === id)!;
    expect(row).toMatchObject({ alive: false, ended: { type: "DEATH", day: "2026-02-05" } });
  });

  it("invalidating a death (by its recorder, today) reopens the placement; the arrival under later events cannot go", async () => {
    const id = await arrive("Tévedés");
    const d = await createLifecycleEvent(f.aq1, { requestId: rid(), type: "DEATH", animalId: id, occurredAtLocal: "2026-02-06T07:00" }, at("2026-02-06", "07:30"));
    await invalidateLifecycleEvent(f.aq1, d.eventId, { requestId: rid(), expectedVersion: 1, reason: "rossz állatra rögzítve" }, at("2026-02-06", "08:00"));
    expect((await openPlacement(id))?.poolId).toBe(f.pool("NAGY"));
    const arrival = await prisma.lifecycleEvent.findFirstOrThrow({ where: { animalId: id, type: "ARRIVAL" } });
    await createLifecycleEvent(f.aq1, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: "2026-02-06T09:00" }, at("2026-02-06", "09:05"));
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
    const death = createLifecycleEvent(f.aq1, { requestId: rid(), type: "DEATH", animalId: id, occurredAtLocal: `${d}T09:00` }, at(d, "09:15"));
    const move = createLifecycleEvent(f.aq2, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: `${d}T09:10` }, at(d, "09:15"));
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
    await createLifecycleEvent(f.aq1, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: `${d}T09:00` }, at(d, "09:05"));
    await expectCode(
      createLifecycleEvent(f.aq1, { requestId: rid(), type: "TRANSFER", animalId: id, toPoolId: f.pool("NAGY"), occurredAtLocal: `${d}T09:00` }, at(d, "09:06")),
      "SAME_INSTANT",
    );
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

// Switching an animal group off and on (Lili 2026-10-30, task caparium-csoport-inaktiv; acrobot 38969, 38970). Days in May 2026: no other test
// file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { createGroup, createLifecycleEvent, invalidateLifecycleEvent, listGroupsAdmin, listGroupsWithNames, setGroupActive } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingDayView } from "@/lib/feeding";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let speciesId: string;
beforeAll(async () => {
  f = await fixtures();
  speciesId = (await prisma.species.findFirstOrThrow()).id;
});

const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`);
let n = 0;
const unique = (base: string) => `${base} ${process.pid}-${Date.now()}-${++n}`;

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
}

async function newGroup(base = "Teszt csoport kapcsoló") {
  const name = unique(base);
  const { id } = await createGroup(f.admin, { requestId: rid(), name });
  return { id, name };
}

async function arrive(name: string, groupId: string | null, day = "2026-05-11") {
  const r = await createLifecycleEvent(
    f.admin,
    { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name, sex: "FEMALE" }, toPoolId: f.pool("NAGY"), toGroupId: groupId, occurredAtLocal: `${day}T09:00`, reason: "teszt" },
    at(day, "10:00"),
  );
  return r.animalId;
}

async function leaveGroup(animalId: string, day = "2026-05-11", time = "12:00") {
  return createLifecycleEvent(
    f.admin,
    { requestId: rid(), type: "GROUP_CHANGE", animalId, toGroupId: null, occurredAtLocal: `${day}T${time}`, reason: "teszt" },
    at(day, "13:00"),
  );
}

const off = (id: string) => setGroupActive(f.admin, id, { requestId: rid(), active: false });
const on = (id: string) => setGroupActive(f.admin, id, { requestId: rid(), active: true });

describe("a group is switched off and on", () => {
  it("an empty group goes off and comes back; the selectors follow, the admin's list keeps it, the change is an audit row", async () => {
    const g = await newGroup();
    expect((await listGroupsWithNames()).some((x) => x.id === g.id)).toBe(true);
    expect(await off(g.id)).toEqual({ replayed: false });
    expect((await listGroupsWithNames()).some((x) => x.id === g.id), "an inactive group is not offered").toBe(false);
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)).toEqual({ id: g.id, name: g.name, active: false, members: 0 });
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "AnimalGroup", entityId: g.id, action: "MASTER_CHANGE" }, orderBy: { id: "desc" } });
    expect(audit.changes).toEqual({ active: { before: true, after: false } });
    await on(g.id);
    expect((await listGroupsWithNames()).some((x) => x.id === g.id)).toBe(true);
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)!.active).toBe(true);
  });

  it("the same request again is a replay, the same state again is refused, an aquarist may not", async () => {
    const g = await newGroup();
    const req = rid();
    expect(await setGroupActive(f.admin, g.id, { requestId: req, active: false })).toEqual({ replayed: false });
    expect(await setGroupActive(f.admin, g.id, { requestId: req, active: false })).toEqual({ replayed: true });
    await expectCode(off(g.id), "NO_CHANGE");
    await expectCode(setGroupActive(f.aq1, g.id, { requestId: rid(), active: true }), "ADMIN_ONLY");
    await expectCode(setGroupActive(f.admin, "00000000-0000-4000-8000-000000000000", { requestId: rid(), active: false }), "NOT_FOUND");
  });

  it("a group with members stays on, and the answer names the members to take out first", async () => {
    const g = await newGroup();
    const a = await arrive(unique("Tag Egy"), g.id);
    const b = await arrive(unique("Tag Kettő"), g.id);
    const e = await expectCode(off(g.id), "GROUP_HAS_MEMBERS");
    expect(e.message).toContain(g.name);
    expect(e.message).toContain("Tag Egy");
    expect(e.message).toContain("Tag Kettő");
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)).toMatchObject({ active: true, members: 2 });
    // one leaves, one is left: still refused; the last leaves: it goes off
    await leaveGroup(a);
    await expectCode(off(g.id), "GROUP_HAS_MEMBERS");
    await leaveGroup(b);
    expect(await off(g.id)).toEqual({ replayed: false });
  });

  it("an inactive group takes no new member (a transfer into it, an arrival into it); switched back on it does", async () => {
    const g = await newGroup();
    const animal = await arrive(unique("Mozgó"), null);
    await off(g.id);
    await expectCode(
      createLifecycleEvent(f.admin, { requestId: rid(), type: "GROUP_CHANGE", animalId: animal, toGroupId: g.id, occurredAtLocal: "2026-05-11T14:00", reason: "teszt" }, at("2026-05-11", "15:00")),
      "GROUP_INACTIVE",
    );
    await expectCode(arrive(unique("Új"), g.id), "GROUP_INACTIVE");
    await on(g.id);
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "GROUP_CHANGE", animalId: animal, toGroupId: g.id, occurredAtLocal: "2026-05-11T14:00", reason: "teszt" }, at("2026-05-11", "15:00"));
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)!.members).toBe(1);
  });
});

describe("the event that takes out the last member says so (the page asks whether to switch the group off)", () => {
  it("the last member leaving names the group; a member leaving a group that keeps others does not", async () => {
    const g = await newGroup();
    const a = await arrive(unique("Első"), g.id);
    const b = await arrive(unique("Második"), g.id);
    const first = await leaveGroup(a);
    expect(first.emptiedGroups).toEqual([]);
    const last = await leaveGroup(b);
    expect(last.emptiedGroups).toEqual([{ id: g.id, name: g.name }]);
    // it is never switched off by itself
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)).toMatchObject({ active: true, members: 0 });
    await off(g.id);
  });

  it("a death, a move to another group and an arrival: the last member's death and its change of group name the emptied group, an arrival names none", async () => {
    const g1 = await newGroup();
    const g2 = await newGroup();
    const dying = await arrive(unique("Elhulló"), g1.id);
    const died = await createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: dying, occurredAtLocal: "2026-05-11T12:00", reason: "teszt" }, at("2026-05-11", "13:00"));
    expect(died.emptiedGroups).toEqual([{ id: g1.id, name: g1.name }]);
    const moving = await arrive(unique("Költöző"), g2.id);
    const g3 = await newGroup();
    const moved = await createLifecycleEvent(f.admin, { requestId: rid(), type: "GROUP_CHANGE", animalId: moving, toGroupId: g3.id, occurredAtLocal: "2026-05-11T12:00", reason: "teszt" }, at("2026-05-11", "13:00"));
    expect(moved.emptiedGroups).toEqual([{ id: g2.id, name: g2.name }]);
    const arrived = await createLifecycleEvent(
      f.admin,
      { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: unique("Érkező"), sex: "FEMALE" }, toPoolId: f.pool("NAGY"), toGroupId: g3.id, occurredAtLocal: "2026-05-11T09:00", reason: "teszt" },
      at("2026-05-11", "10:00"),
    );
    expect(arrived.emptiedGroups).toEqual([]);
  });
});

describe("an invalidation does not put an animal back into an inactive group (barracuda on #155)", () => {
  const invalidate = (eventId: string) => invalidateLifecycleEvent(f.admin, eventId, { requestId: rid(), expectedVersion: 1, reason: "teszt" }, at("2026-05-11", "16:00"));

  it("the event that took the animal out is invalidated while the group is off: refused, nothing changes; on again it works", async () => {
    const g = await newGroup();
    const a = await arrive(unique("Visszatérő"), g.id);
    const left = await leaveGroup(a);
    await off(g.id);
    await expectCode(invalidate(left.eventId), "GROUP_INACTIVE");
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)).toMatchObject({ active: false, members: 0 });
    expect((await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: left.eventId } })).status).toBe("VALID");
    await on(g.id);
    await invalidate(left.eventId);
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)!.members).toBe(1);
  });

  it("the same for a death that is invalidated: the animal would be back in the group it was the last member of", async () => {
    const g = await newGroup();
    const a = await arrive(unique("Elhullt"), g.id);
    const died = await createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: a, occurredAtLocal: "2026-05-11T12:00", reason: "teszt" }, at("2026-05-11", "13:00"));
    await off(g.id);
    await expectCode(invalidate(died.eventId), "GROUP_INACTIVE");
    expect((await listGroupsAdmin()).find((x) => x.id === g.id)!.members).toBe(0);
  });

  it("an invalidation that does not touch the group is not stopped by an inactive group the animal is not in", async () => {
    const g = await newGroup();
    const a = await arrive(unique("Másik"), null);
    const moved = await createLifecycleEvent(f.admin, { requestId: rid(), type: "TRANSFER", animalId: a, toPoolId: f.pool("KARANTEN"), occurredAtLocal: "2026-05-11T12:00", reason: "teszt" }, at("2026-05-11", "13:00"));
    await off(g.id);
    await invalidate(moved.eventId);
    expect((await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: moved.eventId } })).status).toBe("INVALIDATED");
  });
});

describe("the earlier days are as they were", () => {
  it("a day on which the animal was in the group still reads the group, after the group is switched off", async () => {
    const g = await newGroup("Régi nap csoport");
    const a = await arrive(unique("Régi tag"), g.id, "2026-05-11");
    await leaveGroup(a, "2026-05-12", "10:00");
    await off(g.id);
    const view = await feedingDayView("2026-05-11");
    const animal = view.animals.find((x) => x.id === a)!;
    expect(animal.groupId).toBe(g.id);
    expect(animal.groupName).toBe(g.name);
  });
});

// A group's members changed in one step (Lili 2026-11-10, card b98016a1 S1). WHAT TURNS RED: the step not one transaction (a refused
// animal leaving the others changed); not one GROUP_CHANGE event per animal through the usual path (derived rows, audit); a member put in
// again or a non-member taken out not refused by name; an aquarist doing it while the events are admin work; a replay writing twice.
// Days 2026-05-25..28 (group-active.test.ts writes 2026-05-11, group-placement-fix.test.ts 2026-05-20..24).
import { beforeAll, describe, expect, it } from "vitest";
import { changeGroupMembers, createGroup, createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let speciesId: string;
const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`);
let n = 0;
const unique = (base: string) => `${base} ${process.pid}-${Date.now()}-${++n}`;
const NOW = at("2026-05-28", "12:00");

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
}

async function arrive(name: string, groupId: string | null) {
  return (
    await createLifecycleEvent(
      f.admin,
      { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: unique(name), sex: "UNKNOWN" }, toPoolId: f.pool("NAGY"), toGroupId: groupId, occurredAtLocal: "2026-05-25T09:00", reason: "teszt" },
      at("2026-05-25", "10:00"),
    )
  ).animalId;
}
const memberships = async (animalId: string) =>
  (await prisma.animalGroupMembership.findMany({ where: { animalId }, orderBy: { validFrom: "asc" } })).map((m) => [m.groupId, m.validFrom.toISOString(), m.validTo?.toISOString() ?? null]);

let g = "";
let other = "";
const a: Record<string, string> = {};
beforeAll(async () => {
  f = await fixtures();
  speciesId = (await prisma.species.findFirstOrThrow()).id;
  g = (await createGroup(f.admin, { requestId: rid(), name: unique("Tag csoport") })).id;
  other = (await createGroup(f.admin, { requestId: rid(), name: unique("Masik tag csoport") })).id;
  a.alone = await arrive("Egyedul", null);
  a.elsewhere = await arrive("Masik csoportban", other);
  a.member = await arrive("Mar tag", g);
});

describe("a group's members changed in one step", () => {
  it("puts two in and takes one out at one past moment, one event each, derived and audited", async () => {
    const request = rid("tagok");
    const out = await changeGroupMembers(
      f.admin,
      g,
      { requestId: request, add: [a.alone, a.elsewhere], remove: [a.member], occurredAtLocal: "2026-05-26T08:00", reason: "teszt" },
      NOW,
    );
    expect(out.replayed).toBe(false);
    const moment = at("2026-05-26", "08:00").toISOString();
    expect((await memberships(a.alone)).at(-1)).toEqual([g, moment, null]);
    expect((await memberships(a.elsewhere)).slice(-2)).toEqual([
      [other, at("2026-05-25", "09:00").toISOString(), moment],
      [g, moment, null],
    ]);
    expect((await memberships(a.member)).at(-1)).toEqual([g, at("2026-05-25", "09:00").toISOString(), moment]);
    const events = await prisma.lifecycleEvent.findMany({ where: { requestId: { startsWith: `${request}:` } }, orderBy: { requestId: "asc" } });
    expect(events.map((e) => [e.type, e.animalId, e.toGroupId]).sort()).toEqual(
      [
        ["GROUP_CHANGE", a.alone, g],
        ["GROUP_CHANGE", a.elsewhere, g],
        ["GROUP_CHANGE", a.member, null],
      ].sort(),
    );
    expect(await prisma.auditEntry.count({ where: { requestId: { startsWith: `${request}:` }, entityType: "LifecycleEvent", action: "CREATE" } })).toBe(3);
    // the other group lost its only member: said, not switched off
    expect(out.emptiedGroups.map((x) => x.id)).toEqual([other]);
    // a replay writes nothing
    const count = await prisma.lifecycleEvent.count();
    expect((await changeGroupMembers(f.admin, g, { requestId: request, add: [a.alone], occurredAtLocal: "2026-05-26T08:00", reason: "teszt" }, NOW)).replayed).toBe(true);
    expect(await prisma.lifecycleEvent.count()).toBe(count);
  });

  it("refuses the WHOLE step, naming the animal, when one is already in or not in; an aquarist cannot do it", async () => {
    const before = await prisma.lifecycleEvent.count();
    // a.alone is in g since 05-26; a.member is out: putting a.member back is fine, a.alone again is not
    const e = await expectCode(
      changeGroupMembers(f.admin, g, { requestId: rid("tagok"), add: [a.member, a.alone], occurredAtLocal: "2026-05-27T08:00", reason: "teszt" }, NOW),
      "ALREADY_MEMBER",
    );
    expect(e.message).toMatch(/Egyedul/);
    await expectCode(changeGroupMembers(f.admin, g, { requestId: rid("tagok"), remove: [a.member], occurredAtLocal: "2026-05-27T08:00", reason: "teszt" }, NOW), "NOT_MEMBER");
    expect(await prisma.lifecycleEvent.count()).toBe(before);
    await expectCode(changeGroupMembers(f.aq1, g, { requestId: rid("tagok"), add: [a.member], occurredAtLocal: "2026-05-27T08:00", reason: "teszt" }, NOW), "ADMIN_ONLY");
  });
});

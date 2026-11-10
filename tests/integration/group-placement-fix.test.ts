// Lili 2026-11-10 (Caparium channel 08:39 UTC, go-ahead 08:43:35 UTC): the group placement starts on the arrival day. WHAT TURNS RED: the
// dry run writes; an aquarist runs it; the run writes the derived rows instead of correcting the event; an animal that was in more than
// one group is corrected instead of left out and named; the old event not invalidated, or the new one not audited under the run's request;
// a replay writes twice. Days 2026-05-20..24 (group-active.test.ts writes 2026-05-11 only).
import { beforeAll, describe, expect, it } from "vitest";
import { createGroup, createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fixGroupPlacements } from "@/lib/group-placement-fix";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let speciesId: string;
const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`);
let n = 0;
const unique = (base: string) => `${base} ${process.pid}-${Date.now()}-${++n}`;
const NOW = new Date("2026-05-30T10:00:00+02:00");

const mine: string[] = [];
let g = "";
let g2 = "";
const animal: Record<string, string> = {};

async function arrive(name: string, groupId: string | null) {
  const r = await createLifecycleEvent(
    f.admin,
    { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: unique(name), sex: "UNKNOWN" }, toPoolId: f.pool("NAGY"), toGroupId: groupId, occurredAtLocal: "2026-05-20T09:00", reason: "teszt" },
    at("2026-05-20", "10:00"),
  );
  mine.push(r.animalId);
  return r.animalId;
}
const intoGroup = (animalId: string, groupId: string, day: string) =>
  createLifecycleEvent(f.admin, { requestId: rid(), type: "GROUP_CHANGE", animalId, toGroupId: groupId, occurredAtLocal: `${day}T10:00`, reason: "teszt" }, at(day, "11:00"));

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

beforeAll(async () => {
  f = await fixtures();
  speciesId = (await prisma.species.findFirstOrThrow()).id;
  g = (await createGroup(f.admin, { requestId: rid(), name: unique("Rája csoport") })).id;
  g2 = (await createGroup(f.admin, { requestId: rid(), name: unique("Másik csoport") })).id;
  // later put into its group: the case
  animal.later = await arrive("Kesobb csoportba", null);
  await intoGroup(animal.later, g, "2026-05-24");
  // into the group on arrival: nothing to do
  animal.atArrival = await arrive("Erkezeskor csoportban", g);
  // two group changes: left out and named
  animal.twice = await arrive("Ket csoport", null);
  await intoGroup(animal.twice, g2, "2026-05-21");
  await intoGroup(animal.twice, g, "2026-05-23");
  // into a group on arrival, another one later: left out and named
  animal.moved = await arrive("Atkerult", g2);
  await intoGroup(animal.moved, g, "2026-05-22");
});

const membershipFrom = async (animalId: string) =>
  (await prisma.animalGroupMembership.findMany({ where: { animalId }, orderBy: { validFrom: "asc" } })).map((m) => [m.groupId, m.validFrom.toISOString()]);

describe("the group placement moved to the arrival", () => {
  it("the dry run lists the one case and names the two left out, and writes nothing; an aquarist cannot run it", async () => {
    const events = await prisma.lifecycleEvent.count();
    const audits = await prisma.auditEntry.count();
    const { plan } = (await fixGroupPlacements(f.admin, { requestId: rid(), mode: "plan" }, NOW, mine)) as { plan: Awaited<ReturnType<typeof import("@/lib/group-placement-fix").planGroupPlacementFix>> };
    expect(plan.changes.map((c) => [c.animalId, c.groupId, c.fromDay, c.toDay])).toEqual([[animal.later, g, "2026-05-24", "2026-05-20"]]);
    expect(plan.changes[0]!.to).toBe(new Date(at("2026-05-20", "09:00").getTime() + 1000).toISOString());
    expect(plan.skipped.map((s) => s.animalId).sort()).toEqual([animal.twice, animal.moved].sort());
    expect(plan.skipped.every((s) => /több csoportban is volt/.test(s.reason))).toBe(true);
    expect(await prisma.lifecycleEvent.count()).toBe(events);
    expect(await prisma.auditEntry.count()).toBe(audits);
    await expectCode(fixGroupPlacements(f.aq1, { requestId: rid(), mode: "plan" }, NOW, mine), "ADMIN_ONLY");
  });

  it("the run corrects the event: the old one invalidated, the new one a second after the arrival, the membership derived again, audited under the request", async () => {
    const before = {
      twice: await membershipFrom(animal.twice),
      moved: await membershipFrom(animal.moved),
      atArrival: await membershipFrom(animal.atArrival),
    };
    const old = await prisma.lifecycleEvent.findFirstOrThrow({ where: { animalId: animal.later, type: "GROUP_CHANGE", status: "VALID" } });
    const request = rid("fix");
    const out = (await fixGroupPlacements(f.admin, { requestId: request, mode: "run", reason: "teszt" }, NOW, mine)) as { replayed: boolean };
    expect(out.replayed).toBe(false);
    expect(await membershipFrom(animal.later)).toEqual([[g, new Date(at("2026-05-20", "09:00").getTime() + 1000).toISOString()]]);
    const invalidated = await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: old.id } });
    expect(invalidated.status).toBe("INVALIDATED");
    expect(invalidated.invalidationReason).toMatch(/érkezés napjára/);
    const fresh = await prisma.lifecycleEvent.findFirstOrThrow({ where: { animalId: animal.later, type: "GROUP_CHANGE", status: "VALID" } });
    expect(fresh.requestId).toBe(`${request}:${animal.later}`);
    expect(fresh.toGroupId).toBe(g);
    const audits = await prisma.auditEntry.findMany({ where: { requestId: request }, orderBy: { id: "asc" } });
    expect(audits.map((a) => [a.action, a.entityId])).toEqual([
      ["INVALIDATE", old.id],
      ["CREATE", fresh.id],
    ]);
    // the ones left out and the one already right are untouched
    expect(await membershipFrom(animal.twice)).toEqual(before.twice);
    expect(await membershipFrom(animal.moved)).toEqual(before.moved);
    expect(await membershipFrom(animal.atArrival)).toEqual(before.atArrival);
    // a replay writes nothing; a new run has nothing left
    const count = await prisma.lifecycleEvent.count();
    expect(await fixGroupPlacements(f.admin, { requestId: request, mode: "run", reason: "teszt" }, NOW, mine)).toEqual({ replayed: true });
    expect(await prisma.lifecycleEvent.count()).toBe(count);
    await expectCode(fixGroupPlacements(f.admin, { requestId: rid("fix"), mode: "run", reason: "teszt" }, NOW, mine), "NO_CHANGE");
  });
});

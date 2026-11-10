// A membership's start or end moved from the group card (Lili 2026-11-10, card b98016a1; acrobot 45654). WHAT TURNS RED: the date
// written into the derived rows instead of correcting the event; the old event left valid, or the new one not audited under the
// request; an arrival's or a death's moment corrected here; a moment before the arrival not refused; an aquarist doing it; the
// from-to list missing an ended membership or its end event. Days 2026-05-29..31 (other group files write 2026-05-11..28).
import { beforeAll, describe, expect, it } from "vitest";
import { correctGroupChangeTime, createGroup, createLifecycleEvent, groupMemberships } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let speciesId: string;
const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`);
let n = 0;
const unique = (base: string) => `${base} ${process.pid}-${Date.now()}-${++n}`;
const NOW = at("2026-06-02", "12:00");

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

let g = "";
let animal = "";
let into = "";
let out = "";
let arrival = "";
beforeAll(async () => {
  f = await fixtures();
  speciesId = (await prisma.species.findFirstOrThrow()).id;
  g = (await createGroup(f.admin, { requestId: rid(), name: unique("Datum csoport") })).id;
  const a = await createLifecycleEvent(
    f.admin,
    { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: unique("Datumos"), sex: "UNKNOWN" }, toPoolId: f.pool("NAGY"), toGroupId: null, occurredAtLocal: "2026-05-29T09:00", reason: "teszt" },
    at("2026-05-29", "10:00"),
  );
  animal = a.animalId;
  arrival = a.eventId;
  into = (await createLifecycleEvent(f.admin, { requestId: rid(), type: "GROUP_CHANGE", animalId: animal, toGroupId: g, occurredAtLocal: "2026-05-31T10:00", reason: "teszt" }, at("2026-05-31", "11:00"))).eventId;
  out = (await createLifecycleEvent(f.admin, { requestId: rid(), type: "GROUP_CHANGE", animalId: animal, toGroupId: null, occurredAtLocal: "2026-06-01T10:00", reason: "teszt" }, at("2026-06-01", "11:00"))).eventId;
});

const mine = async () => (await groupMemberships(NOW))[g] ?? [];

describe("a membership's dates corrected from the group card", () => {
  it("lists the ended membership with both ends, the start and end events named", async () => {
    const rows = (await mine()).filter((r) => r.animalId === animal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      from: at("2026-05-31", "10:00").toISOString(),
      to: at("2026-06-01", "10:00").toISOString(),
      start: { id: into, type: "GROUP_CHANGE" },
      end: { id: out, type: "GROUP_CHANGE" },
    });
  });

  it("moves the start: the group change corrected (old invalidated, same group at the new moment), derived again, audited", async () => {
    const request = rid("datum");
    const version = (await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: into } })).version;
    const r = (await correctGroupChangeTime(f.admin, into, { requestId: request, expectedVersion: version, occurredAtLocal: "2026-05-29T12:00", reason: "teszt" }, NOW)) as { eventId: string };
    expect((await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: into } })).status).toBe("INVALIDATED");
    const fresh = await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: r.eventId } });
    expect([fresh.type, fresh.toGroupId, fresh.status, fresh.occurredAt.toISOString()]).toEqual(["GROUP_CHANGE", g, "VALID", at("2026-05-29", "12:00").toISOString()]);
    expect((await mine()).find((m) => m.animalId === animal)?.from).toBe(at("2026-05-29", "12:00").toISOString());
    const audits = await prisma.auditEntry.findMany({ where: { requestId: request, entityType: "LifecycleEvent" }, orderBy: { id: "asc" } });
    expect(audits.map((a) => [a.action, a.entityId])).toEqual([
      ["INVALIDATE", into],
      ["CREATE", r.eventId],
    ]);
    // the end moves the same way
    const outVersion = (await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: out } })).version;
    await correctGroupChangeTime(f.admin, out, { requestId: rid("datum"), expectedVersion: outVersion, occurredAtLocal: "2026-06-01T15:00", reason: "teszt" }, NOW);
    expect((await mine()).find((m) => m.animalId === animal)?.to).toBe(at("2026-06-01", "15:00").toISOString());
  });

  it("refuses a moment that would swap the order of the animal's events (barracuda, #212): a date, not an order", async () => {
    const current = (await mine()).find((m) => m.animalId === animal)!;
    // the start (into the group) moved past the end (out of it): the order would swap
    await expectCode(
      correctGroupChangeTime(f.admin, current.start.id, { requestId: rid(), expectedVersion: current.start.version, occurredAtLocal: "2026-06-01T16:00", reason: "teszt" }, NOW),
      "ORDER_CHANGE",
    );
    // the end moved before the start
    await expectCode(
      correctGroupChangeTime(f.admin, current.end!.id, { requestId: rid(), expectedVersion: current.end!.version, occurredAtLocal: "2026-05-29T11:00", reason: "teszt" }, NOW),
      "ORDER_CHANGE",
    );
  });

  it("refuses an arrival's moment, a moment before the arrival, a stale version and an aquarist", async () => {
    await expectCode(correctGroupChangeTime(f.admin, arrival, { requestId: rid(), expectedVersion: 1, occurredAtLocal: "2026-05-29T08:00", reason: "teszt" }, NOW), "NOT_GROUP_CHANGE");
    const current = (await mine()).find((m) => m.animalId === animal)!;
    await expectCode(
      correctGroupChangeTime(f.admin, current.start.id, { requestId: rid(), expectedVersion: current.start.version, occurredAtLocal: "2026-05-28T08:00", reason: "teszt" }, NOW),
      // before the arrival: the arrival is the neighbouring event, so the order guard stops it first
      "ORDER_CHANGE",
    );
    await expectCode(
      correctGroupChangeTime(f.admin, current.start.id, { requestId: rid(), expectedVersion: current.start.version + 5, occurredAtLocal: "2026-05-30T08:00", reason: "teszt" }, NOW),
      "VERSION_CONFLICT",
    );
    await expectCode(
      correctGroupChangeTime(f.aq1, current.start.id, { requestId: rid(), expectedVersion: current.start.version, occurredAtLocal: "2026-05-30T08:00", reason: "teszt" }, NOW),
      "ADMIN_ONLY",
    );
  });
});

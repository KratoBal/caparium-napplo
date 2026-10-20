// The reason switch (caparium-indoklas-ki, src/lib/reasons.ts). Off (the default): every rule that asked for a
// reason lets the change through without one, and the change is still audited, with an empty reason. On: the
// same calls are refused as before (the other files check the rest of the "on" branch, each at its own rule).
// Days from 17 to 27 November 2026: no other file uses them, no test's journal job reaches them (the latest runs
// on 15 September), and every row is made inside its own test.
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent, editAnimal, invalidateLifecycleEvent } from "@/lib/animals";
import { invalidateBodyWeight, recordBodyWeight } from "@/lib/calculator";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { reopenDay } from "@/lib/journal";
import { getSetting } from "@/lib/master";
import { createMeasurement, invalidateMeasurement, type Actor } from "@/lib/measurements";
import { decidePending } from "@/lib/pending";
import { reasonsRequired } from "@/lib/reasons";
import { dayToDate } from "@/lib/time";
import { fixtures, ownerPrisma, rid, withReasons } from "./fixtures";

/** A Budapest wall-clock time in November (CET, +01:00; the fixtures' cest() is the summer offset). */
const cet = (local: string) => new Date(`${local}:00+01:00`);

let f: Awaited<ReturnType<typeof fixtures>>;
let speciesId: string;
beforeAll(async () => {
  f = await fixtures();
  speciesId = (await prisma.species.findFirstOrThrow()).id;
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

function measure(actor: Actor, day: string, time: string, now: Date, over: Record<string, unknown> = {}) {
  return createMeasurement(
    actor,
    {
      requestId: rid(),
      groupId: f.group("NAPI_NAGY"),
      poolId: f.pool("NAGY"),
      parameterId: f.param("PH"),
      value: "8,12",
      measuredAtLocal: `${day}T${time}`,
      ...over,
    } as Parameters<typeof createMeasurement>[1],
    now,
  );
}

async function auditOf(requestId: string) {
  return prisma.auditEntry.findFirstOrThrow({ where: { requestId } });
}

describe("the switch", () => {
  it("is off by default, and a setting row turns it on", async () => {
    expect(await getSetting(prisma, "reason_required")).toBe("false");
    expect(await reasonsRequired(prisma)).toBe(false);
    expect(await withReasons(() => reasonsRequired(prisma))).toBe(true);
    expect(await reasonsRequired(prisma)).toBe(false);
  });
});

describe("off: no reason is required, the change is still audited", () => {
  it("water: an admin's earlier-day measurement and its invalidation; on, both are refused without a reason", async () => {
    const next = cet("2026-11-18T09:00");
    await withReasons(() => expectCode(measure(f.admin, "2026-11-17", "08:00", next), "REASON_REQUIRED"));
    const req = rid();
    const r = await measure(f.admin, "2026-11-17", "08:00", next, { requestId: req });
    expect(r.measurement.status).toBe("VALID");
    expect(await auditOf(req)).toMatchObject({ userId: f.admin.id, reason: null });

    await withReasons(() =>
      expectCode(invalidateMeasurement(f.admin, r.measurement.id, { requestId: rid(), expectedVersion: 1 }, next), "REASON_REQUIRED"),
    );
    const inv = rid();
    await invalidateMeasurement(f.admin, r.measurement.id, { requestId: inv, expectedVersion: 1 }, next);
    expect(await prisma.measurement.findUniqueOrThrow({ where: { id: r.measurement.id } })).toMatchObject({
      status: "INVALIDATED",
      invalidationReason: null,
    });
    expect(await auditOf(inv)).toMatchObject({ action: "INVALIDATE", userId: f.admin.id, reason: null });
  });

  it("a closed day is reopened without a reason; the reopening row and the audit say who and when", async () => {
    await measure(f.aq1, "2026-11-19", "08:00", cet("2026-11-19T08:00"));
    const day = await prisma.journalDay.findFirstOrThrow({
      where: { kind: "WATER", groupId: f.group("NAPI_NAGY"), businessDay: dayToDate("2026-11-19") },
    });
    await ownerPrisma.journalDay.update({
      where: { id: day.id },
      data: { state: "CLOSED", closeMode: "MANUAL", closedById: f.admin.id, closedAt: cet("2026-11-19T23:00") },
    });
    const input = { requestId: rid(), groupId: f.group("NAPI_NAGY"), day: "2026-11-19" };
    await withReasons(() => expectCode(reopenDay(f.admin, { ...input, requestId: rid() }), "REASON_REQUIRED"));
    await reopenDay(f.admin, input);
    expect((await prisma.journalDay.findUniqueOrThrow({ where: { id: day.id } })).state).toBe("OPEN");
    expect(await prisma.journalReopen.findFirstOrThrow({ where: { journalDayId: day.id } })).toMatchObject({
      reopenedById: f.admin.id,
      reason: null,
    });
    expect(await auditOf(input.requestId)).toMatchObject({ action: "REOPEN", userId: f.admin.id, reason: null });
  });

  it("a pending save is rejected without a reason", async () => {
    const r = await measure(f.aq1, "2026-11-20", "23:40", cet("2026-11-21T00:30"), {
      poolId: f.pool("KIS"),
      clientTimestamp: cet("2026-11-20T23:45").toISOString(),
    });
    expect(r.measurement.status).toBe("PENDING");
    await withReasons(() => expectCode(decidePending(f.admin, r.measurement.id, { requestId: rid(), decision: "reject" }), "REASON_REQUIRED"));
    await decidePending(f.admin, r.measurement.id, { requestId: rid(), decision: "reject" });
    expect(await prisma.measurement.findUniqueOrThrow({ where: { id: r.measurement.id } })).toMatchObject({
      status: "INVALIDATED",
      invalidationReason: null,
    });
  });

  it("animals: an earlier-day event, a name correction and an invalidation, all without a reason", async () => {
    const next = cet("2026-11-24T09:00");
    const arrival = await createLifecycleEvent(
      f.admin,
      { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: "Indoklás nélkül", sex: "FEMALE" }, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-11-23T09:00" },
      next,
    );
    const id = arrival.animalId;

    const move = { type: "TRANSFER" as const, animalId: id, toPoolId: f.pool("KIS"), occurredAtLocal: "2026-11-23T15:00" };
    await withReasons(() => expectCode(createLifecycleEvent(f.admin, { requestId: rid(), ...move }, next), "REASON_REQUIRED"));
    const moved = await createLifecycleEvent(f.admin, { requestId: rid(), ...move }, next);

    await withReasons(() => expectCode(editAnimal(f.admin, id, { requestId: rid(), name: "Javítva", nameMode: "correction" }, next), "REASON_REQUIRED"));
    const corr = rid();
    await editAnimal(f.admin, id, { requestId: corr, name: "Javítva", nameMode: "correction" }, next);
    expect((await prisma.animalName.findMany({ where: { animalId: id } })).map((n) => n.name)).toEqual(["Javítva"]);
    expect(await auditOf(corr)).toMatchObject({ action: "MASTER_CORRECTION", reason: null });

    await withReasons(() =>
      expectCode(invalidateLifecycleEvent(f.admin, moved.eventId, { requestId: rid(), expectedVersion: 1 }, next), "REASON_REQUIRED"),
    );
    await invalidateLifecycleEvent(f.admin, moved.eventId, { requestId: rid(), expectedVersion: 1 }, next);
    expect(await prisma.lifecycleEvent.findUniqueOrThrow({ where: { id: moved.eventId } })).toMatchObject({
      status: "INVALIDATED",
      invalidationReason: null,
    });
  });

  it("body weight: an admin's earlier-day weight and its invalidation", async () => {
    const arrival = await createLifecycleEvent(
      f.admin,
      { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: "Testtömeg indoklás nélkül", sex: "MALE" }, toPoolId: f.pool("NAGY"), occurredAtLocal: "2026-11-25T09:00" },
      cet("2026-11-25T10:00"),
    );
    const now = cet("2026-11-27T09:00");
    const weight = { animalId: arrival.animalId, measuredOn: "2026-11-26", weightKg: "40" };
    await withReasons(() => expectCode(recordBodyWeight(f.admin, { requestId: rid(), ...weight }, now), "REASON_REQUIRED"));
    const w = (await recordBodyWeight(f.admin, { requestId: rid(), ...weight }, now)) as { id: string };
    await withReasons(() => expectCode(invalidateBodyWeight(f.admin, w.id, { requestId: rid(), expectedVersion: 1 }, now), "REASON_REQUIRED"));
    await invalidateBodyWeight(f.admin, w.id, { requestId: rid(), expectedVersion: 1 }, now);
    expect(await prisma.bodyWeight.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ status: "INVALIDATED", invalidationReason: null });
  });
});

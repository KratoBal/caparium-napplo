// Day locks and pending saves (adatmodell 14. terület, K9, R-15; ÁLT-16).
// Days in May 2026, so the job's "every open day before now" never touches other test files' days.
import { beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_USER_ID, prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { plannedClose, recloseDay, reopenDay, runJournalJob } from "@/lib/journal";
import { createMeasurement } from "@/lib/measurements";
import { decidePending } from "@/lib/pending";
import { addDays, dayToDate } from "@/lib/time";
import { cest, fixtures, rid, withReasons } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

function measure(actor: typeof f.aq1, day: string, time: string, now: Date, over: Record<string, unknown> = {}) {
  return createMeasurement(
    actor,
    {
      requestId: rid(),
      groupId: f.group("NAPI_NAGY"),
      poolId: f.pool("KARANTEN"),
      parameterId: f.param("TEMP"),
      value: "24,5",
      measuredAtLocal: `${day}T${time}`,
      ...over,
    } as Parameters<typeof createMeasurement>[1],
    now,
  );
}

async function journal(day: string) {
  return prisma.journalDay.findFirstOrThrow({ where: { kind: "WATER", groupId: f.group("NAPI_NAGY"), businessDay: dayToDate(day) } });
}

describe("automatic close (R-15)", () => {
  it("pre-creates today's locks and closes earlier open days, by the System user, idempotently", async () => {
    await measure(f.aq1, "2026-05-02", "08:00", cest("2026-05-02T08:00"));
    const first = await runJournalJob(cest("2026-05-05T00:05"));
    expect(first.closed).toBeGreaterThanOrEqual(1);
    const j = await journal("2026-05-02");
    expect(j).toMatchObject({ state: "CLOSED", closeMode: "AUTOMATIC", closedById: SYSTEM_USER_ID });
    expect(j.closedAt?.toISOString()).toBe(plannedClose("2026-05-02").toISOString());
    expect(await prisma.journalDay.count({ where: { businessDay: dayToDate("2026-05-05") } })).toBeGreaterThanOrEqual(2);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: j.id, action: "CLOSE" } });
    expect(audit.userId).toBe(SYSTEM_USER_ID);
    const second = await runJournalJob(cest("2026-05-05T00:06"));
    expect(second.closed).toBe(0);
  });

  it("the planned close is the next local midnight, also on the 25-hour day", () => {
    expect(plannedClose("2026-10-24").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(plannedClose("2026-10-25").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("a save made before midnight still counts after the automatic close, within the grace period (K9)", async () => {
    await measure(f.aq1, "2026-05-06", "08:00", cest("2026-05-06T08:00"));
    await runJournalJob(cest("2026-05-07T00:01"));
    expect((await journal("2026-05-06")).state).toBe("CLOSED");
    const late = await measure(f.aq1, "2026-05-06", "23:55", cest("2026-05-07T00:10"), {
      poolId: f.pool("NAGY"),
      clientTimestamp: cest("2026-05-06T23:56").toISOString(),
    });
    expect(late.measurement).toMatchObject({ status: "VALID", businessDay: "2026-05-06" });
    // and a save made after midnight for the closed day is refused for an aquarist
    await expectCode(
      measure(f.aq1, "2026-05-06", "23:58", cest("2026-05-07T00:20"), {
        poolId: f.pool("KIS"),
        clientTimestamp: cest("2026-05-07T00:19").toISOString(),
      }),
      "NOT_TODAY",
    );
  });
});

describe("reopen and close again (ÁLT-16)", () => {
  it("admin only, with a reason; the job leaves a reopened day open; the manual close is audited", async () => {
    await measure(f.aq1, "2026-05-08", "08:00", cest("2026-05-08T08:00"));
    await runJournalJob(cest("2026-05-09T00:05"));
    const input = { requestId: rid(), groupId: f.group("NAPI_NAGY"), day: "2026-05-08", reason: "papírról pótolt mérések" };
    await expectCode(reopenDay(f.aq1, input), "ADMIN_ONLY");
    await withReasons(() => expectCode(reopenDay(f.admin, { ...input, reason: undefined }), "REASON_REQUIRED"));
    await reopenDay(f.admin, input);
    expect((await journal("2026-05-08")).state).toBe("OPEN");
    await runJournalJob(cest("2026-05-10T00:05"));
    expect((await journal("2026-05-08")).state).toBe("OPEN");
    await recloseDay(f.admin, { requestId: rid(), groupId: f.group("NAPI_NAGY"), day: "2026-05-08" }, cest("2026-05-10T09:00"));
    const j = await journal("2026-05-08");
    expect(j).toMatchObject({ state: "CLOSED", closeMode: "MANUAL", closedById: f.admin.id });
    const actions = (await prisma.auditEntry.findMany({ where: { entityId: j.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["CLOSE", "REOPEN", "CLOSE"]);
    // only a closed day can be reopened; reopened again, it is still an earlier day for an aquarist (DN-09)
    await reopenDay(f.admin, { ...input, requestId: rid() });
    await expectCode(reopenDay(f.admin, { ...input, requestId: rid() }), "NOT_CLOSED");
    await expectCode(measure(f.aq1, "2026-05-08", "09:00", cest("2026-05-10T09:10"), { poolId: f.pool("KIS") }), "NOT_TODAY");
  });
});

describe("pending saves (K9)", () => {
  async function pending(day: string, pool: string) {
    const r = await measure(f.aq1, day, "23:40", cest(`${addDays(day, 1)}T00:30`), {
      poolId: f.pool(pool),
      clientTimestamp: cest(`${day}T23:45`).toISOString(),
    });
    expect(r.measurement.status).toBe("PENDING");
    return r.measurement.id;
  }

  it("an admin approves one and rejects another (with a reason); an aquarist cannot decide", async () => {
    const a = await pending("2026-05-12", "NAGY");
    const b = await pending("2026-05-12", "KIS");
    await expectCode(decidePending(f.aq1, a, { requestId: rid(), decision: "approve" }), "ADMIN_ONLY");
    await decidePending(f.admin, a, { requestId: rid(), decision: "approve" });
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: a } })).status).toBe("VALID");
    await withReasons(() => expectCode(decidePending(f.admin, b, { requestId: rid(), decision: "reject" }), "REASON_REQUIRED"));
    await decidePending(f.admin, b, { requestId: rid(), decision: "reject", reason: "a mérést nem így végezték" });
    const rb = await prisma.measurement.findUniqueOrThrow({ where: { id: b } });
    expect(rb).toMatchObject({ status: "INVALIDATED", invalidationReason: "a mérést nem így végezték" });
    const audit = await prisma.auditEntry.findMany({ where: { entityId: { in: [a, b] } }, orderBy: { id: "asc" } });
    expect(audit.map((x) => x.action)).toEqual(["PENDING_CREATED", "PENDING_CREATED", "PENDING_APPROVED", "PENDING_REJECTED"]);
  });

  it("approving into a cell that already has a valid value is a conflict, not a duplicate", async () => {
    const p = await pending("2026-05-14", "NAGY");
    await measure(f.admin, "2026-05-14", "23:41", cest("2026-05-15T09:00"), { poolId: f.pool("NAGY"), reason: "admin pótolta" });
    await expectCode(decidePending(f.admin, p, { requestId: rid(), decision: "approve" }), "CELL_TAKEN");
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: p } })).status).toBe("PENDING");
  });
});

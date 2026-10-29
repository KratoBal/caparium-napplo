// Measurement rules against a real PostgreSQL (adatmodell 4. és 14. terület, K5, K6, K9).
// Every test uses its own business day, so the tests do not depend on each other.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  createMeasurement,
  invalidateMeasurement,
  openNewRound,
  updateMeasurement,
  type Actor,
} from "@/lib/measurements";
import { getGrid } from "@/lib/queries";
import { cest, fixtures, ownerPrisma, rid, withReasons } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function expectAppError(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  expect((e as AppError).status).toBe(status);
  return e as AppError;
}

function create(actor: Actor, day: string, time: string, over: Record<string, unknown> = {}, now?: Date) {
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
    now ?? cest(`${day}T${time}`),
  );
}

describe("create", () => {
  it("stores the exact value, the business day, the reference and an audit entry in one go", async () => {
    const r = await create(f.aq1, "2026-06-01", "08:06");
    expect(r.measurement).toMatchObject({ value: "8.12", businessDay: "2026-06-01", status: "VALID", version: 1 });
    const row = await prisma.measurement.findUniqueOrThrow({ where: { id: r.measurement.id } });
    expect(row.referenceRangeId).not.toBeNull();
    const audit = await prisma.auditEntry.findMany({ where: { entityId: r.measurement.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "CREATE", userId: f.aq1.id });
    expect((audit[0].changes as Record<string, { after: unknown }>).value.after).toBe("8.12");
  });

  it("a repeated request id does not save twice (ÁLT-15 retry)", async () => {
    const requestId = rid("retry");
    const first = await create(f.aq1, "2026-06-02", "08:00", { requestId });
    const second = await create(f.aq1, "2026-06-02", "08:00", { requestId });
    expect(second.replayed).toBe(true);
    expect(second.measurement.id).toBe(first.measurement.id);
    expect(await prisma.measurement.count({ where: { requestId } })).toBe(1);
  });

  it("two first entries into the same cell: the second gets a conflict, not a silent duplicate (T-02)", async () => {
    await create(f.aq1, "2026-06-03", "08:00");
    const e = await expectAppError(create(f.aq2, "2026-06-03", "08:01", { value: "8.20" }), 409, "CELL_TAKEN");
    expect((e.details?.existing as { value: string }).value).toBe("8.12");
    const valid = await prisma.measurement.count({
      where: { businessDay: new Date("2026-06-03T00:00:00Z"), poolId: f.pool("NAGY"), parameterId: f.param("PH"), status: "VALID" },
    });
    expect(valid).toBe(1);
    const rejected = await prisma.auditEntry.count({ where: { action: "CONFLICT_REJECTED", userId: f.aq2.id } });
    expect(rejected).toBeGreaterThan(0);
  });

  it("an implausible value needs confirmation (JAV-02)", async () => {
    await expectAppError(create(f.aq1, "2026-06-04", "08:00", { value: "81,2" }), 422, "IMPLAUSIBLE_VALUE");
    const ok = await create(f.aq1, "2026-06-04", "08:00", { value: "81,2", parameterId: f.param("PH"), confirmPlausibility: true });
    expect(ok.measurement.value).toBe("81.2");
  });

  it("rejects a pool or parameter outside the group", async () => {
    await expectAppError(create(f.aq1, "2026-06-05", "08:00", { poolId: f.pool("KORALLOS") }), 422, "NOT_IN_GROUP");
  });

  it("rejects a non-number", async () => {
    await expectAppError(create(f.aq1, "2026-06-05", "08:00", { value: "nyolc" }), 422, "INVALID_VALUE");
  });
});

describe("day rules (DN-09, ÁLT-16)", () => {
  it("an aquarist cannot record on an earlier day; an admin can, with a reason", async () => {
    const nextMorning = cest("2026-06-07T09:00");
    await expectAppError(create(f.aq1, "2026-06-06", "08:00", {}, nextMorning), 403, "NOT_TODAY");
    await withReasons(() => expectAppError(create(f.admin, "2026-06-06", "08:00", {}, nextMorning), 422, "REASON_REQUIRED"));
    const ok = await create(f.admin, "2026-06-06", "08:00", { reason: "papírról utólag bevitt mérés" }, nextMorning);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: ok.measurement.id } });
    expect(audit.reason).toBe("papírról utólag bevitt mérés");
  });

  // Lili 2026-10-29 (Caparium thread 1565398519064297503): another aquarist's value of today is correctable too, and the
  // audit names who changed it; a past day stays the admin's
  it("an aquarist edits another's entry of today too, audited under their name; not a past day", async () => {
    const r = await create(f.aq1, "2026-06-08", "08:00");
    const now = cest("2026-06-08T09:00");
    const edit = rid();
    const up = (await updateMeasurement(f.aq2, r.measurement.id, { requestId: edit, expectedVersion: 1, value: "8.2" }, now)) as { measurement: { id: string; version: number } };
    expect((await prisma.auditEntry.findFirstOrThrow({ where: { requestId: edit } })).userId).toBe(f.aq2.id);
    await expectAppError(
      updateMeasurement(f.aq1, up.measurement.id, { requestId: rid(), expectedVersion: up.measurement.version, value: "8.3" }, cest("2026-06-09T08:00")),
      403,
      "NOT_TODAY",
    );
    // its author still edits it, on the version the other one left
    const ok = await updateMeasurement(f.aq1, up.measurement.id, { requestId: rid(), expectedVersion: up.measurement.version, value: "8,4" }, now);
    expect(ok.measurement).toMatchObject({ value: "8.4", version: up.measurement.version + 1 });
  });

  it("an aquarist cannot move a measurement to another day; an admin can with a reason (R-6)", async () => {
    const r = await create(f.aq1, "2026-06-10", "08:00");
    const now = cest("2026-06-10T09:00");
    await expectAppError(
      updateMeasurement(f.aq1, r.measurement.id, { requestId: rid(), expectedVersion: 1, measuredAtLocal: "2026-06-09T20:00" }, now),
      403,
      "NOT_TODAY",
    );
    const moved = await updateMeasurement(
      f.admin,
      r.measurement.id,
      { requestId: rid(), expectedVersion: 1, measuredAtLocal: "2026-06-09T20:00", reason: "rossz napra került" },
      now,
    );
    expect(moved.measurement.businessDay).toBe("2026-06-09");
    const round = await prisma.measurementRound.findUniqueOrThrow({ where: { id: moved.measurement.roundId } });
    expect(round.businessDay.toISOString().slice(0, 10)).toBe("2026-06-09");
  });

  it("a module permission READ makes the aquarist read-only (R-17)", async () => {
    const reader = await prisma.user.create({
      data: { loginId: `olvaso-${Date.now()}`, fullName: "Csak Olvasó", role: "AQUARIST" },
    });
    await prisma.modulePermission.create({ data: { userId: reader.id, module: "WATER", level: "READ" } });
    await expectAppError(create({ id: reader.id, role: "AQUARIST" }, "2026-06-11", "08:00"), 403, "READ_ONLY");
  });
});

describe("concurrency (T-02)", () => {
  it("a stale version is a conflict, recorded in the audit, and the stored value stays", async () => {
    const r = await create(f.aq1, "2026-06-12", "08:00");
    const now = cest("2026-06-12T09:00");
    await updateMeasurement(f.aq1, r.measurement.id, { requestId: rid(), expectedVersion: 1, value: "8.3" }, now);
    const e = await expectAppError(
      updateMeasurement(f.aq1, r.measurement.id, { requestId: rid(), expectedVersion: 1, value: "8.0" }, now),
      409,
      "VERSION_CONFLICT",
    );
    expect((e.details?.current as { value: string }).value).toBe("8.3");
    const row = await prisma.measurement.findUniqueOrThrow({ where: { id: r.measurement.id } });
    expect(row.value.toString()).toBe("8.3");
    expect(await prisma.auditEntry.count({ where: { entityId: r.measurement.id, action: "CONFLICT_REJECTED" } })).toBe(1);
  });

  it("parallel edits with the same version: exactly one wins", async () => {
    const r = await create(f.aq1, "2026-06-13", "08:00");
    const now = cest("2026-06-13T09:00");
    const results = await Promise.allSettled(
      ["8.1", "8.2", "8.3"].map((v) =>
        updateMeasurement(f.aq1, r.measurement.id, { requestId: rid(), expectedVersion: 1, value: v }, now),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const row = await prisma.measurement.findUniqueOrThrow({ where: { id: r.measurement.id } });
    expect(row.version).toBe(2);
  });
});

describe("repeated measurement on a day (VIZ-23, T-07)", () => {
  it("a new round keeps the earlier value, and the daily view shows the latest measurement time", async () => {
    const day = "2026-06-14";
    await create(f.aq1, day, "08:02", { value: "8.08" });
    const { round } = await openNewRound(f.aq1, { requestId: rid(), groupId: f.group("NAPI_NAGY"), day }, cest(`${day}T08:20`));
    expect(round.seq).toBe(2);
    await create(f.aq1, day, "08:25", { value: "8.10", roundId: round.id }, cest(`${day}T08:25`));
    const grid = await getGrid(f.group("NAPI_NAGY"), day);
    const key = `${f.pool("NAGY")}:${f.param("PH")}`;
    expect(grid!.rounds.map((r) => r.seq)).toEqual([1, 2]);
    expect(grid!.daily[key].value).toBe("8.1");
    const round1 = await getGrid(f.group("NAPI_NAGY"), day, 1);
    expect(round1!.cells[key].value).toBe("8.08");
  });
});

describe("invalidation (K5: no physical delete)", () => {
  it("needs a reason, keeps the row, and frees the cell", async () => {
    const r = await create(f.aq1, "2026-06-15", "08:00");
    const now = cest("2026-06-15T09:00");
    const inv = await invalidateMeasurement(f.aq1, r.measurement.id, { requestId: rid(), expectedVersion: 1, reason: "rossz medence" }, now);
    expect(inv.measurement.status).toBe("INVALIDATED");
    const again = await create(f.aq1, "2026-06-15", "08:30", { value: "8.15" }, now);
    expect(again.measurement.status).toBe("VALID");
    expect(await prisma.measurement.count({ where: { id: r.measurement.id } })).toBe(1);
  });
});

describe("late save (K9)", () => {
  it("within the grace period the client time decides the day", async () => {
    const clientTimestamp = cest("2026-06-16T23:50").toISOString();
    const r = await create(f.aq1, "2026-06-16", "23:45", { clientTimestamp }, cest("2026-06-17T00:10"));
    expect(r.measurement).toMatchObject({ status: "VALID", businessDay: "2026-06-16" });
  });

  it("beyond the grace period the save is kept as PENDING, not lost, and stays out of the cell", async () => {
    const clientTimestamp = cest("2026-06-18T23:50").toISOString();
    const r = await create(f.aq1, "2026-06-18", "23:45", { clientTimestamp }, cest("2026-06-19T00:45"));
    expect(r.measurement.status).toBe("PENDING");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: r.measurement.id } });
    expect(audit.action).toBe("PENDING_CREATED");
    expect(audit.clientTimestamp?.toISOString()).toBe(clientTimestamp);
    // a pending row does not block the cell
    const other = await create(f.admin, "2026-06-18", "23:46", { reason: "teszt" }, cest("2026-06-19T00:46"));
    expect(other.measurement.status).toBe("VALID");
  });
});

describe("late save upper bound (review of PR #1, point B)", () => {
  it("a client timestamp a week old is not trusted: the aquarist is denied, no pending row", async () => {
    const clientTimestamp = cest("2026-06-24T10:00").toISOString();
    const before = await prisma.measurement.count({ where: { status: "PENDING" } });
    await expectAppError(
      createMeasurement(
        f.aq1,
        {
          requestId: rid(),
          clientTimestamp,
          groupId: f.group("NAPI_NAGY"),
          poolId: f.pool("NAGY"),
          parameterId: f.param("PH"),
          value: "8.1",
          measuredAtLocal: "2026-06-24T09:55",
        },
        cest("2026-07-01T10:00"),
      ),
      403,
      "NOT_TODAY",
    );
    expect(await prisma.measurement.count({ where: { status: "PENDING" } })).toBe(before);
  });
});

describe("stale client time without a measurement time (review of #1, note)", () => {
  it("is refused instead of becoming a measurement of today", async () => {
    const before = await prisma.measurement.count();
    await expectAppError(
      createMeasurement(
        f.aq1,
        {
          requestId: rid(),
          clientTimestamp: cest("2026-06-25T10:00").toISOString(),
          groupId: f.group("NAPI_NAGY"),
          poolId: f.pool("NAGY"),
          parameterId: f.param("PH"),
          value: "8.1",
        },
        cest("2026-07-02T10:00"),
      ),
      422,
      "STALE_CLIENT_TIME",
    );
    expect(await prisma.measurement.count()).toBe(before);
  });
});

describe("weekly measurement (VIZ-05, VIZ-06, DN-07)", () => {
  it("stores dilution and RO/SW as supplementary data, the entered value stays as entered", async () => {
    const r = await create(f.aq1, "2026-06-26", "09:00", {
      groupId: f.group("HETI"),
      poolId: f.pool("KORALLOS"),
      parameterId: f.param("NO3"),
      value: "8,4",
      dilution: 10,
      diluentWater: "RO",
    });
    expect(r.measurement).toMatchObject({ value: "8.4", dilution: 10, diluentWater: "RO" });
    // a dilution change alone is an audited edit; the value is not recalculated
    const now = cest("2026-06-26T09:30");
    const u = await updateMeasurement(f.aq1, r.measurement.id, { requestId: rid(), expectedVersion: 1, value: "8.4", dilution: 20, diluentWater: "SW" }, now);
    expect(u.measurement).toMatchObject({ value: "8.4", dilution: 20, diluentWater: "SW", version: 2 });
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: r.measurement.id, action: "UPDATE" } });
    expect(audit.changes).toMatchObject({ dilution: { before: 10, after: 20 }, diluentWater: { before: "RO", after: "SW" } });
    expect((audit.changes as Record<string, unknown>).value).toBeUndefined();
  });

  it("rejects a dilution outside 1–100", async () => {
    const e = await create(f.aq1, "2026-06-26", "09:00", {
      groupId: f.group("HETI"),
      poolId: f.pool("INKUBATOR"),
      parameterId: f.param("CA"),
      value: "420",
      dilution: 101,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect((e as AppError).code).toBe("INVALID_DILUTION");
  });

  it("dilution and RO/SW only on the nitrate and the phosphate, in every pool (caparium-hibak-1)", async () => {
    const grid = await getGrid(f.group("HETI"), "2026-06-27");
    expect(grid!.layout.parameters.filter((p) => p.dilution).map((p) => p.code)).toEqual(["NO3", "PO4"]);
    const refused = (fields: Record<string, unknown>) =>
      create(f.aq1, "2026-06-27", "09:00", { groupId: f.group("HETI"), poolId: f.pool("NAGY"), parameterId: f.param("KH"), value: "8,1", ...fields }).then(
        () => null,
        (err: unknown) => (err as AppError).code,
      );
    expect(await refused({ dilution: 10 })).toBe("DILUTION_NOT_ALLOWED");
    expect(await refused({ diluentWater: "SW" })).toBe("DILUTION_NOT_ALLOWED");
    // the phosphate takes it in a pool of the other daily group too
    const po4 = await create(f.aq1, "2026-06-27", "09:05", { groupId: f.group("HETI"), poolId: f.pool("RAGADOZOS"), parameterId: f.param("PO4"), value: "0,05", dilution: 5, diluentWater: "SW" });
    expect(po4.measurement).toMatchObject({ dilution: 5, diluentWater: "SW" });
    // an undiluted value: an edit may not add one, may clear (null), and an edit without the fields is untouched
    const kh = await create(f.aq1, "2026-06-27", "09:10", { groupId: f.group("HETI"), poolId: f.pool("NAGY"), parameterId: f.param("KH"), value: "8,1" });
    const now = cest("2026-06-27T09:30");
    const add = await updateMeasurement(f.aq1, kh.measurement.id, { requestId: rid(), expectedVersion: 1, dilution: 2 }, now).then(
      () => null,
      (err: unknown) => (err as AppError).code,
    );
    expect(add).toBe("DILUTION_NOT_ALLOWED");
    const cleared = await updateMeasurement(f.aq1, kh.measurement.id, { requestId: rid(), expectedVersion: 1, value: "8.2", dilution: null, diluentWater: null }, now);
    expect(cleared.measurement).toMatchObject({ value: "8.2", dilution: null, diluentWater: null, version: 2 });
  });

  it("the database itself refuses a dilution outside 1–100", async () => {
    const one = await prisma.measurement.findFirstOrThrow();
    await expect(ownerPrisma.measurement.update({ where: { id: one.id }, data: { dilution: 0 } })).rejects.toThrow(/measurement_dilution_range/);
  });
});

describe("reference binding (VIZ-02, R-10)", () => {
  it("an out-of-range value is marked LOW with the range", async () => {
    await create(f.aq1, "2026-06-20", "08:09", { value: "7,88" });
    const grid = await getGrid(f.group("NAPI_NAGY"), "2026-06-20");
    const cell = grid!.cells[`${f.pool("NAGY")}:${f.param("PH")}`];
    expect(cell.reference).toBe("LOW");
    expect(cell.range).toEqual({ min: "8", max: "8.4", unitSymbol: "pH" });
  });

  it("binds the range valid at the measurement time, not at the save time", async () => {
    const ph = f.param("PH");
    const old = await ownerPrisma.referenceRange.findFirstOrThrow({ where: { parameterId: ph, validTo: null } });
    const change = cest("2026-06-22T00:00");
    await ownerPrisma.referenceRange.update({ where: { id: old.id }, data: { validTo: change } });
    const next = await ownerPrisma.referenceRange.create({
      data: { parameterId: ph, min: "7.5", max: "8.4", unitId: old.unitId, validFrom: change, createdById: f.admin.id },
    });
    try {
      // measured on the 21st under the old range, saved on the 22nd by an admin
      const r = await create(f.admin, "2026-06-21", "08:00", { value: "7.9", reason: "papírról" }, cest("2026-06-22T09:00"));
      const row = await prisma.measurement.findUniqueOrThrow({ where: { id: r.measurement.id } });
      expect(row.referenceRangeId).toBe(old.id);
    } finally {
      await ownerPrisma.referenceRange.delete({ where: { id: next.id } });
      await ownerPrisma.referenceRange.update({ where: { id: old.id }, data: { validTo: null } });
    }
  });
});

describe("audit is append-only at the storage level (K6, R-12)", () => {
  it("the application role has no UPDATE, DELETE or TRUNCATE on the audit table", async () => {
    const one = await prisma.auditEntry.findFirstOrThrow();
    await expect(prisma.$executeRaw`UPDATE "audit_entry" SET "reason" = 'x' WHERE "id" = ${one.id}`).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRaw`DELETE FROM "audit_entry" WHERE "id" = ${one.id}`).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRaw`TRUNCATE "audit_entry"`).rejects.toThrow(/permission denied/);
  });

  it("the application role cannot switch the audit triggers off (it does not own the table, review C)", async () => {
    await expect(prisma.$executeRawUnsafe(`ALTER TABLE "audit_entry" DISABLE TRIGGER USER`)).rejects.toThrow(/must be owner/);
    await expect(prisma.$executeRawUnsafe(`DROP TRIGGER "audit_entry_no_update_delete" ON "audit_entry"`)).rejects.toThrow(/must be owner/);
  });

  it("even the owner hits the triggers: UPDATE, DELETE and TRUNCATE are rejected", async () => {
    const one = await ownerPrisma.auditEntry.findFirstOrThrow();
    await expect(ownerPrisma.$executeRaw`UPDATE "audit_entry" SET "reason" = 'x' WHERE "id" = ${one.id}`).rejects.toThrow(/append-only/);
    await expect(ownerPrisma.$executeRaw`DELETE FROM "audit_entry" WHERE "id" = ${one.id}`).rejects.toThrow(/append-only/);
    await expect(ownerPrisma.$executeRaw`TRUNCATE "audit_entry"`).rejects.toThrow(/append-only/);
  });

  it("the application role cannot physically delete a measurement (K5)", async () => {
    const one = await prisma.measurement.findFirstOrThrow();
    await expect(prisma.measurement.delete({ where: { id: one.id } })).rejects.toThrow(/denied|permission/i);
  });

  it("a failed business write leaves no audit entry (one transaction)", async () => {
    const before = await prisma.auditEntry.count();
    await expectAppError(create(f.aq1, "2026-06-23", "08:00", { poolId: f.pool("KORALLOS") }), 422, "NOT_IN_GROUP");
    expect(await prisma.auditEntry.count()).toBe(before);
  });
});

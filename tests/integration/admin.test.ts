// Master data administration (K3 change vs correction, ÁLT-09, VIZ-22, ÁLT-17).
import { beforeAll, describe, expect, it } from "vitest";
import { createUser, renamePool, setReference, updateUser } from "@/lib/admin";
import { login } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { measurementHistory, searchLog } from "@/lib/queries";
import { cest, fixtures, rid } from "./fixtures";

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

describe("reference ranges (DN-08, K3)", () => {
  it("a change opens a new version; a measurement before it keeps its old range", async () => {
    const ca = f.param("CA");
    const m = await createMeasurement(
      f.aq1,
      { requestId: rid(), groupId: f.group("HETI"), poolId: f.pool("KORALLOS"), parameterId: ca, value: "390", measuredAtLocal: "2026-04-01T09:00" },
      cest("2026-04-01T09:05"),
    );
    const old = await prisma.measurement.findUniqueOrThrow({ where: { id: m.measurement.id } });
    await setReference(f.admin, { requestId: rid(), parameterId: ca, min: "400", max: "460", mode: "change" }, cest("2026-04-02T10:00"));
    const ranges = await prisma.referenceRange.findMany({ where: { parameterId: ca }, orderBy: { validFrom: "asc" } });
    expect(ranges).toHaveLength(2);
    expect(ranges[0].validTo?.toISOString()).toBe(cest("2026-04-02T10:00").toISOString());
    expect(ranges[1]).toMatchObject({ validTo: null });
    expect(ranges[1].min?.toString()).toBe("400");
    // the earlier measurement is still bound to the earlier range and still counts as in range
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: old.id } })).referenceRangeId).toBe(ranges[0].id);
    const h = await measurementHistory(old.id);
    expect(h!.measurement.reference).toBe("IN_RANGE");
  });

  it("a correction fixes the current version in place, needs a reason, and is audited as a correction", async () => {
    const kh = f.param("KH");
    await expectCode(setReference(f.admin, { requestId: rid(), parameterId: kh, min: "7", max: "12", mode: "correction" }), "REASON_REQUIRED");
    const before = await prisma.referenceRange.count({ where: { parameterId: kh } });
    await setReference(f.admin, { requestId: rid(), parameterId: kh, min: "7", max: "12", mode: "correction", reason: "elírás a maximumban" });
    expect(await prisma.referenceRange.count({ where: { parameterId: kh } })).toBe(before);
    const a = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "ReferenceRange", action: "MASTER_CORRECTION" }, orderBy: { id: "desc" } });
    expect(a.changes).toMatchObject({ max: { before: "11", after: "12" } });
  });

  it("refuses an aquarist, an empty range and a minimum above the maximum", async () => {
    const p = f.param("MG");
    await expectCode(setReference(f.aq1, { requestId: rid(), parameterId: p, min: "1", max: "2", mode: "change" }), "ADMIN_ONLY");
    await expectCode(setReference(f.admin, { requestId: rid(), parameterId: p, min: null, max: "", mode: "change" }), "EMPTY_RANGE");
    await expectCode(setReference(f.admin, { requestId: rid(), parameterId: p, min: "1500", max: "1400", mode: "change" }), "MIN_ABOVE_MAX");
  });
});

describe("pool names (VIZ-22, K3)", () => {
  it("a rename is a change: the earlier measurement shows the old name, a new one the new name", async () => {
    const pool = f.pool("RAGADOZOS");
    const m = await createMeasurement(
      f.aq1,
      { requestId: rid(), groupId: f.group("NAPI_KIS"), poolId: pool, parameterId: f.param("SAL"), value: "35", measuredAtLocal: "2026-04-03T09:00" },
      cest("2026-04-03T09:05"),
    );
    await renamePool(f.admin, { requestId: rid(), poolId: pool, name: "Ragadozó medence", mode: "change" }, cest("2026-04-04T08:00"));
    const log = await searchLog({ from: "2026-04-03", to: "2026-04-03", poolId: pool });
    expect(log.rows.find((r) => r.id === m.measurement.id)?.poolName).toBe("Ragadozós");
    const names = await prisma.poolName.findMany({ where: { poolId: pool }, orderBy: { validFrom: "asc" } });
    expect(names.map((n) => n.displayName)).toEqual(["Ragadozós", "Ragadozó medence"]);
  });

  it("two active pools cannot carry the same name", async () => {
    await expectCode(renamePool(f.admin, { requestId: rid(), poolId: f.pool("SOZO"), name: "nagymedence", mode: "change" }), "NAME_TAKEN");
  });
});

describe("users (ÁLT-04, ÁLT-06, ÁLT-17)", () => {
  const base = { fullName: "Próba Dolgozó", role: "AQUARIST" as const, zimsName: "Test Worker", password: "proba-jelszo-123" };

  it("an admin creates a user who can log in; the password never enters the audit", async () => {
    const r = await createUser(f.admin, { requestId: rid(), loginId: "proba.dolgozo", monogram: "PD", ...base });
    const ok = await login("proba.dolgozo", "proba-jelszo-123", null);
    expect(ok.ok).toBe(true);
    const a = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "User", entityId: (r as { id: string }).id, action: "MASTER_CHANGE" } });
    expect(JSON.stringify(a.changes)).not.toContain("proba-jelszo-123");
    expect(JSON.stringify(a.changes)).not.toContain("scrypt$");
  });

  it("login ids and active monograms are unique", async () => {
    await expectCode(createUser(f.admin, { requestId: rid(), loginId: "proba.dolgozo", monogram: "PX", ...base }), "LOGIN_TAKEN");
    await expectCode(createUser(f.admin, { requestId: rid(), loginId: "proba.masik", monogram: "pd", ...base }), "MONOGRAM_TAKEN");
  });

  it("deactivation logs the user out and blocks login; the monogram change is versioned", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { loginId: "proba.dolgozo" } });
    await updateUser(f.admin, u.id, { requestId: rid(), monogram: "PDo" });
    const monos = await prisma.userMonogram.findMany({ where: { userId: u.id }, orderBy: { validFrom: "asc" } });
    expect(monos.map((m) => m.monogram)).toEqual(["PD", "PDo"]);
    await updateUser(f.admin, u.id, { requestId: rid(), active: false, reason: "kilépett" });
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    expect((await login("proba.dolgozo", "proba-jelszo-123", null)).ok).toBe(false);
  });

  it("an admin cannot take away their own admin role or account", async () => {
    await expectCode(updateUser(f.admin, f.admin.id, { requestId: rid(), active: false }), "SELF_LOCKOUT");
    await expectCode(updateUser(f.admin, f.admin.id, { requestId: rid(), role: "AQUARIST" }), "SELF_LOCKOUT");
  });

  it("an aquarist cannot manage users", async () => {
    await expectCode(createUser(f.aq1, { requestId: rid(), loginId: "proba.harmadik", monogram: "P3", ...base }), "ADMIN_ONLY");
  });
});

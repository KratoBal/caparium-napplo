// Master data administration (K3 change vs correction, ÁLT-09, VIZ-22, ÁLT-17).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, createUser, renamePool, setReference, updateUser } from "@/lib/admin";
import { login } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { measurementHistory, searchLog } from "@/lib/queries";
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
    await withReasons(() => expectCode(setReference(f.admin, { requestId: rid(), parameterId: kh, min: "7", max: "12", mode: "correction" }), "REASON_REQUIRED"));
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

  it("a SETTINGS=ADMIN override does not make user management possible (review of #2)", async () => {
    const lead = await prisma.user.create({
      data: { loginId: `ref-gazda-${Date.now()}`, fullName: "Referencia Gazda", role: "AQUARIST" },
    });
    await prisma.modulePermission.create({ data: { userId: lead.id, module: "SETTINGS", level: "ADMIN" } });
    const actor = { id: lead.id, role: "AQUARIST" as const };
    // the override is for master data: a reference change is allowed
    await setReference(actor, { requestId: rid(), parameterId: f.param("PO4"), min: null, max: "0.2", mode: "change" });
    // but no self promotion, no new admin, no password of someone else
    await expectCode(updateUser(actor, lead.id, { requestId: rid(), role: "ADMIN" }), "ADMIN_ROLE_ONLY");
    await expectCode(createUser(actor, { requestId: rid(), loginId: "uj.admin.x", monogram: "UX", ...base, role: "ADMIN" }), "ADMIN_ROLE_ONLY");
    await expectCode(updateUser(actor, f.aq2.id, { requestId: rid(), password: "atvett-jelszo-123" }), "ADMIN_ROLE_ONLY");
  });

  it("an admin cannot change their own role in either direction", async () => {
    await expectCode(updateUser(f.admin, f.admin.id, { requestId: rid(), role: "ADMIN" }), "SELF_LOCKOUT");
  });

  it("an aquarist cannot manage users", async () => {
    await expectCode(createUser(f.aq1, { requestId: rid(), loginId: "proba.harmadik", monogram: "P3", ...base }), "ADMIN_ROLE_ONLY");
  });

  /*
    A ZIMS-NÉV ÉRVÉNYESSÉGE (acrobot 34448, a lili-eset 2026-10-21: az első név a létrehozástól élt, a mérések
    visszadátumozva készültek, 136 mérés nem kapott nevet). MI PIROSÍT: ha az első név a beírás pillanatától él;
    ha egy meglévő név átírása választás nélkül átmegy; ha az elírás-javítás új sort nyit, vagy a névváltozás a
    régi sort írja át.
  */
  it("the first ZIMS name is valid from the beginning; a change asks: typo fix (in place) or rename (from now)", async () => {
    const r = (await createUser(f.admin, { requestId: rid(), loginId: "zims.proba", monogram: "ZP", ...base, zimsName: "Tset Worker" })) as { id: string };
    const rows = () => prisma.userZimsName.findMany({ where: { userId: r.id }, orderBy: { validFrom: "asc" } });
    expect((await rows()).map((z) => [z.zimsName, z.validFrom.toISOString(), z.validTo])).toEqual([
      ["Tset Worker", "1970-01-01T00:00:00.000Z", null],
    ]);
    await expectCode(updateUser(f.admin, r.id, { requestId: rid(), zimsName: "Test Worker" }), "ZIMS_NAME_MODE");
    await updateUser(f.admin, r.id, { requestId: rid(), zimsName: "Test Worker", zimsNameMode: "CORRECTION" });
    expect((await rows()).map((z) => [z.zimsName, z.validFrom.toISOString(), z.validTo])).toEqual([
      ["Test Worker", "1970-01-01T00:00:00.000Z", null],
    ]);
    const now = new Date("2026-10-21T08:00:00Z");
    await updateUser(f.admin, r.id, { requestId: rid(), zimsName: "Test Married Name", zimsNameMode: "RENAME" }, now);
    expect((await rows()).map((z) => [z.zimsName, z.validFrom.toISOString(), z.validTo?.toISOString() ?? null])).toEqual([
      ["Test Worker", "1970-01-01T00:00:00.000Z", now.toISOString()],
      ["Test Married Name", now.toISOString(), null],
    ]);
    const audits = await prisma.auditEntry.findMany({ where: { entityType: "User", entityId: r.id, action: "MASTER_CHANGE" }, orderBy: { at: "asc" } });
    expect(audits.map((a) => (a.changes as { zimsNameMode?: { after: string } }).zimsNameMode?.after ?? null)).toEqual([
      null,
      "elírás javítása (a korábbi mérésekre is)",
      "névváltozás (mostantól)",
    ]);
  });
});

// Lili 2026-10-26 (Caparium channel msg 1564351191281049815, point 3; Balázs "Mehet" 1564352369205186581): the admin adds
// a pool. It only ADDS: no existing pool, name, measurement or volume changes, nothing is deleted.
describe("a new pool (Lili 2026-10-26, point 3)", () => {
  const made: string[] = [];
  const tag = `${Date.now()}`.slice(-8);
  const input = (over: Record<string, unknown> = {}) => ({ requestId: rid(), name: `Próba medence ${tag}`, code: `PROBA_${tag}`, volumeLiters: "1250.5", ...over });
  // the shared test database must not keep an active pool without a group: the other specs list the active pools
  afterAll(async () => {
    await prisma.pool.updateMany({ where: { id: { in: made } }, data: { active: false } });
  });

  async function snapshot() {
    const [pools, names, measurements] = await Promise.all([
      prisma.pool.findMany({ orderBy: { code: "asc" } }),
      prisma.poolName.findMany({ orderBy: [{ poolId: "asc" }, { validFrom: "asc" }] }),
      prisma.measurement.count(),
    ]);
    return { pools, names, measurements };
  }

  it("an admin adds a pool with name, code, volume and icon: one new pool, one name, one audit row, everything else untouched", async () => {
    const before = await snapshot();
    const r = (await createPool(f.admin, input({ code: ` proba_${tag} `, emoji: "🐠" }))) as { id: string; replayed: boolean };
    made.push(r.id);
    expect(r.replayed).toBe(false);
    const row = await prisma.pool.findUniqueOrThrow({ where: { id: r.id }, include: { names: true } });
    // the code is stored in capitals, trimmed
    expect([row.code, row.volumeLiters?.toString(), row.emoji, row.active]).toEqual([`PROBA_${tag}`, "1250.5", "🐠", true]);
    expect(row.names.map((n) => [n.displayName, n.validTo])).toEqual([[`Próba medence ${tag}`, null]]);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "Pool", entityId: r.id } });
    expect([audit.action, audit.userId]).toEqual(["MASTER_CHANGE", f.admin.id]);
    expect(audit.changes).toMatchObject({ code: { after: `PROBA_${tag}` }, displayName: { after: `Próba medence ${tag}` }, emoji: { after: "🐠" } });
    // nothing that existed changed: the old pools and names are equal row by row, the measurements are as many
    const after = await snapshot();
    expect(after.pools.filter((p) => p.id !== r.id)).toEqual(before.pools);
    expect(after.names.filter((n) => n.poolId !== r.id)).toEqual(before.names);
    expect([after.pools.length, after.names.length, after.measurements]).toEqual([before.pools.length + 1, before.names.length + 1, before.measurements]);
  });

  it("the icon is optional: without it the pool has none", async () => {
    const r = (await createPool(f.admin, input({ name: `Ikon nélkül ${tag}`, code: `NOICON_${tag}` }))) as { id: string };
    made.push(r.id);
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: r.id } })).emoji).toBeNull();
  });

  it("the same request again adds nothing", async () => {
    const same = input({ name: `Egyszer ${tag}`, code: `EGYSZER_${tag}` });
    const first = (await createPool(f.admin, same)) as { id: string };
    made.push(first.id);
    expect(await createPool(f.admin, same)).toEqual({ replayed: true });
    expect(await prisma.pool.count({ where: { code: `EGYSZER_${tag}` } })).toBe(1);
  });

  it("only an admin: an aquarist is refused, and so is an aquarist with a SETTINGS=ADMIN override; nothing is added", async () => {
    const before = await prisma.pool.count();
    await expectCode(createPool(f.aq1, input({ name: `Akvarista ${tag}`, code: `AKV_${tag}` })), "ADMIN_ROLE_ONLY");
    const lead = await prisma.user.create({ data: { loginId: `medence-gazda-${Date.now()}`, fullName: "Medence Gazda", role: "AQUARIST" } });
    await prisma.modulePermission.create({ data: { userId: lead.id, module: "SETTINGS", level: "ADMIN" } });
    await expectCode(createPool({ id: lead.id, role: "AQUARIST" }, input({ name: `Gazda ${tag}`, code: `GAZDA_${tag}` })), "ADMIN_ROLE_ONLY");
    expect(await prisma.pool.count()).toBe(before);
  });

  it("a taken code or a taken name (any case) is refused, and the volume must be a positive number", async () => {
    await expectCode(createPool(f.admin, input({ name: `Más név ${tag}`, code: "nagy" })), "CODE_TAKEN");
    await expectCode(createPool(f.admin, input({ name: "nagymedence", code: `MASIK_${tag}` })), "NAME_TAKEN");
    await expectCode(createPool(f.admin, input({ name: `Nulla ${tag}`, code: `NULLA_${tag}`, volumeLiters: "0" })), "INVALID_VOLUME");
    await expectCode(createPool(f.admin, input({ name: `Szöveg ${tag}`, code: `SZOVEG_${tag}`, volumeLiters: "sok" })), "INVALID_VOLUME");
    expect(await prisma.pool.count({ where: { code: { in: ["MASIK_" + tag, "NULLA_" + tag, "SZOVEG_" + tag] } } })).toBe(0);
  });
});

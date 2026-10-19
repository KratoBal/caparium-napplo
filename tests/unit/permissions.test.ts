import { describe, expect, it } from "vitest";
import { canCreate, canModify, effectiveLevel, effectiveNow } from "@/lib/permissions";

const today = "2026-10-15";
const yesterday = "2026-10-14";

describe("role and module level (ÁLT-04, R-17)", () => {
  it("role defaults", () => {
    expect(effectiveLevel("AQUARIST", null)).toBe("RECORD");
    expect(effectiveLevel("ADMIN", null)).toBe("ADMIN");
    expect(effectiveLevel("SYSTEM", null)).toBe("NONE");
  });
  it("a module override wins in both directions", () => {
    expect(effectiveLevel("AQUARIST", "ADMIN")).toBe("ADMIN");
    expect(effectiveLevel("ADMIN", "READ")).toBe("READ");
  });
});

describe("create (DN-09)", () => {
  it("aquarist: today and open only", () => {
    expect(canCreate("RECORD", { day: today, today, closed: false })).toEqual({ kind: "ALLOW", reasonRequired: false });
    expect(canCreate("RECORD", { day: yesterday, today, closed: false })).toMatchObject({ kind: "DENY", code: "NOT_TODAY" });
    expect(canCreate("RECORD", { day: today, today, closed: true })).toMatchObject({ kind: "DENY", code: "DAY_CLOSED" });
  });
  it("admin: anything, with a reason on a past or closed day", () => {
    expect(canCreate("ADMIN", { day: today, today, closed: false })).toEqual({ kind: "ALLOW", reasonRequired: false });
    expect(canCreate("ADMIN", { day: yesterday, today, closed: false })).toEqual({ kind: "ALLOW", reasonRequired: true });
    expect(canCreate("ADMIN", { day: today, today, closed: true })).toEqual({ kind: "ALLOW", reasonRequired: true });
  });
  it("read-only and no access", () => {
    expect(canCreate("READ", { day: today, today, closed: false })).toMatchObject({ kind: "DENY", code: "READ_ONLY" });
    expect(canCreate("NONE", { day: today, today, closed: false })).toMatchObject({ kind: "DENY", code: "NO_ACCESS" });
  });
});

describe("modify (ÁLT-05, ÁLT-16, R-6)", () => {
  it("aquarist: only own, today, open", () => {
    expect(canModify("RECORD", { day: today, today, closed: false, isOwn: true })).toMatchObject({ kind: "ALLOW" });
    expect(canModify("RECORD", { day: today, today, closed: false, isOwn: false })).toMatchObject({ code: "NOT_OWN" });
    expect(canModify("RECORD", { day: yesterday, today, closed: false, isOwn: true })).toMatchObject({ code: "NOT_TODAY" });
  });
  it("aquarist cannot move a measurement to another day (R-6)", () => {
    expect(canModify("RECORD", { day: today, today, closed: false, isOwn: true, targetDay: yesterday })).toMatchObject({
      code: "NOT_TODAY",
    });
  });
  it("admin needs a reason when either side is past or closed", () => {
    expect(canModify("ADMIN", { day: today, today, closed: false, isOwn: false })).toEqual({ kind: "ALLOW", reasonRequired: false });
    expect(canModify("ADMIN", { day: today, today, closed: false, isOwn: false, targetDay: yesterday })).toEqual({
      kind: "ALLOW",
      reasonRequired: true,
    });
  });
});

describe("late save (K9)", () => {
  const server = new Date("2026-10-15T22:10:00Z");
  it("within the grace period the client time counts", () => {
    const c = new Date("2026-10-15T21:50:00Z");
    expect(effectiveNow(server, c, 30, 48)).toEqual({ now: c, late: false, clientNow: c });
  });
  it("beyond the grace period it is late", () => {
    const c = new Date("2026-10-15T21:30:00Z");
    expect(effectiveNow(server, c, 30, 48)).toEqual({ now: server, late: true, clientNow: c });
  });
  it("a client time older than the upper bound is ignored, not trusted as late (review #1 B)", () => {
    const weekOld = new Date("2026-10-08T21:30:00Z");
    expect(effectiveNow(server, weekOld, 30, 48)).toEqual({ now: server, late: false, clientNow: null });
  });
  it("a client clock ahead of the server is ignored", () => {
    expect(effectiveNow(server, new Date("2026-10-15T23:00:00Z"), 30, 48)).toEqual({ now: server, late: false, clientNow: null });
  });
});

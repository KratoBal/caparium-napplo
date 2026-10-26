// The new-pool input (Lili 2026-10-26, Caparium channel msg 1564351191281049815, point 3): name, code and volume are
// needed with at least one measurement group, the icon is not; the code is stored in capitals; a name that a spreadsheet would read as a formula is refused.
import { describe, expect, it } from "vitest";
import { createPoolSchema } from "@/lib/admin";

const GROUP = "00000000-0000-4000-8000-000000000001";
const ok = { requestId: "req-00000001", name: "Új medence", code: "UJ_MEDENCE", volumeLiters: "1250", groupIds: [GROUP] };

describe("createPoolSchema", () => {
  it("takes name, code and volume; the icon is optional", () => {
    expect(createPoolSchema.safeParse(ok).success).toBe(true);
    expect(createPoolSchema.safeParse({ ...ok, emoji: "" }).success).toBe(true);
    expect(createPoolSchema.safeParse({ ...ok, emoji: "🐠" }).success).toBe(true);
  });

  it("the code is trimmed and made capital, then checked", () => {
    expect(createPoolSchema.parse({ ...ok, code: "  uj_2 " }).code).toBe("UJ_2");
    for (const bad of ["", "A", "1ABC", "Új", "KIS SOZO", "KIS-SOZO", "A".repeat(31)]) {
      expect(createPoolSchema.safeParse({ ...ok, code: bad }).success, `code "${bad}"`).toBe(false);
    }
  });

  it("at least one measurement group is needed, each an id, the same one counted once", () => {
    const { groupIds: _noGroups, ...noGroups } = ok;
    expect(createPoolSchema.safeParse(noGroups).success).toBe(false);
    expect(createPoolSchema.safeParse({ ...ok, groupIds: [] }).success).toBe(false);
    expect(createPoolSchema.safeParse({ ...ok, groupIds: ["nem-azonosito"] }).success).toBe(false);
    expect(createPoolSchema.parse({ ...ok, groupIds: [GROUP, GROUP] }).groupIds).toEqual([GROUP]);
  });

  it("name and volume are needed; the name is export-safe; the icon must be an icon, not text", () => {
    expect(createPoolSchema.safeParse({ ...ok, name: "" }).success).toBe(false);
    expect(createPoolSchema.safeParse({ ...ok, name: "x" }).success).toBe(false);
    for (const bad of ['=HYPERLINK("http://x")', "+1+1", "-2", "@SUM(A1)"]) {
      expect(createPoolSchema.safeParse({ ...ok, name: bad }).success, `name ${bad}`).toBe(false);
    }
    expect(createPoolSchema.safeParse({ ...ok, name: "Kis-sózó 2" }).success).toBe(true);
    expect(createPoolSchema.safeParse({ ...ok, volumeLiters: "" }).success).toBe(false);
    expect(createPoolSchema.safeParse({ ...ok, volumeLiters: "   " }).success).toBe(false);
    const { volumeLiters: _noVolume, ...noVolume } = ok;
    expect(createPoolSchema.safeParse(noVolume).success).toBe(false);
    expect(createPoolSchema.safeParse({ ...ok, emoji: "abc" }).success).toBe(false);
  });
});

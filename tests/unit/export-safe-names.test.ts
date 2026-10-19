// Names that reach the ZIMS CSV must not be read as formulas when the CSV is opened in a spreadsheet.
import { describe, expect, it } from "vitest";
import { createUserSchema, poolNameSchema, updateUserSchema } from "@/lib/admin";

const user = {
  requestId: "req-00000001",
  loginId: "proba.nev",
  fullName: "Próba Név",
  role: "AQUARIST" as const,
  monogram: "PN",
  zimsName: "Test Worker",
  password: "proba-jelszo-123",
};

describe("export-safe names (review of #3)", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2", "@SUM(A1)", "\t=1"])("refuses %s as a ZIMS name, full name and pool name", (bad) => {
    expect(createUserSchema.safeParse({ ...user, zimsName: bad }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...user, fullName: bad }).success).toBe(false);
    expect(updateUserSchema.safeParse({ requestId: "req-00000002", zimsName: bad }).success).toBe(false);
    expect(poolNameSchema.safeParse({ requestId: "req-00000003", poolId: "00000000-0000-4000-8000-000000000000", name: bad, mode: "change" }).success).toBe(false);
  });
  it("keeps ordinary names, a hyphen inside included", () => {
    expect(createUserSchema.safeParse({ ...user, zimsName: "Anna Kis-Nagy" }).success).toBe(true);
    expect(poolNameSchema.safeParse({ requestId: "req-00000003", poolId: "00000000-0000-4000-8000-000000000000", name: "Kis-sózó", mode: "change" }).success).toBe(true);
  });
});

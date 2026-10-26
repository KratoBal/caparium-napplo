import { describe, expect, it } from "vitest";
import { lifecycleAccessProblem, type LifecycleEventType } from "@/lib/lifecycle-access";

// Lili 2026-10-26 09:51 UTC (Caparium channel msg 1564214896453750805): every lifecycle event is admin work.
// This overrides NY-20 ("an aquarist moves an animal today").
const TYPES: LifecycleEventType[] = ["ARRIVAL", "TRANSFER", "GROUP_CHANGE", "DEATH", "RELEASE"];

describe("who records a lifecycle event (Lili 10-26 overrides NY-20)", () => {
  it("lets an admin record every type", () => {
    for (const type of TYPES) expect(lifecycleAccessProblem("ADMIN", type), type).toBeNull();
  });

  it("refuses a recording or reading aquarist for every type, with a sentence", () => {
    for (const level of ["RECORD", "READ", "NONE"] as const)
      for (const type of TYPES) expect(lifecycleAccessProblem(level, type), `${level} ${type}`).toMatch(/csak adminisztrátor/);
  });

  it("names the arrival differently from the other events", () => {
    expect(lifecycleAccessProblem("RECORD", "ARRIVAL")).toContain("érkezést");
    expect(lifecycleAccessProblem("RECORD", "DEATH")).toContain("elhullás");
  });
});

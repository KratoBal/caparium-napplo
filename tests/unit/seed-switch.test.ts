// The synthetic seed data goes in only where asked (review note on #15): the switch, or the CI runner.
import { describe, expect, it } from "vitest";
import { syntheticWanted } from "@/lib/seed-switch";

describe("syntheticWanted", () => {
  it("on with the switch, on the CI runner unless the switch says 0, off everywhere else", () => {
    expect(syntheticWanted({ CAPARIUM_SEED_SZINTETIKUS: "1" })).toBe(true);
    expect(syntheticWanted({ CI: "true" })).toBe(true);
    expect(syntheticWanted({ CI: "true", CAPARIUM_SEED_SZINTETIKUS: "0" })).toBe(false);
    expect(syntheticWanted({})).toBe(false);
    expect(syntheticWanted({ CAPARIUM_SEED_SZINTETIKUS: "" })).toBe(false);
    expect(syntheticWanted({ CAPARIUM_SEED_SZINTETIKUS: "yes" })).toBe(false);
  });
});

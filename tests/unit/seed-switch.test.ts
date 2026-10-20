// The synthetic seed data goes in only where asked (review note on #15): the switch, or the CI runner.
import { describe, expect, it } from "vitest";
import { initialAnimalsWanted, syntheticWanted } from "@/lib/seed-switch";

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

// The description's starting animals (caparium-hibak-1, acrobot 33316): only on the test system, by its explicit
// mark; the CI fallback and anything unclear mean no.
describe("initialAnimalsWanted", () => {
  it("only an explicit CAPARIUM_SEED_SZINTETIKUS=1", () => {
    expect(initialAnimalsWanted({ CAPARIUM_SEED_SZINTETIKUS: "1" })).toBe(true);
    expect(initialAnimalsWanted({ CAPARIUM_SEED_SZINTETIKUS: " 1 " })).toBe(true);
    expect(initialAnimalsWanted({ CI: "true" })).toBe(false);
    expect(initialAnimalsWanted({})).toBe(false);
    expect(initialAnimalsWanted({ CAPARIUM_SEED_SZINTETIKUS: "0" })).toBe(false);
    expect(initialAnimalsWanted({ CAPARIUM_SEED_SZINTETIKUS: "yes" })).toBe(false);
  });
});

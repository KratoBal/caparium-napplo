import { describe, expect, it } from "vitest";
import { navFor } from "@/lib/nav";

// Lili 2026-10-26 (card f67b1a06, items 6 and 7): "Takarmánylista" directly above "Kimutatások" for everyone,
// the "Állatok" entry for admins only.
const labels = (role: "ADMIN" | "AQUARIST" | "SYSTEM") => navFor(role).map((n) => n.label);

describe("the main navigation", () => {
  it("puts Takarmánylista directly above Kimutatások, for an admin and an aquarist alike", () => {
    for (const role of ["ADMIN", "AQUARIST"] as const) {
      const l = labels(role);
      expect(l.indexOf("Kimutatások") - l.indexOf("Takarmánylista"), role).toBe(1);
    }
  });

  it("shows Állatok to admins only", () => {
    expect(labels("ADMIN")).toContain("Állatok");
    expect(labels("AQUARIST")).not.toContain("Állatok");
    expect(labels("SYSTEM")).not.toContain("Állatok");
    expect(navFor("AQUARIST").some((n) => n.href === "/allatok")).toBe(false);
  });

  it("gives admins the two extra entries after the common ones, and nobody else", () => {
    expect(labels("ADMIN").slice(-2)).toEqual(["Függő mentések", "Beállítások"]);
    for (const role of ["AQUARIST", "SYSTEM"] as const) {
      expect(labels(role)).not.toContain("Függő mentések");
      expect(labels(role)).not.toContain("Beállítások");
    }
  });

  it("keeps every other entry for the aquarist (nothing else was hidden)", () => {
    expect(labels("AQUARIST")).toEqual(labels("ADMIN").filter((l) => !["Állatok", "Függő mentések", "Beállítások"].includes(l)));
    expect(new Set(labels("ADMIN")).size).toBe(labels("ADMIN").length);
  });
});

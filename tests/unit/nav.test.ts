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

  it("gives admins the extra entries after the common ones, and nobody else", () => {
    expect(labels("ADMIN").slice(-4)).toEqual(["Függő mentések", "Állatok", "Beállítások", "Aktivitás"]);
    for (const role of ["AQUARIST", "SYSTEM"] as const) {
      expect(labels(role)).not.toContain("Függő mentések");
      expect(labels(role)).not.toContain("Beállítások");
      expect(labels(role)).not.toContain("Aktivitás");
    }
  });

  it("keeps every other entry for the aquarist (nothing else was hidden)", () => {
    expect(labels("AQUARIST")).toEqual(labels("ADMIN").filter((l) => !["Állatok", "Függő mentések", "Beállítások", "Aktivitás"].includes(l)));
    expect(new Set(labels("ADMIN")).size).toBe(labels("ADMIN").length);
  });

  // Lili 2026-10-26 (caparium-menu-sorrend-szinek): the exact order of her list, and the color group of each entry.
  it("keeps Lili's order for an admin", () => {
    expect(labels("ADMIN")).toEqual([
      "START", "Napi vízmérés", "Heti vízmérés", "Export", "Takarmánynapló", "Evési napló", "Takarmánykivétel",
      "Takarmánykalkulátor", "Vegyszeradagolás", "Vízmérési napló", "Takarmányozási napló", "Takarmányhűtő",
      "Takarmánylista", "Kimutatások", "Függő mentések", "Állatok", "Beállítások", "Aktivitás",
    ]);
  });

  it("puts each entry in its color group, and leaves the rest plain", () => {
    const tone = (label: string) => navFor("ADMIN").find((n) => n.label === label)?.tone;
    for (const l of ["Napi vízmérés", "Heti vízmérés", "Vegyszeradagolás", "Vízmérési napló"]) expect(tone(l), l).toBe("water");
    for (const l of ["Takarmánynapló", "Evési napló", "Takarmánykivétel", "Takarmánykalkulátor", "Takarmányozási napló", "Takarmányhűtő", "Takarmánylista"]) {
      expect(tone(l), l).toBe("feed");
    }
    // the control: the entries Lili marked "szín marad" are really plain, so the two checks above cannot pass on a menu where everything is colored
    for (const l of ["START", "Export", "Kimutatások", "Függő mentések", "Állatok", "Beállítások", "Aktivitás"]) expect(tone(l), l).toBeUndefined();
  });

  // Lili 2026-10-30 11:36-11:37 UTC (card 464e46b8): an emoji before these eight only, "nem raknék mindegyikhez".
  it("puts Lili's emoji before exactly her eight entries, and keeps every label plain text", () => {
    const icons = Object.fromEntries(navFor("ADMIN").filter((n) => n.icon).map((n) => [n.label, n.icon]));
    expect(icons).toEqual({
      "Napi vízmérés": "💧",
      "Heti vízmérés": "📅",
      Takarmánynapló: "🍤",
      "Evési napló": "🦈",
      Takarmánykivétel: "➖",
      Takarmánykalkulátor: "🧮",
      Vegyszeradagolás: "🧪",
      Takarmányhűtő: "🧊",
    });
    // the label is the name alone: no emoji, nothing outside letters, spaces and the hyphen
    for (const n of navFor("ADMIN")) expect(n.label, n.label).toMatch(/^[\p{L} -]+$/u);
  });
});

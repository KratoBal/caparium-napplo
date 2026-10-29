// The "Egyéb" feed's name as one key (Lili's package, item 12 follow-up).
import { describe, expect, it } from "vitest";
import { firstForms, otherKey } from "@/lib/other-name";

describe("otherKey and firstForms", () => {
  it("trimmed, single-spaced, lower case; the form first met is the shown one", () => {
    expect(otherKey("  Spirulina ")).toBe("spirulina");
    expect(otherKey("Tintahal   fej")).toBe("tintahal fej");
    expect(otherKey("ÉLŐ  Rák")).toBe("élő rák");
    expect(firstForms(["Spirulina", " spirulina ", "SPIRULINA", "alga  zöld", "Alga Zöld"])).toEqual(
      new Map([
        ["spirulina", "Spirulina"],
        ["alga zöld", "alga zöld"],
      ]),
    );
  });
  it("different names stay different", () => {
    expect(otherKey("alga")).not.toBe(otherKey("algák"));
  });
});

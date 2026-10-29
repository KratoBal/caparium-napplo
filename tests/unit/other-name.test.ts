// The "Egyéb" feed's name as one key (Lili's package, item 12 follow-up).
import { describe, expect, it } from "vitest";
import { otherKey, otherLabel } from "@/lib/other-name";

describe("otherKey and firstForms", () => {
  it("trimmed, single-spaced, lower case", () => {
    expect(otherKey("  Spirulina ")).toBe("spirulina");
    expect(otherKey("Tintahal   fej")).toBe("tintahal fej");
    expect(otherKey("ÉLŐ  Rák")).toBe("élő rák");
  });
  it("the shown form is the key with a capital first letter, the same whatever was met first", () => {
    for (const form of ["Spirulina", " spirulina ", "SPIRULINA", "sPIRULINA"]) expect(otherLabel(form)).toBe("Spirulina");
    expect(otherLabel("alga   zöld")).toBe("Alga zöld");
    expect(otherLabel("élő RÁK")).toBe("Élő rák");
  });
  it("different names stay different", () => {
    expect(otherKey("alga")).not.toBe(otherKey("algák"));
  });
});

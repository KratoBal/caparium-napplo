// Several recipients of the daily water report (Lili, card c2e15128): the typed list, checked address by address.
import { describe, expect, it } from "vitest";
import { MAX_RECIPIENTS, parseRecipients } from "@/lib/water-mail";

describe("parseRecipients", () => {
  it("commas, semicolons and spaces separate; the same address in any case is kept once, in the typed order", () => {
    expect(parseRecipients(" a@pelda.hu,b@pelda.hu ; A@PELDA.HU  c@pelda.hu\n")).toEqual({
      ok: true,
      list: ["a@pelda.hu", "b@pelda.hu", "c@pelda.hu"],
    });
    expect(parseRecipients("   ")).toEqual({ ok: true, list: [] });
  });

  it("a bad address is named, and the list is not half kept", () => {
    expect(parseRecipients("a@pelda.hu, nem-cim, b@")).toEqual({ ok: false, message: "Érvénytelen e-mail cím: nem-cim, b@." });
  });

  it("at most the limit", () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `c${i}@pelda.hu`).join(", ");
    expect(parseRecipients(many)).toEqual({ ok: false, message: `Legfeljebb ${MAX_RECIPIENTS} címzett adható meg.` });
    expect(parseRecipients(many.split(", ").slice(0, MAX_RECIPIENTS).join(", ")).ok).toBe(true);
  });
});

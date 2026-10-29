// barracuda on #109: what the helper shows follows the refreshed data. WHAT TURNS THIS RED: a shown alert
// keeping its old text after a save, or staying after the alert went; a greeting or another answer touched.
import { describe, expect, it } from "vitest";
import { followAnswer, followNotice, greetingName } from "@/lib/helper-notice";

describe("the shown notice follows the alert", () => {
  it("an alert takes the new text, goes with the alert; a greeting and nothing stay", () => {
    const old = { kind: "alert" as const, text: "14:00 elmúlt, és ma még nincs napi mérés: Kismedence, Korallos." };
    expect(followNotice(old, "14:00 elmúlt, és ma még nincs napi mérés: Korallos.")).toEqual({ kind: "alert", text: "14:00 elmúlt, és ma még nincs napi mérés: Korallos." });
    expect(followNotice(old, undefined)).toBeNull();
    const hello = { kind: "greeting" as const, text: "Szép napot!" };
    expect(followNotice(hello, undefined)).toBe(hello);
    expect(followNotice(null, "valami")).toBeNull();
  });
  it("the open bubble's answer follows only when it was the alert", () => {
    expect(followAnswer("régi", "régi", "új")).toBe("új");
    expect(followAnswer("régi", "régi", undefined)).toBeNull();
    expect(followAnswer("Ma minden napi medence mérve van.", "régi", "új")).toBe("Ma minden napi medence mérve van.");
    expect(followAnswer(null, "régi", "új")).toBeNull();
  });
});

describe("greetingName (Lili 2026-10-29: the login name, not the full name)", () => {
  it("the login name with a capital first letter; the full name where there is no login name", () => {
    expect(greetingName({ loginId: "lili", fullName: "Csehó Lilian" })).toBe("Lili");
    expect(greetingName({ loginId: "vivi", fullName: "Teszt Vivien" })).toBe("Vivi");
    expect(greetingName({ loginId: "  niki ", fullName: "Teszt Nikolett" })).toBe("Niki");
    expect(greetingName({ loginId: "", fullName: "Csehó Lilian" })).toBe("Csehó Lilian");
    expect(greetingName({ fullName: " Csehó Lilian " })).toBe("Csehó Lilian");
  });
});

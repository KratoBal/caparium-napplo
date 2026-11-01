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

describe("greetingName (Lili 2026-11-01, point 17: the user's nickname, else the given name)", () => {
  it("the nickname as set; without one the last word of the official name; the login id is not used", () => {
    expect(greetingName({ nickname: "Lili", fullName: "Csehó Lilian" })).toBe("Lili");
    expect(greetingName({ nickname: "  Vivi ", fullName: "Teszt Vivien" })).toBe("Vivi");
    expect(greetingName({ nickname: "", fullName: "Csehó Lilian" })).toBe("Lilian");
    expect(greetingName({ nickname: null, fullName: " Kovács  Anna Mária " })).toBe("Mária");
    expect(greetingName({ fullName: "Admin" })).toBe("Admin");
  });
});

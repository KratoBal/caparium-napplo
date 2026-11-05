import { describe, expect, it } from "vitest";
import { isNegative, signedTemperature, startsNegative, toggleSign } from "@/lib/fridge-sign";
import { typedOutOfRange } from "@/components/FridgeCard";

// Lili 2026-11-05: the iPhone decimal keypad has no minus sign, so a freezer reading could not be typed. What turns this red: a
// freezer reading typed as 18 that does not save as -18; a fridge that starts on minus; a typed "-" or "+" that does not win over
// the button; a sign doubled or lost by the button; a reading checked against the range without its sign.
describe("the sign a reading starts on", () => {
  it("a freezer starts on minus, a fridge on plus", () => {
    expect(startsNegative("FREEZER")).toBe(true);
    expect(startsNegative("FRIDGE")).toBe(false);
  });
});

describe("signedTemperature", () => {
  it("a freezer's 18 is saved as -18 (the digits typed with the default minus)", () => {
    expect(signedTemperature("18", startsNegative("FREEZER"))).toBe("-18");
    expect(signedTemperature("18,5", true)).toBe("-18,5");
  });
  it("a fridge's 4 stays 4 on the default plus, and -4 when the button is on minus", () => {
    expect(signedTemperature("4", startsNegative("FRIDGE"))).toBe("4");
    expect(signedTemperature("4", true)).toBe("-4");
  });
  it("a typed minus or plus wins over the button and is never doubled", () => {
    expect(signedTemperature("-18", true)).toBe("-18");
    expect(signedTemperature("-18", false)).toBe("-18");
    expect(signedTemperature("−18", false)).toBe("-18");
    expect(signedTemperature("+5", true)).toBe("5");
    expect(signedTemperature("+5", false)).toBe("5");
  });
  it("an empty field stays empty whatever the sign (the save button stays off)", () => {
    expect(signedTemperature("", true)).toBe("");
    expect(signedTemperature("   ", true)).toBe("");
  });
  it("a freezer reading is checked against its negative range WITH the sign", () => {
    expect(typedOutOfRange(signedTemperature("20", true), "-23", "-18")).toBe(false);
    expect(typedOutOfRange(signedTemperature("17", true), "-23", "-18")).toBe(true);
    // without the sign the 20 would read as +20 and be red
    expect(typedOutOfRange("20", "-23", "-18")).toBe(true);
  });
});

describe("isNegative and toggleSign (the sign button)", () => {
  it("reads the typed sign first, else the button's state", () => {
    expect(isNegative("-3", false)).toBe(true);
    expect(isNegative("+3", true)).toBe(false);
    expect(isNegative("3", true)).toBe(true);
    expect(isNegative("3", false)).toBe(false);
    expect(isNegative("", true)).toBe(true);
  });
  it("flips a freezer's default minus to plus and back, keeping the digits", () => {
    const warm = toggleSign("5", true);
    expect(warm).toEqual({ text: "5", negative: false });
    expect(signedTemperature(warm.text, warm.negative)).toBe("5");
    const cold = toggleSign(warm.text, warm.negative);
    expect(signedTemperature(cold.text, cold.negative)).toBe("-5");
  });
  it("flips a typed sign too, and the text holds no sign afterwards", () => {
    const flipped = toggleSign("-20,5", false);
    expect(flipped).toEqual({ text: "20,5", negative: false });
    expect(signedTemperature(flipped.text, flipped.negative)).toBe("20,5");
    expect(toggleSign("+4", true)).toEqual({ text: "4", negative: true });
  });
  it("flips an empty field's state, so the sign can be chosen before the digits", () => {
    expect(toggleSign("", true)).toEqual({ text: "", negative: false });
    expect(toggleSign("", false)).toEqual({ text: "", negative: true });
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { anchorOf, DOUBLE_TAP_MS, DRAG_THRESHOLD, EDGE, isDoubleTap, isDrag, placeToPx, pxToPlace, readPlace, writePlace } from "@/lib/helper-place";

const s = { vw: 1440, vh: 900, fw: 100, fh: 125 };

describe("the helper figure's place", () => {
  it("a place is a fraction of the room: the corners and the middle", () => {
    expect(placeToPx({ fx: 0, fy: 0 }, s)).toEqual({ x: EDGE, y: EDGE });
    expect(placeToPx({ fx: 1, fy: 1 }, s)).toEqual({ x: 1440 - 100 - EDGE, y: 900 - 125 - EDGE });
    const mid = placeToPx({ fx: 0.5, fy: 0.5 }, s);
    expect(mid.x + 50).toBeCloseTo(720, 5);
    expect(mid.y + 62.5).toBeCloseTo(450, 5);
  });

  it("a point outside the screen is pulled inside it, never beyond the edges", () => {
    expect(pxToPlace(-500, -500, s)).toEqual({ fx: 0, fy: 0 });
    expect(pxToPlace(9999, 9999, s)).toEqual({ fx: 1, fy: 1 });
    expect(pxToPlace(NaN, 5, s).fx).toBe(0);
  });

  it("px and place round-trip; after a resize the same place is still inside the new screen", () => {
    const p = pxToPlace(300, 200, s);
    const back = placeToPx(p, s);
    expect(back.x).toBeCloseTo(300, 5);
    expect(back.y).toBeCloseTo(200, 5);
    const phone = { vw: 390, vh: 844, fw: 80, fh: 100 };
    const there = placeToPx({ fx: 1, fy: 1 }, phone);
    expect(there.x + phone.fw).toBeLessThanOrEqual(phone.vw - EDGE);
    expect(there.y + phone.fh).toBeLessThanOrEqual(phone.vh - EDGE);
  });

  it("a screen smaller than the figure leaves it in the corner instead of a negative place", () => {
    const tiny = { vw: 100, vh: 100, fw: 200, fh: 200 };
    expect(pxToPlace(50, 50, tiny)).toEqual({ fx: 0, fy: 0 });
    expect(placeToPx({ fx: 1, fy: 1 }, tiny)).toEqual({ x: EDGE, y: EDGE });
  });

  it("the anchor follows the half the figure stands in, so the bubble opens towards the room", () => {
    expect(anchorOf({ fx: 1, fy: 1 })).toEqual({ horizontal: "right", vertical: "bottom" });
    expect(anchorOf({ fx: 0, fy: 0 })).toEqual({ horizontal: "left", vertical: "top" });
    expect(anchorOf({ fx: 0.49, fy: 0.5 })).toEqual({ horizontal: "left", vertical: "bottom" });
  });

  it("a press is a drag only after the threshold; a tap is not", () => {
    expect(isDrag(DRAG_THRESHOLD - 1, 0)).toBe(false);
    expect(isDrag(0, DRAG_THRESHOLD)).toBe(true);
    expect(isDrag(4, 4)).toBe(false);
    expect(isDrag(5, 5)).toBe(true);
  });

  it("a double tap is two taps close in time and place", () => {
    const a = { t: 1000, x: 10, y: 10 };
    expect(isDoubleTap(null, a)).toBe(false);
    expect(isDoubleTap(a, { t: 1000 + DOUBLE_TAP_MS, x: 12, y: 11 })).toBe(true);
    expect(isDoubleTap(a, { t: 1000 + DOUBLE_TAP_MS + 1, x: 10, y: 10 })).toBe(false);
    expect(isDoubleTap(a, { t: 1100, x: 200, y: 10 })).toBe(false);
  });
});

describe("the stored place (localStorage)", () => {
  const store = new Map<string, string>();
  const original = globalThis.localStorage;
  const install = (broken = false) => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: broken
        ? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } }
        : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    });
  };

  it("is written, read back, and forgotten with null", () => {
    install();
    writePlace("k", { fx: 0.25, fy: 0.75 });
    expect(readPlace("k")).toEqual({ fx: 0.25, fy: 0.75 });
    writePlace("k", null);
    expect(readPlace("k")).toBeNull();
  });

  it("a damaged or foreign value is no place", () => {
    install();
    for (const v of ["", "not json", "null", "[]", '{"fx":"a","fy":1}', '{"fx":1}', '{"fx":null,"fy":0}']) {
      store.set("bad", v);
      expect(readPlace("bad"), v).toBeNull();
    }
    store.set("out", '{"fx":7,"fy":-3}');
    expect(readPlace("out")).toEqual({ fx: 1, fy: 0 });
  });

  it("without storage nothing throws and there is no place", () => {
    install(true);
    expect(() => writePlace("k", { fx: 0.5, fy: 0.5 })).not.toThrow();
    expect(readPlace("k")).toBeNull();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  });
});

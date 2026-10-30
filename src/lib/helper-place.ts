// Where the corner helper figure stands (Lili 2026-10-30, msg 1565719910833721357, acrobot 38772: "húzgálással áthelyezhetők a
// képernyőn?"). The figure can be dragged with a mouse or a finger; its place is a FRACTION of the room it has on the screen (0 to 1
// in each direction), so after a resize or on another screen it is still inside it and in about the same place. The place is a
// viewer's convenience, kept per user in localStorage (as the helper's on/off switch is); no place means the corner.
// Pure, so a unit test reaches the arithmetic.

export type Place = { fx: number; fy: number };

/** The distance (px) a pointer must travel before a press is a drag and not a click. */
export const DRAG_THRESHOLD = 6;
/** Two taps within this many ms (and DOUBLE_TAP_DISTANCE px) put the figure back in its corner. */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_DISTANCE = 24;
/** The space kept between the figure and the screen's edge, as the corner's own 16 px. */
export const EDGE = 16;
/** One arrow key moves the figure this far. */
export const KEY_STEP = 24;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export type Screen = { vw: number; vh: number; fw: number; fh: number };

/** The room the figure's top-left corner has, per direction: from EDGE to (screen - figure - EDGE); never negative. */
function room({ vw, vh, fw, fh }: Screen) {
  return { w: Math.max(0, vw - fw - 2 * EDGE), h: Math.max(0, vh - fh - 2 * EDGE) };
}

/** The figure's top-left corner on the screen for a place. */
export function placeToPx(p: Place, s: Screen): { x: number; y: number } {
  const r = room(s);
  return { x: EDGE + clamp01(p.fx) * r.w, y: EDGE + clamp01(p.fy) * r.h };
}

/** The place for a top-left corner in px; a corner outside the screen is pulled inside it. */
export function pxToPlace(x: number, y: number, s: Screen): Place {
  const r = room(s);
  return { fx: r.w === 0 ? 0 : clamp01((x - EDGE) / r.w), fy: r.h === 0 ? 0 : clamp01((y - EDGE) / r.h) };
}

/**
 * Which edges the figure is anchored by, so its bubble (up to 420 px wide, and tall) opens towards the room there is: the
 * left half anchors by its left edge and opens right, the right half by its right edge and opens left; the lower half by
 * its bottom edge and the bubble above, the upper half by its top edge and the bubble below.
 */
export function anchorOf(p: Place): { horizontal: "left" | "right"; vertical: "top" | "bottom" } {
  return { horizontal: p.fx < 0.5 ? "left" : "right", vertical: p.fy < 0.5 ? "top" : "bottom" };
}

/** A press that moved this far is a drag. */
export const isDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_THRESHOLD;

/** Two taps close in time and place: the figure goes back to its corner. */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, now: { t: number; x: number; y: number }): boolean {
  return prev !== null && now.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= DOUBLE_TAP_DISTANCE;
}

export const placeKey = (userKey: string | undefined): string => `caparium-segito-hely-${userKey ?? "ismeretlen"}`;

/** The stored place, or null (nothing stored, damaged, not numbers, no storage). */
export function readPlace(key: string): Place | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Place> | null;
    if (!v || typeof v.fx !== "number" || typeof v.fy !== "number" || !Number.isFinite(v.fx) || !Number.isFinite(v.fy)) return null;
    return { fx: clamp01(v.fx), fy: clamp01(v.fy) };
  } catch {
    return null;
  }
}

/** Stores the place; null forgets it (the corner). Without storage it is not kept: the figure is in the corner on the next page. */
export function writePlace(key: string, p: Place | null): void {
  try {
    if (p) localStorage.setItem(key, JSON.stringify({ fx: clamp01(p.fx), fy: clamp01(p.fy) }));
    else localStorage.removeItem(key);
  } catch {
    /* not stored */
  }
}

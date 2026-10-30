// "Ne felejtsd el menteni!" (card 0d617f0c): when the reminder is wanted, and its idle timer on a fake clock.
import { describe, expect, it } from "vitest";
import { formComplete, reminderTimer, reminderWanted, REMINDER_IDLE_MS, type ReminderClock } from "@/lib/save-reminder";

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ReminderClock = {
    setTimeout(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return { clock, advance, pending: () => timers.size };
}

describe("formComplete", () => {
  it("is true only when every field has a value, typed or saved", () => {
    const v: Record<string, string> = { a: "8,1", b: " 420 " };
    expect(formComplete(["a", "b"], (k) => v[k])).toBe(true);
    expect(formComplete(["a", "b", "c"], (k) => v[k])).toBe(false);
    expect(formComplete(["a"], () => "  ")).toBe(false);
  });

  it("an empty form is not a filled one", () => {
    expect(formComplete([], () => "x")).toBe(false);
  });
});

describe("reminderWanted", () => {
  it("needs the switch on, a filled form and something unsaved", () => {
    expect(reminderWanted({ on: true, complete: true, unsaved: 2 })).toBe(true);
    expect(reminderWanted({ on: false, complete: true, unsaved: 2 })).toBe(false);
    expect(reminderWanted({ on: true, complete: false, unsaved: 2 })).toBe(false);
    expect(reminderWanted({ on: true, complete: true, unsaved: 0 })).toBe(false);
  });
});

describe("reminderTimer", () => {
  it("speaks after a quiet minute, and an input starts the minute again", () => {
    const { clock, advance } = fakeClock();
    const said: boolean[] = [];
    const t = reminderTimer((on) => said.push(on), clock);
    t.update(true);
    advance(REMINDER_IDLE_MS - 1);
    t.poke();
    advance(REMINDER_IDLE_MS - 1);
    expect(said).toEqual([]);
    advance(1);
    expect(said).toEqual([true]);
  });

  it("is silent while not wanted, and an input does not start it", () => {
    const { clock, advance, pending } = fakeClock();
    const said: boolean[] = [];
    const t = reminderTimer((on) => said.push(on), clock);
    t.poke();
    advance(REMINDER_IDLE_MS * 3);
    expect(said).toEqual([]);
    expect(pending()).toBe(0);
  });

  it("takes the reminder back once saved, and only if it had spoken", () => {
    const { clock, advance, pending } = fakeClock();
    const said: boolean[] = [];
    const t = reminderTimer((on) => said.push(on), clock);
    t.update(true);
    t.update(false); // saved before the minute: nothing was said, nothing to take back
    expect(said).toEqual([]);
    expect(pending()).toBe(0);
    t.update(true);
    advance(REMINDER_IDLE_MS);
    t.update(false);
    expect(said).toEqual([true, false]);
  });

  it("speaks at once when the page is about to be left, only while wanted", () => {
    const { clock, pending } = fakeClock();
    const said: boolean[] = [];
    const t = reminderTimer((on) => said.push(on), clock);
    t.leaving();
    expect(said).toEqual([]);
    t.update(true);
    t.leaving();
    expect(said).toEqual([true]);
    expect(pending()).toBe(0);
  });
});

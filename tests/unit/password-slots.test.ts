// The shared cap on password checks running at once (review 32585): up to max run, up to maxWaiting
// wait in order, anything beyond is refused at once without running.
import { describe, expect, it } from "vitest";
import { Slots } from "@/lib/auth";

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

describe("Slots", () => {
  it("runs two, queues one, refuses the fourth; a finished one hands its slot to the waiting one", async () => {
    const slots = new Slots(2, 1);
    const started: string[] = [];
    const g = { a: gate(), b: gate(), c: gate() };
    const run = (k: "a" | "b" | "c") => slots.run(async () => (started.push(k), await g[k].p, k));
    const a = run("a");
    const b = run("b");
    const c = run("c");
    const d = await slots.run(async () => "d");
    expect(d).toEqual({ ran: false });
    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);
    g.a.open();
    expect(await a).toEqual({ ran: true, value: "a" });
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["a", "b", "c"]);
    g.b.open();
    g.c.open();
    expect([await b, await c]).toEqual([{ ran: true, value: "b" }, { ran: true, value: "c" }]);
    // all slots free again
    expect(await slots.run(async () => "e")).toEqual({ ran: true, value: "e" });
  });

  it("a failing check frees its slot too", async () => {
    const slots = new Slots(1, 0);
    await expect(slots.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await slots.run(async () => 1)).toEqual({ ran: true, value: 1 });
  });
});

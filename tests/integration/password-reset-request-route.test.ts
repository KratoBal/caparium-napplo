// Task e7f9e84d, slice 2 (barracuda on #219): the request route answers WITHOUT waiting for the work, so the time of the answer
// does not tell an unknown login id from an account with an address. WHAT TURNS THIS RED: the route awaiting the work (here a
// work that never ends: the answer would never come).
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/password-reset-mail", async (original) => ({
  ...(await original<typeof import("@/lib/password-reset-mail")>()),
  requestPasswordReset: (identifier: string) => {
    calls.push(identifier);
    return new Promise(() => undefined);
  },
}));

import { POST as requestRoute } from "@/app/api/password-reset/request/route";

const call = (identifier: string) =>
  requestRoute(
    new Request("http://napplo.test/api/password-reset/request", {
      method: "POST",
      headers: { host: "napplo.test", origin: "http://napplo.test", "content-type": "application/json", "x-forwarded-for": "10.66.0.1" },
      body: JSON.stringify({ identifier }),
    }),
  );

describe("the request route", () => {
  it("answers at once and the same, while the work has not ended", async () => {
    const answer = (identifier: string) =>
      Promise.race([call(identifier).then((r) => r.json()), new Promise((_, no) => setTimeout(() => no(new Error("the route waited for the work")), 2000))]);
    const known = await answer("teszt.admin");
    const unknown = await answer("senki-ilyen");
    expect(known).toEqual(unknown);
    expect(calls).toEqual(["teszt.admin", "senki-ilyen"]);
  });
});

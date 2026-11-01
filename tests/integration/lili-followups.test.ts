// barracuda's notes on Lili's round of 2026-11-01 (#168-#173), after the merges: the old Feed.active and Pool.active flags are no
// longer read where a period's end by the calendar leaves them behind; the dosing PDF takes at most a year.
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as dosingRoute } from "@/app/api/exports/dosing/route";
import { POST as excelRoute } from "@/app/api/exports/excel/route";
import { prisma } from "@/lib/db";
import { feedBalance, saveIntakeItem } from "@/lib/feed-intake";
import { createFeed } from "@/lib/feeds";
import { poolInUse } from "@/lib/pool-periods";
import { businessDayOf } from "@/lib/time";
import { fixtures, rid } from "./fixtures";
import { TEST_PASSWORD } from "./global-setup";

const BASE = "http://napplo.test";
let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
beforeAll(async () => {
  f = await fixtures();
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function cookie(): Promise<string> {
  const res = await loginRoute(
    new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { origin: BASE, host: "napplo.test", "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.99.0.${Math.floor(Math.random() * 250)}` },
      body: new URLSearchParams({ loginId: "teszt.admin", password: TEST_PASSWORD }).toString(),
    }),
  );
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
const form = (url: string, c: string, fields: [string, string][]) =>
  new Request(`${BASE}${url}`, { method: "POST", headers: { origin: BASE, host: "napplo.test", "content-type": "application/x-www-form-urlencoded", cookie: c }, body: new URLSearchParams(fields).toString() });

describe("after the merges (barracuda's notes)", () => {
  it("the feed balance leaves out a feed whose period ended by the calendar, even with its old flag still on", async () => {
    const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
    const id = (await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Lejárt időszak", dimensions: ["MASS"], defaultUnitId: unit.g }, new Date("2026-09-01T08:00:00Z"))).id;
    await saveIntakeItem(f.admin, { requestId: rid(), day: "2026-09-02", feedId: id, quantities: [{ value: "100", unitId: unit.g }] }, new Date("2026-09-02T08:00:00+02:00"));
    const listed = async () => (await feedBalance("2026-10-01", "2026-10-02")).some((r) => r.feedId === id);
    // the control: tracked and fed today, no movement in the period, it is listed
    expect(await listed()).toBe(true);
    // its period ends without a write to the flag (as the calendar does)
    await prisma.feedPeriod.updateMany({ where: { feedId: id }, data: { lastDay: new Date("2026-09-30T00:00:00Z") } });
    expect((await prisma.feed.findUniqueOrThrow({ where: { id } })).active).toBe(true);
    expect(await listed()).toBe(false);
  });

  it("the water Excel is named for every pool when every pool in use today is ticked, by the periods", async () => {
    const c = await cookie();
    const ids = (await prisma.pool.findMany({ where: { ...poolInUse(businessDayOf(new Date())), memberships: { some: {} } }, select: { id: true } })).map((p) => p.id);
    expect(ids.length).toBeGreaterThan(3);
    const name = async (pools: string[]) =>
      (await excelRoute(form("/api/exports/excel", c, [["from", "2026-10-01"], ["to", "2026-10-01"], ...pools.map((p): [string, string] => ["pool", p])]))).headers.get("content-disposition");
    expect(await name(ids)).toContain('filename="capasuli_teljes_vizmeres_2026-10-01.xlsx"');
    expect(await name(ids.slice(0, 1))).not.toContain("capasuli_teljes");
  });

  it("the dosing PDF takes at most a year", async () => {
    const c = await cookie();
    const res = await dosingRoute(form("/api/exports/dosing", c, [["from", "2025-01-01"], ["to", "2026-03-01"]]));
    expect(res.status).toBe(422);
    expect((await dosingRoute(form("/api/exports/dosing", c, [["from", "2026-01-01"], ["to", "2026-01-02"]]))).status).toBe(200);
  });
});

// The admin's activity page (card 70cadcf8): one save counts once, in one kind; the system and the logins are out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS, activityHref, clampPeriod, describeSave, ENTITY_LABEL, groupSaves, kindOf, MAX_ACTIVITY_DAYS, readActivityParams, summarize, type ActivityRow } from "@/lib/activity";
import { SYSTEM_USER_ID } from "@/lib/db";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
let next = 0n;
const row = (over: Partial<ActivityRow>): ActivityRow => {
  next += 1n;
  return {
    id: next,
    at: new Date("2026-10-29T08:00:00Z"),
    userId: U1,
    action: "CREATE",
    entityType: "Measurement",
    entityId: `e${next}`,
    requestId: null,
    reason: null,
    ...over,
  };
};

/** Every `entityType: "X"` an audit write names in src, with the file it stands in. */
function auditedEntityTypes(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !path.endsWith("activity.ts")) {
        for (const m of readFileSync(path, "utf8").matchAll(/\bentityType:\s*"(\w+)"/g)) found.set(m[1], path);
      }
    }
  };
  walk(join(__dirname, "../../src"));
  return found;
}

describe("every audited entity type has a kind", () => {
  it("reads the writes in src, and finds the ones it must (the control)", () => {
    const found = auditedEntityTypes();
    // without these the reading itself would be broken, and "no unclassified type" would mean nothing
    for (const t of ["Measurement", "FeedingSelection", "EatingStatus", "Dosing", "User"]) expect(found.has(t), t).toBe(true);
    expect(found.size).toBeGreaterThan(25);
  });

  it("gives each of them a kind", () => {
    const missing = [...auditedEntityTypes()].filter(([t]) => kindOf(t) === null).map(([t, f]) => `${t} (${f})`);
    expect(missing).toEqual([]);
  });

  it("lists each entity type in one kind only", () => {
    const all = ACTIVITY_KINDS.flatMap((k) => k.entityTypes);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("groupSaves", () => {
  it("counts a feeding save once, in Takarmánynapló, whatever eating statuses it also wrote", () => {
    const rows = [
      row({ requestId: "r1", action: "INVALIDATE", entityType: "EatingStatus" }),
      row({ requestId: "r1", entityType: "FeedingSelection" }),
      row({ requestId: "r1", entityType: "EatingStatus" }),
      row({ requestId: "r1", entityType: "EatingStatus" }),
    ];
    const saves = groupSaves(rows);
    expect(saves).toHaveLength(1);
    expect(saves[0].kind).toBe("feeding");
    expect(saves[0].rows).toHaveLength(4);
  });

  it("puts a save that wrote only eating statuses in Evési napló", () => {
    expect(groupSaves([row({ requestId: "r2", entityType: "EatingStatus" })])[0].kind).toBe("eating");
  });

  it("makes each row without a requestId a save of its own", () => {
    expect(groupSaves([row({ entityType: "ExportRun" }), row({ entityType: "ExportRun" })])).toHaveLength(2);
  });

  it("keeps two users' saves apart even under the same requestId", () => {
    const saves = groupSaves([row({ requestId: "same" }), row({ requestId: "same", userId: U2 })]);
    expect(saves.map((s) => s.userId).sort()).toEqual([U1, U2]);
  });

  it("leaves out the system's writes and the logins", () => {
    const saves = groupSaves([
      row({ userId: SYSTEM_USER_ID, entityType: "JournalDay", action: "CLOSE" }),
      row({ action: "LOGIN", entityType: "User" }),
      row({ action: "LOGIN_FAILED", entityType: "User" }),
      row({ action: "LOGOUT", entityType: "User" }),
      row({ requestId: "kept" }),
    ]);
    expect(saves.map((s) => s.rows[0].requestId)).toEqual(["kept"]);
  });

  it("puts an unknown entity type in 'other', not nowhere", () => {
    expect(groupSaves([row({ entityType: "SomethingNew" })])[0].kind).toBe("other");
  });

  it("dates a save by its Budapest business day (23:30 UTC in October is the next day)", () => {
    expect(groupSaves([row({ at: new Date("2026-10-20T22:30:00Z") })])[0].day).toBe("2026-10-21");
    expect(groupSaves([row({ at: new Date("2026-10-20T21:30:00Z") })])[0].day).toBe("2026-10-20");
  });
});

describe("summarize", () => {
  it("one row per day and user, newest day first, counting saves per kind", () => {
    const saves = groupSaves([
      row({ requestId: "a", at: new Date("2026-10-28T08:00:00Z") }),
      row({ requestId: "b", at: new Date("2026-10-29T08:00:00Z") }),
      row({ requestId: "b", at: new Date("2026-10-29T08:00:00Z"), entityType: "MeasurementRound" }),
      row({ requestId: "c", at: new Date("2026-10-29T09:00:00Z"), entityType: "Dosing" }),
      row({ requestId: "d", at: new Date("2026-10-29T09:00:00Z"), userId: U2, entityType: "EatingStatus" }),
    ]);
    expect(summarize(saves)).toEqual([
      { day: "2026-10-29", userId: U1, counts: { water: 1, dosing: 1 }, total: 2 },
      { day: "2026-10-29", userId: U2, counts: { eating: 1 }, total: 1 },
      { day: "2026-10-28", userId: U1, counts: { water: 1 }, total: 1 },
    ]);
  });
});

describe("clampPeriod", () => {
  it("keeps a period up to the limit, and cuts a longer one at its start", () => {
    expect(clampPeriod("2026-10-24", "2026-10-30")).toEqual({ from: "2026-10-24", to: "2026-10-30" });
    expect(clampPeriod("2026-01-01", "2026-10-30")).toEqual({ from: "2026-09-30", to: "2026-10-30" });
    expect(MAX_ACTIVITY_DAYS).toBe(30 + 1);
  });

  it("turns a start after the end into the end day", () => {
    expect(clampPeriod("2026-11-05", "2026-10-30")).toEqual({ from: "2026-10-30", to: "2026-10-30" });
  });
});

describe("labels", () => {
  it("names every entity type of every kind", () => {
    const missing = ACTIVITY_KINDS.flatMap((k) => k.entityTypes).filter((t) => !ENTITY_LABEL[t]);
    expect(missing).toEqual([]);
  });

  it("describes a save action by action", () => {
    const text = describeSave([
      row({ action: "INVALIDATE", entityType: "EatingStatus" }),
      row({ entityType: "FeedingSelection" }),
      row({ entityType: "FeedingSelection" }),
    ]);
    expect(text).toBe("érvénytelenítés: evési állapot; rögzítés: 2 etetett állat");
  });
});

describe("the page's links (barracuda, #136: the second click lost the detail)", () => {
  const keys = (href: string) => [...new URL(href, "http://x").searchParams.keys()];
  const view = { from: "2026-10-24", to: "2026-10-30", filter: U1 };

  it("a cell link from a filtered view names every key once, the filter and the opened person apart", () => {
    const href = activityHref(view, { day: "2026-10-30", person: U1, kind: "export" });
    expect(keys(href).sort()).toEqual(["ember", "fajta", "ig", "ki", "nap", "tol"]);
    const q = new URL(href, "http://x").searchParams;
    expect([q.get("ember"), q.get("ki")]).toEqual([U1, U1]);
  });

  it("a link from an opened cell's page opens the next one with each key once", () => {
    // the shape that broke: the link of a page that already shows a detail
    const opened = readActivityParams(Object.fromEntries(new URL(activityHref(view, { day: "2026-10-30", person: U1, kind: "export" }), "http://x").searchParams));
    const next = activityHref({ from: opened.tol!, to: opened.ig!, filter: opened.ember }, { day: "2026-10-29", person: U2, kind: "water", page: 2 });
    const all = keys(next);
    expect(new Set(all).size).toBe(all.length);
  });

  it("reads a repeated key by its first value, not as missing", () => {
    expect(readActivityParams({ ember: [U1, U2], ki: U2, nap: undefined })).toEqual({ ember: U1, ki: U2 });
  });
});

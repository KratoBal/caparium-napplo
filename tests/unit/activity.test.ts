// The admin's activity page (card 70cadcf8): one save counts once, in one kind; the system and the logins are out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVE_GAP_MINUTES, ACTIVE_LABEL, activeMs, ACTIVITY_KINDS, activityCsv, activityCsvHref, activityHref, clampPeriod, describeSave, ENTITY_LABEL, groupSaves, kindOf, MAX_ACTIVITY_DAYS, readActivityParams, summarize, type ActivityRow } from "@/lib/activity";
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
  it("counts a feeding save once, in Napi etetés, whatever eating statuses it also wrote", () => {
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
      {
        day: "2026-10-29",
        userId: U1,
        counts: { water: 1, dosing: 1 },
        total: 2,
        first: new Date("2026-10-29T08:00:00Z"),
        last: new Date("2026-10-29T09:00:00Z"),
        rows: 3,
        activeMs: 0, // two saves an hour apart: the pause is over the gap
      },
      {
        day: "2026-10-29",
        userId: U2,
        counts: { eating: 1 },
        total: 1,
        first: new Date("2026-10-29T09:00:00Z"),
        last: new Date("2026-10-29T09:00:00Z"),
        rows: 1,
        activeMs: 0,
      },
      {
        day: "2026-10-28",
        userId: U1,
        counts: { water: 1 },
        total: 1,
        first: new Date("2026-10-28T08:00:00Z"),
        last: new Date("2026-10-28T08:00:00Z"),
        rows: 1,
        activeMs: 0,
      },
    ]);
  });

  // Lili 2026-11-11 (task caparium-aktivitas-idosav): how long the data entry took. The span is the day's first save's start
  // and its last save's end, whatever order the saves came in, and a save that writes for a while ends at its last row.
  it("gives each day and person the first save's start and the last save's end, and the rows behind the saves", () => {
    const saves = groupSaves([
      row({ requestId: "late", at: new Date("2026-10-29T14:10:00Z") }),
      row({ requestId: "early", at: new Date("2026-10-29T06:05:00Z") }),
      row({ requestId: "long", at: new Date("2026-10-29T10:00:00Z"), entityType: "FeedingDay" }),
      row({ requestId: "long", at: new Date("2026-10-29T14:20:00Z"), entityType: "EatingStatus" }),
    ]);
    const [day] = summarize(saves);
    expect([day.first.toISOString(), day.last.toISOString(), day.total, day.rows]).toEqual([
      "2026-10-29T06:05:00.000Z",
      "2026-10-29T14:20:00.000Z",
      3,
      4,
    ]);
  });
});

describe("the active time (Lili 2026-11-11: how long the data entry took)", () => {
  const t = (hm: string) => new Date(`2026-10-29T${hm}:00Z`);
  const min = 60_000;
  it("counts the saves' own spans and the pauses up to the gap, never a longer pause", () => {
    expect(ACTIVE_GAP_MINUTES).toBe(30);
    // 08:00-08:05, a 10 minute pause, 08:15-08:20, a 40 minute pause (not counted), 09:00-09:02
    expect(
      activeMs([
        { start: t("09:00"), end: t("09:02") },
        { start: t("08:00"), end: t("08:05") },
        { start: t("08:15"), end: t("08:20") },
      ]),
    ).toBe((5 + 10 + 5 + 2) * min);
  });

  it("a pause of exactly the gap counts, one minute more does not; overlapping saves count once", () => {
    expect(activeMs([{ start: t("08:00"), end: t("08:00") }, { start: t("08:30"), end: t("08:30") }])).toBe(30 * min);
    expect(activeMs([{ start: t("08:00"), end: t("08:00") }, { start: t("08:31"), end: t("08:31") }])).toBe(0);
    expect(activeMs([{ start: t("08:00"), end: t("08:10") }, { start: t("08:05"), end: t("08:12") }])).toBe(12 * min);
  });

  it("the summary carries it per day and person, and the CSV shows it as h:mm under a header that names the gap", () => {
    const saves = groupSaves([
      row({ requestId: "a", at: t("08:00") }),
      row({ requestId: "b", at: t("08:20") }),
      row({ requestId: "b", at: t("08:25"), entityType: "MeasurementRound" }),
    ]);
    const [day] = summarize(saves);
    expect(day.activeMs).toBe(25 * min);
    const csv = activityCsv([day], () => "Lili");
    const [head, line] = csv.slice(1).split("\r\n");
    expect(head.split(";")[4]).toBe(ACTIVE_LABEL);
    expect(ACTIVE_LABEL).toContain("30 percnél hosszabb szünet nélkül");
    expect(line.split(";")[4]).toBe("0:25");
  });
});

describe("the CSV of the summary (task caparium-aktivitas-idosav)", () => {
  it("has the page's rows with the local times, semicolons, a BOM, and a quoted name where it needs one", () => {
    const saves = groupSaves([
      row({ requestId: "a", at: new Date("2026-10-29T06:05:00Z") }),
      row({ requestId: "b", at: new Date("2026-10-29T14:20:00Z"), entityType: "Dosing" }),
    ]);
    const csv = activityCsv(summarize(saves), () => "Kovács; Lili");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const [head, line, rest] = csv.slice(1).split("\r\n");
    expect(head.split(";").slice(0, 7)).toEqual(["Nap", "Felhasználó", "Első mentés", "Utolsó mentés", ACTIVE_LABEL, "Mentések", "Sorok"]);
    expect(head.split(";").slice(7)).toEqual(ACTIVITY_KINDS.map((k) => k.label));
    // 06:05 and 14:20 UTC on 29 October are 07:05 and 15:20 in Budapest (CET); the 8 hour pause is not active time
    expect(line).toBe(`2026-10-29;"Kovács; Lili";07:05;15:20;0:00;2;2;1;0;0;0;1;0;0;0;0`);
    expect(rest).toBe("");
  });

  it("downloads the view's period and filter", () => {
    expect(activityCsvHref({ from: "2026-10-01", to: "2026-10-31", filter: U2 })).toBe(`/api/aktivitas/csv?tol=2026-10-01&ig=2026-10-31&ember=${U2}`);
    expect(activityCsvHref({ from: "2026-10-01", to: "2026-10-31" })).toBe("/api/aktivitas/csv?tol=2026-10-01&ig=2026-10-31");
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

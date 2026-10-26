// Named feeding lists (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1; Balázs "Mehet" 1564357004217159823):
// an admin composes them, a user applies one to the day: it ticks its animals and adds its feeds, and only adds.
// Days in November 2027, a month no other spec uses (the shared database).
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { AppError } from "@/lib/errors";
import { feedingDayView, saveFeedingItem, setDayFeeds, setSelection } from "@/lib/feeding";
import { activeFeedingLists, applyFeedingList, archiveFeedingList, createFeedingList, updateFeedingList } from "@/lib/feeding-lists";
import { dayToDate } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

const selected = async (day: string) => (await feedingDayView(day)).animals.filter((x) => x.selected).map((x) => x.name).sort();
const dayFeedIds = async (day: string) => (await prisma.feedingDay.findUnique({ where: { businessDay: dayToDate(day) } }))?.feedIds.sort() ?? [];

describe("composing the lists (admin only)", () => {
  it("an admin creates a list; an aquarist cannot; a list needs a member and a free name", async () => {
    const input = { requestId: rid(), name: "Puhatestű nap", animalIds: [a["Teszt Egy"]], feedIds: [feed["Teszt kagyló"]] };
    await expectCode(createFeedingList(f.aq1, input), "ADMIN_ONLY");
    const r = (await createFeedingList(f.admin, input)) as { id: string };
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "FeedingList", entityId: r.id } });
    expect([audit.action, audit.userId]).toEqual(["MASTER_CHANGE", f.admin.id]);
    expect((await activeFeedingLists()).find((l) => l.id === r.id)).toMatchObject({ name: "Puhatestű nap", animalIds: [a["Teszt Egy"]], feedIds: [feed["Teszt kagyló"]] });
    // the same request again adds nothing
    expect(await createFeedingList(f.admin, input)).toEqual({ replayed: true });
    expect((await activeFeedingLists()).filter((l) => l.name === "Puhatestű nap")).toHaveLength(1);
    // a name is free once per active list, in any case
    await expectCode(createFeedingList(f.admin, { ...input, requestId: rid(), name: "puhatestű NAP" }), "NAME_TAKEN");
    // a list needs a member; unknown members are refused
    const empty = await createFeedingList(f.admin, { requestId: rid(), name: "Üres lista", animalIds: [], feedIds: [] }).then(() => null, (e: unknown) => e);
    expect((empty as Error).name).toBe("ZodError");
    await expectCode(createFeedingList(f.admin, { requestId: rid(), name: "Ismeretlen", animalIds: ["00000000-0000-4000-8000-000000000001"], feedIds: [] }), "ANIMAL_NOT_FOUND");
    await expectCode(createFeedingList(f.admin, { requestId: rid(), name: "Ismeretlen 2", animalIds: [], feedIds: ["00000000-0000-4000-8000-000000000001"] }), "FEED_NOT_FOUND");
  });

  it("an edit replaces the members, an archive frees the name and takes the list out of the dropdown", async () => {
    const r = (await createFeedingList(f.admin, { requestId: rid(), name: "Szerkesztett", animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], feedIds: [] })) as { id: string };
    await expectCode(updateFeedingList(f.aq1, { requestId: rid(), listId: r.id, name: "Szerkesztett", animalIds: [a["Teszt Három"]], feedIds: [] }), "ADMIN_ONLY");
    await updateFeedingList(f.admin, { requestId: rid(), listId: r.id, name: "Szerkesztett 2", animalIds: [a["Teszt Három"]], feedIds: [feed["Teszt hal"]] });
    expect((await activeFeedingLists()).find((l) => l.id === r.id)).toMatchObject({ name: "Szerkesztett 2", animalIds: [a["Teszt Három"]], feedIds: [feed["Teszt hal"]] });
    await archiveFeedingList(f.admin, { requestId: rid(), listId: r.id });
    expect((await activeFeedingLists()).some((l) => l.id === r.id)).toBe(false);
    // the archived list keeps its row, and its name is free again
    expect(await prisma.feedingList.count({ where: { id: r.id, active: false } })).toBe(1);
    await createFeedingList(f.admin, { requestId: rid(), name: "Szerkesztett 2", animalIds: [a["Teszt Egy"]], feedIds: [] });
    await expectCode(applyFeedingList(f.aq1, { requestId: rid(), day: "2027-11-14", listId: r.id }, at("2027-11-14", "08:00")), "LIST_NOT_FOUND");
  });
});

describe("picking a list: the day's selection becomes that list; no list takes everything off", () => {
  const monday = "2027-11-08";
  const mk = async (name: string, animalNames: string[], feedNames: string[]) =>
    ((await createFeedingList(f.admin, { requestId: rid(), name, animalIds: animalNames.map((n) => a[n]), feedIds: feedNames.map((n) => feed[n]) })) as { id: string }).id;

  it("ticks the list's animals and chooses its feeds, and takes off what was on the day and is not in it; a second pick changes nothing", async () => {
    // the day already has an animal ticked and a feed chosen by a person
    await setSelection(f.aq1, { requestId: rid(), day: monday, animalIds: [a["Teszt Három"]], selected: true }, at(monday, "07:50"));
    await setDayFeeds(f.aq1, { requestId: rid(), day: monday, feedIds: [feed["Teszt kagyló"]] }, at(monday, "07:51"));
    const list = await mk("Hétfői lista", ["Teszt Egy", "Teszt Kettő"], ["Teszt hal"]);
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: monday, listId: list }, at(monday, "08:00"));
    expect(r).toMatchObject({ name: "Hétfői lista", added: 2, removed: 1, skipped: [], feeds: 1 });
    expect(await selected(monday)).toEqual(["Teszt Egy", "Teszt Kettő"]);
    expect(await dayFeedIds(monday)).toEqual([feed["Teszt hal"]]);
    // again: nothing new
    expect(await applyFeedingList(f.aq1, { requestId: rid(), day: monday, listId: list }, at(monday, "08:05"))).toMatchObject({ added: 0, removed: 0 });
  });

  it("a second list REPLACES the first (it does not pile up), and what a person ticks by hand after the pick stays", async () => {
    const other = await mk("Másik lista", ["Teszt Három"], ["Teszt kagyló"]);
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: monday, listId: other }, at(monday, "08:10"));
    expect(r).toMatchObject({ added: 1, removed: 2, feeds: 1 });
    expect(await selected(monday)).toEqual(["Teszt Három"]);
    expect(await dayFeedIds(monday)).toEqual([feed["Teszt kagyló"]]);
    // by hand afterwards: free
    await setSelection(f.aq1, { requestId: rid(), day: monday, animalIds: [a["Teszt Négy"]], selected: true }, at(monday, "08:15"));
    expect(await selected(monday)).toEqual(["Teszt Négy", "Teszt Három"].sort());
  });

  it("no list (the switch off) takes the whole selection and the day's feeds off", async () => {
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: monday, listId: null }, at(monday, "08:20"));
    expect(r).toMatchObject({ name: null, added: 0, removed: 2, feeds: 0 });
    expect(await selected(monday)).toEqual([]);
    expect(await dayFeedIds(monday)).toEqual([]);
  });

  it("an animal that already has an item is taken off only after the confirmation, and nothing changes before it", async () => {
    const tuesday = "2027-11-09";
    const keep = await mk("Keddi lista", ["Teszt Egy"], ["Teszt hal"]);
    await setSelection(f.aq1, { requestId: rid(), day: tuesday, animalIds: [a["Teszt Kettő"]], selected: true }, at(tuesday, "07:50"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: tuesday, animalId: a["Teszt Kettő"], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] } as Parameters<typeof saveFeedingItem>[1], at(tuesday, "07:55"));
    await expectCode(applyFeedingList(f.aq1, { requestId: rid(), day: tuesday, listId: keep }, at(tuesday, "08:00")), "HAS_RECORDS");
    expect(await selected(tuesday)).toEqual(["Teszt Kettő"]);
    expect(await dayFeedIds(tuesday)).toEqual([]);
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: tuesday, listId: keep, confirmCascade: true }, at(tuesday, "08:01"));
    expect(r).toMatchObject({ added: 1, removed: 1 });
    expect(await selected(tuesday)).toEqual(["Teszt Egy"]);
    expect(await prisma.feedingItem.count({ where: { animalId: a["Teszt Kettő"], status: "VALID", feedingDay: { businessDay: dayToDate(tuesday) } } })).toBe(0);
  });

  it("a day with feeds chosen and a list with none: the day's feeds are cleared (every feed is offered again)", async () => {
    const wednesday = "2027-11-10";
    await setDayFeeds(f.aq1, { requestId: rid(), day: wednesday, feedIds: [feed["Teszt hal"]] }, at(wednesday, "07:50"));
    const list = await mk("Szerdai lista", ["Teszt Egy"], []);
    expect(await applyFeedingList(f.aq1, { requestId: rid(), day: wednesday, listId: list }, at(wednesday, "08:00"))).toMatchObject({ added: 1, feeds: 0 });
    expect(await dayFeedIds(wednesday)).toEqual([]);
    // and a list with feeds on a day with none chosen: the day's feeds become the list's
    const withFeeds = await mk("Szerdai lista 2", ["Teszt Egy"], ["Teszt hal", "Teszt kagyló"]);
    expect(await applyFeedingList(f.aq1, { requestId: rid(), day: wednesday, listId: withFeeds }, at(wednesday, "08:05"))).toMatchObject({ feeds: 2 });
    expect(await dayFeedIds(wednesday)).toEqual([feed["Teszt hal"], feed["Teszt kagyló"]].sort());
  });

  it("an animal with a manual fasting day is left out and named; the day's permissions are the list's: an earlier day is admin work", async () => {
    const thursday = "2027-11-11";
    await setEatingStatus(f.aq1, { requestId: rid(), day: thursday, animalId: a["Teszt Kettő"], state: "FASTING" }, at(thursday, "07:30"));
    const list = await mk("Csütörtöki lista", ["Teszt Egy", "Teszt Kettő"], []);
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: thursday, listId: list }, at(thursday, "08:00"));
    expect(r).toMatchObject({ added: 1, skipped: ["Teszt Kettő"] });
    expect(await selected(thursday)).toEqual(["Teszt Egy"]);
    await expectCode(applyFeedingList(f.aq1, { requestId: rid(), day: "2027-11-12", listId: list }, at("2027-11-13", "08:00")), "NOT_TODAY");
    await expectCode(applyFeedingList(f.aq1, { requestId: rid(), day: thursday, listId: "00000000-0000-4000-8000-000000000001" }, at(thursday, "08:30")), "LIST_NOT_FOUND");
  });
});

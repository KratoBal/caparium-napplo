// Named feeding lists (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1; Balázs "Mehet" 1564357004217159823):
// an admin composes them, a user applies one to the day: it ticks its animals and adds its feeds, and only adds.
// Days in November 2027, a month no other spec uses (the shared database).
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { AppError } from "@/lib/errors";
import { feedingDayView, setDayFeeds, setSelection } from "@/lib/feeding";
import { activeFeedingLists, applyFeedingList, archiveFeedingList, createFeedingList, updateFeedingList } from "@/lib/feeding-lists";
import { dayToDate } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
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
    await expectCode(applyFeedingList(f.aq1, { requestId: rid(), day: "2027-11-08", listId: r.id }, at("2027-11-08", "08:00")), "LIST_NOT_FOUND");
  });
});

describe("applying a list to the day: it ticks and adds, never takes off", () => {
  const monday = "2027-11-08";
  it("ticks the list's animals and adds its feeds; what was already on the day stays; a second pick adds nothing", async () => {
    // the day already has one animal ticked and one feed chosen by a person
    await setSelection(f.aq1, { requestId: rid(), day: monday, animalIds: [a["Teszt Három"]], selected: true }, at(monday, "07:50"));
    await setDayFeeds(f.aq1, { requestId: rid(), day: monday, feedIds: [feed["Teszt kagyló"]] }, at(monday, "07:51"));
    const list = (await createFeedingList(f.admin, { requestId: rid(), name: "Hétfői lista", animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], feedIds: [feed["Teszt hal"]] })) as { id: string };
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: monday, listId: list.id }, at(monday, "08:00"));
    expect(r).toMatchObject({ name: "Hétfői lista", added: 2, feedsAdded: 1, skipped: [] });
    expect(await selected(monday)).toEqual(["Teszt Egy", "Teszt Három", "Teszt Kettő"]);
    expect(await dayFeedIds(monday)).toEqual([feed["Teszt hal"], feed["Teszt kagyló"]].sort());
    // again: nothing new
    expect(await applyFeedingList(f.aq1, { requestId: rid(), day: monday, listId: list.id }, at(monday, "08:05"))).toMatchObject({ added: 0, feedsAdded: 0 });
    // the user takes one off by hand afterwards, as usual
    await setSelection(f.aq1, { requestId: rid(), day: monday, animalIds: [a["Teszt Kettő"]], selected: false }, at(monday, "08:10"));
    expect(await selected(monday)).toEqual(["Teszt Egy", "Teszt Három"]);
  });

  it("an animal with a manual fasting day is left out and named; an animal-only list leaves the day's feeds alone", async () => {
    const tuesday = "2027-11-09";
    await setEatingStatus(f.aq1, { requestId: rid(), day: tuesday, animalId: a["Teszt Kettő"], state: "FASTING" }, at(tuesday, "07:30"));
    const list = (await createFeedingList(f.admin, { requestId: rid(), name: "Keddi lista", animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], feedIds: [] })) as { id: string };
    const r = await applyFeedingList(f.aq1, { requestId: rid(), day: tuesday, listId: list.id }, at(tuesday, "08:00"));
    expect(r).toMatchObject({ added: 1, feedsAdded: 0, skipped: ["Teszt Kettő"] });
    expect(await selected(tuesday)).toEqual(["Teszt Egy"]);
    expect(await dayFeedIds(tuesday)).toEqual([]);
  });

  it("the day's permissions are the list's: an earlier day is admin work", async () => {
    const list = (await createFeedingList(f.admin, { requestId: rid(), name: "Régi nap lista", animalIds: [a["Teszt Egy"]], feedIds: [] })) as { id: string };
    await expectCode(applyFeedingList(f.aq1, { requestId: rid(), day: "2027-11-10", listId: list.id }, at("2027-11-11", "08:00")), "NOT_TODAY");
  });
});

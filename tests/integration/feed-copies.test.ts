// The copies the old basic data lookup made, made inactive by an admin with a dry run (Lili 2026-10-29, package item 14;
// barracuda and acrobot on #121). WHAT TURNS THIS RED: a non-admin running it; a feed in a person's hands (added by an
// admin with the same name) listed or touched; a copy deleted (a feed is never deleted, DAT-02); a run without its
// audit rows, or one that repeats.
// On Dicentrarchus labra, a starting-list feed no other test file looks up by name.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedCopies } from "@/lib/feed-copies";
import { createFeed, updateFeed } from "@/lib/feeds";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const NAME = "Dicentrarchus labra";

beforeAll(async () => {
  f = await fixtures();
});

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

describe("removing the basic data's copies (package item 14)", () => {
  it("plan lists only the loader's copies with their data; run makes them inactive, deletes nothing, audited", async () => {
    const original = (await prisma.feedName.findFirstOrThrow({ where: { name: NAME } })).feedId;
    await updateFeed(f.admin, original, { requestId: rid(), name: "Dicentrarchus (javított)", mode: "correction", reason: "teszt: helyesbítés" });
    const type = await prisma.feed.findUniqueOrThrow({ where: { id: original } });
    // as the old start made them: no audit row
    const copy = async () =>
      (await prisma.feed.create({ data: { typeId: type.typeId, allowedDimensions: type.allowedDimensions, defaultUnitId: type.defaultUnitId, sortOrder: 990, names: { create: { name: NAME, validFrom: new Date() } } } })).id;
    const unused = await copy();
    const withDose = await copy();
    await prisma.coralFeedDose.create({ data: { feedId: withDose, dose: "5", unitId: type.defaultUnitId, validFrom: new Date() } });
    // an admin added the same name on purpose: in a person's hands, never a copy
    const { id: admins } = await createFeed(f.admin, { requestId: rid(), typeId: type.typeId, name: NAME, dimensions: type.allowedDimensions as ("MASS" | "COUNT" | "VOLUME")[], defaultUnitId: type.defaultUnitId });

    expect(await code(feedCopies(f.aq1, { requestId: rid(), mode: "plan" }))).toBe("ADMIN_ONLY");
    const plan = (await feedCopies(f.admin, { requestId: rid(), mode: "plan" })) as { copies: { id: string; originalName: string; uses: { doses: number } }[] };
    const listed = plan.copies.filter((c) => [unused, withDose, admins].includes(c.id));
    expect(listed.map((c) => [c.id, c.originalName, c.uses.doses])).toEqual([
      [unused, "Dicentrarchus (javított)", 0],
      [withDose, "Dicentrarchus (javított)", 1],
    ]);

    const req = rid();
    const run = (await feedCopies(f.admin, { requestId: req, mode: "run", reason: "teszt: másodpéldányok" })) as { results: { id: string; outcome: string }[] };
    expect(run.results.filter((r) => [unused, withDose].includes(r.id)).map((r) => [r.id, r.outcome])).toEqual([
      [unused, "inactivated"],
      [withDose, "inactivated"],
    ]);
    expect([
      (await prisma.feed.findUniqueOrThrow({ where: { id: unused } })).active,
      (await prisma.feed.findUniqueOrThrow({ where: { id: withDose } })).active,
      (await prisma.feed.findUniqueOrThrow({ where: { id: admins } })).active,
      // nothing recorded is touched: the base amount stays with its copy
      await prisma.coralFeedDose.count({ where: { feedId: withDose } }),
      await prisma.auditEntry.count({ where: { entityId: { in: [unused, withDose] }, userId: f.admin.id, action: "MASTER_CHANGE" } }),
    ]).toEqual([false, false, true, 1, 2]);
    // the same request again: replayed; a new one: the copies are in an admin's hands now, nothing left
    expect(await feedCopies(f.admin, { requestId: req, mode: "run", reason: "teszt: másodpéldányok" })).toEqual({ replayed: true });
    const again = (await feedCopies(f.admin, { requestId: rid(), mode: "plan" })) as { copies: { id: string }[] };
    expect(again.copies.filter((c) => [unused, withDose].includes(c.id))).toEqual([]);
  });
});

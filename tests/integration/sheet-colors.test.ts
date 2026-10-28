// Lili 2026-10-28 13:49 UTC (acrobot 37542): an animal's and a group's row colour on the feeding sheet, set in
// Beállítások. WHAT TURNS RED: an aquarist sets one; a key off the palette is stored; a clear leaves the old colour;
// a change is not audited; the day's view does not carry the animal's or its group's colour. Days in September 2025:
// no other file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingDayView, setSelection } from "@/lib/feeding";
import { setSheetColor } from "@/lib/sheet-colors";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;

beforeAll(async () => {
  f = await fixtures();
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

describe("the feeding sheet's row colour", () => {
  it("an admin sets and clears it on an animal and a group, audited; an aquarist cannot; only the palette's keys", async () => {
    const group = await prisma.animalGroup.create({
      data: { names: { create: { name: "Színes csoport", validFrom: new Date("2025-09-01T08:00:00Z") } } },
    });
    const speciesId = (await prisma.species.findFirstOrThrow({ where: { scientificName: "Teszt faj A" } })).id;
    const d = "2025-09-10";
    const now = new Date(`${d}T09:00:00+02:00`);
    const { animalId } = await createLifecycleEvent(
      f.admin,
      { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name: "Színes Egy", sex: "FEMALE" }, toPoolId: f.pool("NAGY"), toGroupId: group.id, occurredAtLocal: `${d}T08:00`, reason: "teszt" },
      now,
    );

    await expectCode(setSheetColor(f.aq1, { requestId: rid(), target: "animal", id: animalId, color: "GREEN" }), "ADMIN_ONLY");
    await expect(setSheetColor(f.admin, { requestId: rid(), target: "animal", id: animalId, color: "BLACK" as "GREEN" })).rejects.toThrow();

    const req = rid();
    await setSheetColor(f.admin, { requestId: req, target: "animal", id: animalId, color: "GREEN" });
    expect(await setSheetColor(f.admin, { requestId: req, target: "animal", id: animalId, color: "PINK" })).toEqual({ replayed: true });
    await setSheetColor(f.admin, { requestId: rid(), target: "group", id: group.id, color: "PURPLE" });
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: animalId } })).sheetColor).toBe("GREEN");
    expect((await prisma.animalGroup.findUniqueOrThrow({ where: { id: group.id } })).sheetColor).toBe("PURPLE");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: req } });
    expect([audit.entityType, audit.entityId, audit.changes]).toEqual(["Animal", animalId, { sheetColor: { before: null, after: "GREEN" } }]);

    // the day's view carries both colours: the sheet colours the animal's row and the group's row from them
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [animalId], selected: true }, now);
    const row = (await feedingDayView(d)).animals.find((x) => x.id === animalId);
    expect([row?.sheetColor, row?.groupSheetColor]).toEqual(["GREEN", "PURPLE"]);

    await setSheetColor(f.admin, { requestId: rid(), target: "animal", id: animalId, color: "" });
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: animalId } })).sheetColor).toBeNull();
    await expectCode(
      setSheetColor(f.admin, { requestId: rid(), target: "group", id: "00000000-0000-4000-8000-000000000001", color: "BLUE" }),
      "NOT_FOUND",
    );
  });
});

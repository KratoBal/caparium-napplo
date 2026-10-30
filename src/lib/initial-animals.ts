// The description's starting animals by an admin's click (acrobot 33380, Balázs 2026-10-20 09:19 UTC: "nem látszanak
// az állatok"). Two rounds loaded nothing on the stage by themselves, because each time a test-system mark was
// assumed there that nobody could measure (#27: the CAPARIUM_SEED_SZINTETIKUS switch; #28: the seed's synthetic
// arrival, which the stage never had: it was first deployed after the switch existed, #16). The start's own loading
// stays (src/lib/base-data.ts), it just does not depend on it any more: the Állatok page shows how many list animals
// are in and which condition was false, and an admin loads them with one click. Idempotent: keyed by each list
// animal's own arrival (src/lib/initial-data.ts), so a second click, or the start after it, makes nothing twice.
// The ARRIVAL DAY is the admin's (acrobot 33395): a required field, today by default, so not even a live system gets
// a made-up date; the button may show everywhere. The start's own loading keeps its 2026-01-01 and its marks.
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "./audit";
import { prisma, SYSTEM_USER_ID } from "./db";
import { AppError } from "./errors";
import { hasTestSystemData, INITIAL_ANIMALS, initialAnimalsLoaded, loadInitialAnimals } from "./initial-data";
import type { Actor } from "./measurements";
import { initialAnimalsWanted } from "./seed-switch";
import { businessDayOf, isValidDay, resolveLocalDateTime } from "./time";

export type InitialAnimalsStatus = {
  total: number;
  loaded: number;
  /** CAPARIUM_SEED_SZINTETIKUS=1 in this process's environment */
  switchOn: boolean;
  /** the seed's synthetic arrival (requestId seed-arrival-1) in the database */
  markOn: boolean;
};

// `db` is the shared client; a test passes its own database's
export async function initialAnimalsStatus(db: PrismaClient = prisma): Promise<InitialAnimalsStatus> {
  return {
    total: INITIAL_ANIMALS.length,
    loaded: await initialAnimalsLoaded(db),
    switchOn: initialAnimalsWanted(),
    markOn: await hasTestSystemData(db),
  };
}

export async function loadInitialAnimalsByAdmin(actor: Actor, input: { requestId: string; arrivalDay: string }, db: PrismaClient = prisma, now = new Date()) {
  const { requestId, arrivalDay } = input;
  if (actor.role !== "ADMIN") throw new AppError(403, "ADMIN_ROLE_ONLY", "A kezdő állatlistát csak adminisztrátor töltheti be.");
  if (!isValidDay(arrivalDay)) throw new AppError(422, "ARRIVAL_DAY", "Add meg az érkezés napját (ÉÉÉÉ.HH.NN.).");
  if (arrivalDay > businessDayOf(now)) throw new AppError(422, "FUTURE_DAY", "Az érkezés napja nem lehet jövőbeli.");
  // the start of that local day: the arrival is the day's first event
  const since = resolveLocalDateTime(`${arrivalDay}T00:00`)!.instant;
  if (await db.auditEntry.findFirst({ where: { requestId } })) return { replayed: true, created: 0, ...(await initialAnimalsStatus(db)) };
  const before = await initialAnimalsLoaded(db);
  const pools = await db.pool.findMany({ select: { id: true, code: true } });
  const created = await loadInitialAnimals(db, new Map(pools.map((p) => [p.code, p.id])), since);
  const after = await initialAnimalsLoaded(db);
  // one row for the click; each arrival itself is the System's, as at the start
  await writeAudit(db, {
    userId: actor.id,
    action: "CREATE",
    entityType: "InitialAnimalList",
    entityId: SYSTEM_USER_ID,
    changes: { loaded: { before, after }, arrivalDay: { before: null, after: arrivalDay } },
    reason: "Kezdő állatlista betöltése a leírásból (leírás 18. o.)",
    requestId,
  });
  return { replayed: false, created, ...(await initialAnimalsStatus(db)) };
}

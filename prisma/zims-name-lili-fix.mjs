// ONE-TIME DATA FIX: lili's current ZIMS name is valid for all her earlier measurements (Balázs 2026-10-21 10:05 UTC,
// Cápárium thread, msg 1562406441279553577: "a lili új zimes nevét kellene beírni a régi mérésekhez is"; acrobot 34460).
//
// The measurement (zims-name-gap.mjs, 2026-10-21): one staff member, "lili", 136 measurements the ZIMS export refuses.
// Her first name row started when she was created (10-19 12:04), her measurements were recorded back-dated to 10-01..10-18,
// and today's rename added two more rows (08:03:00 and 08:03:05). A name row only covers [validFrom, validTo).
//
// What it does, in one transaction, for loginId "lili" only:
//   - her open row (validTo NULL, today's name) gets validFrom = 1970-01-01, so it covers every measurement;
//   - every earlier row is closed onto itself (validTo = validFrom): kept as history, but it covers no moment, so no two
//     rows overlap (pickValid takes the row whose interval covers the measurement);
//   - one audit entry (MASTER_CORRECTION, User, her id) with each row's old and new period and the name's length.
// After the change it counts her refused measurements again; anything but 0 rolls the whole transaction back.
//
// Dry by default: prints the rows and the plan, writes nothing. `--apply` writes. Run from /app in the app container:
//
//   node prisma/zims-name-lili-fix.mjs                                  # dry
//   node prisma/zims-name-lili-fix.mjs --apply                          # recorded under the system user
//   node prisma/zims-name-lili-fix.mjs --apply --vegrehajto <admin-loginId>
//
// The audit entry's userId is the ACTOR (admin.ts writes actor.id there; barracuda #39). By default it is the system
// user (role SYSTEM, the non-login actor of automatic operations, R-12): a script ran it, on Balázs's decision, which the
// reason names. `--vegrehajto` records it under an active ADMIN account instead. lili stands only in entityId.
//
// Idempotent: a second run finds the open row already at the beginning and every other row empty, and changes nothing.
// It refuses (exit 3) unless exactly one active-or-not user has the login id and exactly one of her rows is open.
// Output names nobody: a ZIMS name only by its length (the output lands in the deploy log).
import { PrismaClient } from "@prisma/client";

const LOGIN_ID = "lili";
const BEGINNING = new Date("1970-01-01T00:00:00.000Z");
const APPLY = process.argv.includes("--apply");
const ACTOR_AT = process.argv.indexOf("--vegrehajto");
const ACTOR_LOGIN = ACTOR_AT >= 0 ? process.argv[ACTOR_AT + 1] : undefined;

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"; // src/lib/db.ts
const prisma = new PrismaClient();
const out = (value) =>
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
const period = (row) => ({
  nev_hossz: row.zimsName.length,
  validFrom: row.validFrom.toISOString(),
  validTo: row.validTo ? row.validTo.toISOString() : null,
});

const REFUSED = `
  SELECT count(*) AS n FROM measurement m
  WHERE m.status = 'VALID' AND m."responsibleUserId" = $1::uuid
    AND NOT EXISTS (
      SELECT 1 FROM user_zims_name z
      WHERE z."userId" = m."responsibleUserId"
        AND z."validFrom" <= m."measuredAt"
        AND (z."validTo" IS NULL OR z."validTo" > m."measuredAt"))`;

class Refused extends Error {}

try {
  out({ adatjavitas: "caparium-zims-nev-lili", mod: APPLY ? "ELES" : "SZARAZ", ido: new Date().toISOString() });
  const users = await prisma.user.findMany({ where: { loginId: LOGIN_ID }, select: { id: true } });
  if (users.length !== 1) throw new Refused(`${users.length} felhasználó a(z) ${LOGIN_ID} azonosítóval, nem 1`);
  const userId = users[0].id;
  let actorId = null;
  if (APPLY) {
    const actor = ACTOR_LOGIN
      ? await prisma.user.findUnique({ where: { loginId: ACTOR_LOGIN }, select: { id: true, role: true, active: true } })
      : await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID }, select: { id: true, role: true, active: true } });
    if (ACTOR_LOGIN && (!actor || actor.role !== "ADMIN" || !actor.active))
      throw new Refused(`a végrehajtó (${ACTOR_LOGIN}) nem aktív admin`);
    if (!ACTOR_LOGIN && actor?.role !== "SYSTEM") throw new Refused("nincs rendszer-felhasználó; add meg: --vegrehajto <admin-loginId>");
    if (actor.id === userId) throw new Refused("a végrehajtó nem lehet maga az érintett dolgozó");
    actorId = actor.id;
  }

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.userZimsName.findMany({ where: { userId }, orderBy: { validFrom: "asc" } });
    const open = rows.filter((r) => r.validTo === null);
    if (open.length !== 1) throw new Refused(`${open.length} nyitott név-sor, nem 1`);
    const current = open[0];
    const refusedBefore = (await tx.$queryRawUnsafe(REFUSED, userId))[0].n;
    out({ elotte: rows.map(period), hibas_meres: refusedBefore });

    const changes = [];
    if (current.validFrom.getTime() !== BEGINNING.getTime())
      changes.push({ row: current, data: { validFrom: BEGINNING } });
    for (const row of rows) {
      if (row === current) continue;
      if (row.validTo && row.validTo.getTime() === row.validFrom.getTime()) continue;
      changes.push({ row, data: { validTo: row.validFrom } });
    }
    if (changes.length === 0) {
      out({ eredmeny: "nincs teendő: a nyitott sor már az idők kezdetétől él, a többi üres" });
      return { changed: 0, refusedBefore, refusedAfter: refusedBefore };
    }
    out({
      terv: changes.map(({ row, data }) => ({
        ...period(row),
        uj: period({ ...row, ...data }),
      })),
    });
    if (!APPLY) return { changed: 0, planned: changes.length, refusedBefore };

    for (const { row, data } of changes) await tx.userZimsName.update({ where: { id: row.id }, data });
    await tx.auditEntry.create({
      data: {
        userId: actorId,
        action: "MASTER_CORRECTION",
        entityType: "User",
        entityId: userId,
        changes: {
          zimsNameRows: changes.map(({ row, data }) => ({ before: period(row), after: period({ ...row, ...data }) })),
        },
        reason:
          "Egyszeri adatjavítás: a mai ZIMS-név az összes korábbi mérésre (Balázs 2026-10-21 10:05 UTC, msg 1562406441279553577)",
        client: "data-fix:zims-name-lili-fix.mjs",
      },
    });
    const refusedAfter = (await tx.$queryRawUnsafe(REFUSED, userId))[0].n;
    const after = await tx.userZimsName.findMany({ where: { userId }, orderBy: { validFrom: "asc" } });
    out({ utana: after.map(period), hibas_meres: refusedAfter });
    if (Number(refusedAfter) !== 0) throw new Refused(`utána is ${refusedAfter} hibás mérés: visszagörgetve`);
    return { changed: changes.length, refusedBefore, refusedAfter };
  });
  out({ kesz: result });
} catch (error) {
  out({ hiba: error instanceof Error ? error.message.slice(0, 300) : String(error) });
  process.exitCode = error instanceof Refused ? 3 : 1;
} finally {
  await prisma.$disconnect();
}

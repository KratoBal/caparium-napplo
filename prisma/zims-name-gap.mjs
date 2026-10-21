// WHERE IS THE GAP IN THE STAFF ZIMS NAMES (acrobot 34389/34393; Balázs 2026-10-21 09:21 UTC: "a régi névvel is
// készült mérés", yet the ZIMS export refuses every row with "a mérést végző dolgozónak nincs ZIMS-neve").
//
// READ-ONLY measurement for the Caparium test site, run once in the app container (post-deploy), from /app:
//
//   node prisma/zims-name-gap.mjs
//
// It uses the container's own DATABASE_URL and the image's Prisma client, runs three SELECTs and prints JSON lines.
// Staff are named by login id only. Nothing is written.
//
// The export (src/lib/exports/zims.ts) takes the user_zims_name row whose [validFrom, validTo) covers the
// measurement's measuredAt; a measurement with no such row is the refused one.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const out = (key, rows) =>
  console.log(
    JSON.stringify({ [key]: rows }, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
  );

const NO_NAME = `
  NOT EXISTS (
    SELECT 1 FROM user_zims_name z
    WHERE z."userId" = m."responsibleUserId"
      AND z."validFrom" <= m."measuredAt"
      AND (z."validTo" IS NULL OR z."validTo" > m."measuredAt"))`;

try {
  console.log(JSON.stringify({ meres: "caparium-zims-nev-res", ido: new Date().toISOString() }));

  // 1. the refused measurements per responsible user: how many, their measuredAt span, their recording span
  out(
    "hibas_meresek_dolgozonkent",
    await prisma.$queryRawUnsafe(`
      SELECT u."loginId", u."createdAt" AS felhasznalo_letrehozva,
             count(m.id) AS hibas_meres, min(m."measuredAt") AS elso_meres, max(m."measuredAt") AS utolso_meres,
             min(m."createdAt") AS elso_rogzites, max(m."createdAt") AS utolso_rogzites
      FROM measurement m JOIN app_user u ON u.id = m."responsibleUserId"
      WHERE m.status = 'VALID' AND ${NO_NAME}
      GROUP BY u."loginId", u."createdAt" ORDER BY u."loginId"`),
  );

  // 2. those users' ZIMS name rows in order: did the change close the old one, from when does the new one live
  out(
    "nev_sorok",
    await prisma.$queryRawUnsafe(`
      SELECT u."loginId", z."zimsName", z."validFrom", z."validTo"
      FROM user_zims_name z JOIN app_user u ON u.id = z."userId"
      WHERE z."userId" IN (SELECT m."responsibleUserId" FROM measurement m WHERE m.status = 'VALID' AND ${NO_NAME})
      ORDER BY u."loginId", z."validFrom"`),
  );

  // 3. the control: the measurements that DO find a name, per user and name (has the old name's period any?)
  out(
    "nevet_talalo_meresek",
    await prisma.$queryRawUnsafe(`
      SELECT u."loginId", z."zimsName", z."validFrom", z."validTo", count(m.id) AS meres
      FROM measurement m
      JOIN app_user u ON u.id = m."responsibleUserId"
      JOIN user_zims_name z ON z."userId" = m."responsibleUserId"
        AND z."validFrom" <= m."measuredAt" AND (z."validTo" IS NULL OR z."validTo" > m."measuredAt")
      WHERE m.status = 'VALID'
      GROUP BY u."loginId", z."zimsName", z."validFrom", z."validTo"
      ORDER BY u."loginId", z."validFrom"`),
  );
} catch (error) {
  console.log(JSON.stringify({ hiba: error instanceof Error ? error.message.slice(0, 300) : String(error) }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

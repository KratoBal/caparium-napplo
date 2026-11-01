import { writeAudit } from "@/lib/audit";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { periodFileName, waterFileBase } from "@/lib/exports/file-names";
import { moduleLevel, nameAt } from "@/lib/master";
import { seeOther } from "@/lib/redirect";
import { dayToDate, isValidDay } from "@/lib/time";

// A plain form POST (no JavaScript needed); the answer is the .xlsx file itself.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Érvénytelen kérés-forrás.", { status: 403 });
  const user = await userFromRequest(req);
  if (!user) return seeOther("/belepes");
  if ((await moduleLevel(prisma, user.id, user.role, "EXPORT")) === "NONE") {
    return new Response("Exportálásra nincs jogosultságod.", { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const from = String(form?.get("from") ?? "");
  const to = String(form?.get("to") ?? "");
  const poolIds = (form?.getAll("pool") ?? []).map(String).filter((p) => /^[0-9a-f-]{36}$/.test(p));
  if (!isValidDay(from) || !isValidDay(to) || from > to) return new Response("Az időszak érvénytelen.", { status: 422 });

  const { buffer, rows, sheets } = await buildWaterWorkbook({ from, to, poolIds: poolIds.length ? poolIds : null });
  await prisma.$transaction(async (tx) => {
    const run = await tx.exportRun.create({
      data: {
        kind: "EXCEL_WATER",
        purpose: "PREVIEW",
        periodFrom: dayToDate(from),
        periodTo: dayToDate(to),
        filters: { poolIds: poolIds.length ? poolIds : null },
        createdById: user.id,
      },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: "EXPORT",
      entityType: "ExportRun",
      entityId: run.id,
      changes: { export: { before: null, after: { kind: "EXCEL_WATER", from, to, rows, sheets: sheets.length } } },
    });
  });
  // point 1: every pool, or the chosen pools' names (their names at the period's end)
  // (every pool of the export page's list ticked is every pool too)
  const chosen = poolIds.length
    ? await prisma.pool.findMany({ where: { id: { in: poolIds } }, include: { names: true }, orderBy: { code: "asc" } })
    : [];
  const listed = await prisma.pool.count({ where: { active: true, memberships: { some: {} } } });
  const every = chosen.length === 0 || (chosen.length >= listed && chosen.every((p) => p.active));
  const end = new Date(`${to}T12:00:00.000Z`);
  const name = periodFileName(waterFileBase(every ? null : chosen.map((p) => nameAt(p.names, end)?.displayName ?? p.code)), from, to, "xlsx");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

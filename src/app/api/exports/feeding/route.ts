import { writeAudit } from "@/lib/audit";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildEatingWorkbook, buildFeedingWorkbook } from "@/lib/exports/feeding-excel";
import { moduleLevel } from "@/lib/master";
import { seeOther } from "@/lib/redirect";
import { dayToDate, isValidDay } from "@/lib/time";

// A plain form POST like the water Excel: kind=etetes (EGY-10) or evesi (EVE-07); the answer is the file.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Érvénytelen kérés-forrás.", { status: 403 });
  const user = await userFromRequest(req);
  if (!user) return seeOther("/belepes");
  const [exportLevel, feedingLevel] = await Promise.all([
    moduleLevel(prisma, user.id, user.role, "EXPORT"),
    moduleLevel(prisma, user.id, user.role, "FEEDING"),
  ]);
  if (exportLevel === "NONE" || feedingLevel === "NONE") return new Response("Ehhez az exporthoz nincs jogosultságod.", { status: 403 });
  const form = await req.formData().catch(() => null);
  const kind = String(form?.get("kind") ?? "");
  const from = String(form?.get("from") ?? "");
  const to = String(form?.get("to") ?? "");
  if (kind !== "etetes" && kind !== "evesi") return new Response("Ismeretlen export.", { status: 422 });
  if (!isValidDay(from) || !isValidDay(to) || from > to) return new Response("Az időszak érvénytelen.", { status: 422 });

  let built: { buffer: Buffer; rows: number };
  try {
    built = kind === "etetes" ? await buildFeedingWorkbook({ from, to }) : await buildEatingWorkbook({ from, to });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
  const exportKind = kind === "etetes" ? "EXCEL_FEEDING" : "EXCEL_EATING";
  await prisma.$transaction(async (tx) => {
    const run = await tx.exportRun.create({
      data: { kind: exportKind, purpose: "PREVIEW", periodFrom: dayToDate(from), periodTo: dayToDate(to), filters: {}, createdById: user.id },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: "EXPORT",
      entityType: "ExportRun",
      entityId: run.id,
      changes: { export: { before: null, after: { kind: exportKind, from, to, rows: built.rows } } },
    });
  });
  const name = `${kind === "etetes" ? "Egyedi_takarmanynaplo" : "Evesi_minta"}_${from}${from === to ? "" : `_${to}`}.xlsx`;
  return new Response(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

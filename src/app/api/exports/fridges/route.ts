import { writeAudit } from "@/lib/audit";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FILE_BASE, periodFileName } from "@/lib/exports/file-names";
import { buildFridgePdf, buildFridgeWorkbook } from "@/lib/exports/fridge-export";
import { moduleLevel } from "@/lib/master";
import { seeOther } from "@/lib/redirect";
import { dayToDate, isValidDay } from "@/lib/time";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Lili 2026-11-02 (task caparium-hutok): the fridges' temperatures for a period, Excel or PDF, a plain form POST like the other
// exports; the answer is the file. The book is recorded on the water page, so reading it takes the water module too.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Érvénytelen kérés-forrás.", { status: 403 });
  const user = await userFromRequest(req);
  if (!user) return seeOther("/belepes");
  const [exportLevel, waterLevel] = await Promise.all([moduleLevel(prisma, user.id, user.role, "EXPORT"), moduleLevel(prisma, user.id, user.role, "WATER")]);
  if (exportLevel === "NONE" || waterLevel === "NONE") return new Response("Ehhez az exporthoz nincs jogosultságod.", { status: 403 });
  const form = await req.formData().catch(() => null);
  const kind = String(form?.get("kind") ?? "");
  const from = String(form?.get("from") ?? "");
  const to = String(form?.get("to") ?? "");
  if (kind !== "excel" && kind !== "pdf") return new Response("Ismeretlen exportfajta.", { status: 422 });
  if (!isValidDay(from) || !isValidDay(to) || from > to) return new Response("Az időszak érvénytelen.", { status: 422 });
  // at most a year, as the other exports
  if ((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000 >= 366) return new Response("Legfeljebb egy év kérhető le egyszerre.", { status: 422 });
  const exportKind = kind === "excel" ? "EXCEL_FRIDGE" : "PDF_FRIDGE";
  const built = kind === "excel" ? await buildFridgeWorkbook(from, to) : await buildFridgePdf(from, to);
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
  const name = periodFileName(FILE_BASE.fridges, from, to, kind === "excel" ? "xlsx" : "pdf");
  return new Response(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": kind === "excel" ? XLSX : "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { writeAudit } from "@/lib/audit";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { FILE_BASE, periodFileName } from "@/lib/exports/file-names";
import { REPORT_FILE_BASE } from "@/lib/exports/intake-report-text";
import { buildIntakePdf } from "@/lib/exports/intake-pdf";
import { buildReportPdf } from "@/lib/exports/report-pdf";
import { intakeWorkbookOf } from "@/lib/exports/intake-excel";
import { buildEatingWorkbook, buildReportWorkbook, buildWithdrawalWorkbook, feedingWorkbook } from "@/lib/exports/feeding-excel";
import { workbookBody, type StreamedWorkbook } from "@/lib/exports/xlsx-stream";
import { moduleLevel } from "@/lib/master";
import { seeOther } from "@/lib/redirect";
import { dayToDate, isValidDay } from "@/lib/time";

// A plain form POST like the water Excel: kind=etetes (EGY-10) or evesi (EVE-07); the answer is the file.
// kind=huto (Takarmányhűtő, Lili 2026-10-30): the intake, the withdrawals per feed and the closing stock of a period, format=pdf or xlsx.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Érvénytelen kérés-forrás.", { status: 403 });
  const user = await userFromRequest(req);
  if (!user) return seeOther("/belepes");
  const form = await req.formData().catch(() => null);
  const kind = String(form?.get("kind") ?? "");
  // the withdrawal log needs the WITHDRAWAL module, the other two the FEEDING one
  const [exportLevel, dataLevel] = await Promise.all([
    moduleLevel(prisma, user.id, user.role, "EXPORT"),
    moduleLevel(prisma, user.id, user.role, kind === "kivetel" || kind === "huto" ? "WITHDRAWAL" : "FEEDING"),
  ]);
  if (exportLevel === "NONE" || dataLevel === "NONE") return new Response("Ehhez az exporthoz nincs jogosultságod.", { status: 403 });
  const from = String(form?.get("from") ?? "");
  const to = String(form?.get("to") ?? "");
  if (kind !== "etetes" && kind !== "evesi" && kind !== "kivetel" && kind !== "kimutatas" && kind !== "huto") return new Response("Ismeretlen export.", { status: 422 });
  const uuid = /^[0-9a-f-]{36}$/;
  const poolId = String(form?.get("pool") ?? "");
  const animalId = String(form?.get("animal") ?? "");
  if (!isValidDay(from) || !isValidDay(to) || from > to) return new Response("Az időszak érvénytelen.", { status: 422 });

  // the Takarmányhűtő report and (Lili 2026-11-01, point 8) the Kimutatások come as PDF too
  const pdf = (kind === "huto" || kind === "kimutatas") && String(form?.get("format") ?? "") === "pdf";
  const reportFilter = { from, to, poolId: uuid.test(poolId) ? poolId : null, animalId: uuid.test(animalId) ? animalId : null };
  // the two ten-year row exports (the feeding log, the Takarmányhűtő Excel) are written into the answer as they are made
  // (xlsx-stream.ts); the data is read before, so a refusal is still a status, not a broken file
  let built: { buffer: Buffer; rows: number } | StreamedWorkbook;
  try {
    built =
      kind === "huto"
        ? pdf
          ? await buildIntakePdf({ from, to })
          : await intakeWorkbookOf({ from, to })
        : kind === "etetes"
        ? await feedingWorkbook({ from, to })
        : kind === "evesi"
          ? await buildEatingWorkbook({ from, to })
          : kind === "kivetel"
            ? await buildWithdrawalWorkbook({ from, to })
            : pdf
              ? await buildReportPdf(reportFilter)
              : await buildReportWorkbook(reportFilter);
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
  const exportKind =
    kind === "huto"
      ? pdf
        ? "PDF_INTAKE"
        : "EXCEL_INTAKE"
      : kind === "kimutatas" && pdf
        ? "PDF_REPORT"
        : kind === "etetes" || kind === "kimutatas"
          ? "EXCEL_FEEDING"
          : kind === "evesi"
            ? "EXCEL_EATING"
            : "EXCEL_WITHDRAWAL";
  await prisma.$transaction(async (tx) => {
    const run = await tx.exportRun.create({
      // the page's own kind too: a report and the feeding log share EXCEL_FEEDING (review note on #17)
      data: { kind: exportKind, purpose: "PREVIEW", periodFrom: dayToDate(from), periodTo: dayToDate(to), filters: { kind }, createdById: user.id },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: "EXPORT",
      entityType: "ExportRun",
      entityId: run.id,
      changes: { export: { before: null, after: { kind: exportKind, from, to, rows: built.rows } } },
    });
  });
  // Lili 2026-11-01 (points 2-4): "capasuli_" names for the feeding log, the eating pattern and the withdrawals
  const base =
    kind === "huto" ? REPORT_FILE_BASE : kind === "etetes" ? FILE_BASE.feeding : kind === "evesi" ? FILE_BASE.eating : kind === "kivetel" ? FILE_BASE.withdrawal : "Kimutatas";
  const name = periodFileName(base, from, to, pdf ? "pdf" : "xlsx");
  return new Response("buffer" in built ? new Uint8Array(built.buffer) : workbookBody(built), {
    headers: {
      "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

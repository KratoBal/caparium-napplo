import { writeAudit } from "@/lib/audit";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildDosingPdf } from "@/lib/exports/dosing-pdf";
import { moduleLevel } from "@/lib/master";
import { seeOther } from "@/lib/redirect";
import { dayToDate, isValidDay } from "@/lib/time";

// Lili 2026-11-01 (point 5): the dosing log as a PDF made on the server; a plain form POST like the other exports, the answer is the file
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Érvénytelen kérés-forrás.", { status: 403 });
  const user = await userFromRequest(req);
  if (!user) return seeOther("/belepes");
  const [exportLevel, dosingLevel] = await Promise.all([moduleLevel(prisma, user.id, user.role, "EXPORT"), moduleLevel(prisma, user.id, user.role, "DOSING")]);
  if (exportLevel === "NONE" || dosingLevel === "NONE") return new Response("Ehhez az exporthoz nincs jogosultságod.", { status: 403 });
  const form = await req.formData().catch(() => null);
  const from = String(form?.get("from") ?? "");
  const to = String(form?.get("to") ?? "");
  if (!isValidDay(from) || !isValidDay(to) || from > to) return new Response("Az időszak érvénytelen.", { status: 422 });
  const uuid = /^[0-9a-f-]{36}$/;
  const poolId = String(form?.get("pool") ?? "");
  const chemicalId = String(form?.get("chemical") ?? "");
  let built: { buffer: Buffer; rows: number };
  try {
    built = await buildDosingPdf({ from, to, poolId: uuid.test(poolId) ? poolId : null, chemicalId: uuid.test(chemicalId) ? chemicalId : null });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
  await prisma.$transaction(async (tx) => {
    const run = await tx.exportRun.create({
      data: { kind: "PDF_DOSING", purpose: "PREVIEW", periodFrom: dayToDate(from), periodTo: dayToDate(to), filters: { poolId: poolId || null, chemicalId: chemicalId || null }, createdById: user.id },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: "EXPORT",
      entityType: "ExportRun",
      entityId: run.id,
      changes: { export: { before: null, after: { kind: "PDF_DOSING", from, to, rows: built.rows } } },
    });
  });
  return new Response(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="capasuli_vegyszeradagolas_${from}${from === to ? "" : `_${to}`}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

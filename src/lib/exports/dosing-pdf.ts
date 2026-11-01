// The chemical dosing log as a PDF made on the server (Lili 2026-11-01, point 5: "in the style of the other PDFs"), instead of the
// browser's print of the page. The period and the page's filters, the valid dosings in time order, then the period's total per
// chemical and unit. An invalidated dosing is not in it; the period line says how many there were.
import { prisma } from "../db";
import { dosingLog, type DosingFilter } from "../dosing";
import { pickValid } from "../master";
import { formatDay, formatPeriod, localTimeOf } from "../time";
import { pdfPage } from "./pdf-layout";

export const DOSING_PDF_TITLE = "Cápasuli vegyszeradagolás";

const num = (v: string) => v.replace(".", ",");

export async function buildDosingPdf(f: DosingFilter): Promise<{ buffer: Buffer; rows: number }> {
  const log = await dosingLog(f);
  const valid = log.filter((r) => r.status === "VALID");
  const skipped = log.length - valid.length;
  const at = new Date(`${f.to}T12:00:00.000Z`);
  const [pool, chemical] = await Promise.all([
    f.poolId ? prisma.pool.findUnique({ where: { id: f.poolId }, include: { names: true } }) : null,
    f.chemicalId ? prisma.chemical.findUnique({ where: { id: f.chemicalId }, include: { names: true } }) : null,
  ]);
  const filters = [
    pool ? `medence: ${pickValid(pool.names, at)?.displayName ?? pool.code}` : null,
    chemical ? `szer: ${pickValid(chemical.names, at)?.name ?? chemical.names.at(-1)?.name ?? "?"}` : null,
  ].filter(Boolean);
  const title = `${DOSING_PDF_TITLE}: ${formatPeriod(f.from, f.to)}`;
  const page = pdfPage({
    title,
    // the period ends in its own dot (2029.01.09.): nothing more after it unless a filter or a note follows
    subtitle: `Időszak: ${formatPeriod(f.from, f.to)}${filters.length ? ` (${filters.join(", ")})` : ""}${skipped ? `; ${skipped} érvénytelenített tétel nem szerepel.` : ""}`,
  });
  page.band("Napló");
  if (valid.length === 0) page.note("Az időszakban nem volt vegyszeradagolás.");
  else
    page.table(
      [72, 44, 110, 135, 82, 72],
      ["Nap", "Idő", "Medence", "Szer", "Mennyiség", "Végezte"],
      valid.map((r) => ({ cells: [formatDay(r.day), localTimeOf(r.at), r.pool, r.chemical, `${num(r.quantity)} ${r.unit}`, r.by] })),
    );
  // the period's total per chemical and the unit it was dosed in
  const sums = new Map<string, { chemical: string; unit: string; sum: number }>();
  for (const r of valid) {
    const key = `${r.chemical}|${r.unit}`;
    const s = sums.get(key) ?? { chemical: r.chemical, unit: r.unit, sum: 0 };
    s.sum += Number(r.quantity);
    sums.set(key, s);
  }
  if (sums.size) {
    page.band("Összesen szerenként");
    page.table(
      [327, 188],
      ["Szer", "Összesen"],
      [...sums.values()]
        .sort((a, b) => a.chemical.localeCompare(b.chemical, "hu") || a.unit.localeCompare(b.unit))
        .map((s) => ({ cells: [s.chemical, `${num(String(Math.round(s.sum * 10000) / 10000))} ${s.unit}`], total: true })),
    );
  }
  return { buffer: await page.done(), rows: valid.length };
}

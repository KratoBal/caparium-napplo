// ZIMS CSV export (VIZ-16..VIZ-19, VIZ-21, VIZ-24; adatmodell 5. és 15. terület; T-14, T-20, R-9, R-18).
// One file per system (pool). The mapping is data: the ZIMS names valid at the measurement time.
// "Exported" is not "submitted": only a run marked SUBMITTED counts as what is in ZIMS, and the
// row hashes of that run reveal every later change, correction or invalidation.

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "../audit";
import { prisma, SYSTEM_USER_ID } from "../db";
import { canonicalDecimal } from "../decimal";
import { AppError } from "../errors";
import { moduleLevel, pickValid } from "../master";
import { requireReason } from "../reasons";
import type { Actor } from "../measurements";
import { businessDayOf, dayToDate, isValidDay, resolveLocalDateTime, wallClock } from "../time";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 20, 2026": English month abbreviation, day without padding, comma, year (profile v1). */
export function zimsDate(instant: Date, tz: string): string {
  const w = wallClock(instant, tz);
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year}`;
}

/** "17:08": 24-hour local wall-clock time, no offset (the ZIMS column carries none). */
export function zimsTime(instant: Date, tz: string): string {
  const w = wallClock(instant, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/** The measured value with the parameter's decimals and a "." separator ("8.00", "305"). Exact, no float. */
export function zimsValue(value: string, decimals: number): string {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [int, frac = ""] = body.split(".");
  let scaled = BigInt(int + frac.padEnd(decimals + 1, "0").slice(0, decimals + 1));
  scaled = (scaled + 5n) / 10n;
  const digits = scaled.toString().padStart(decimals + 1, "0");
  const i = digits.slice(0, digits.length - decimals) || "0";
  const f = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${neg && scaled !== 0n ? "-" : ""}${i}${f}`;
}

/** RFC 4180 field: quoted when it holds the separator, a quote or a line break ("Sep 20, 2026" is quoted). */
export function csvField(v: string, sep = ","): string {
  return v.includes(sep) || v.includes('"') || v.includes("\r") || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}

export type ZimsRow = [date: string, time: string, measurement: string, value: string, unit: string, measuredBy: string];

export function rowHash(row: ZimsRow): string {
  return createHash("sha256").update(row.join("\u001f")).digest("hex");
}

/** A file name a ZIMS user can recognise: system, period. Ascii only. */
export function fileName(poolName: string, from: string, to: string): string {
  const ascii = poolName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `ZIMS-${ascii || "medence"}-${from}${from === to ? "" : `_${to}`}.csv`;
}

type MeasurementFull = Prisma.MeasurementGetPayload<{
  include: {
    unit: true;
    pool: { include: { names: true } };
    parameter: { include: { zimsNames: true; zimsUnitNames: true } };
  };
}>;

type Mapping = {
  unitNames: { unitId: string; parameterId: string | null; zimsUnit: string; validFrom: Date; validTo: Date | null }[];
  userZims: Map<string, { zimsName: string; validFrom: Date; validTo: Date | null }[]>;
};

export type RowProblem = { measurementId: string; problem: string };

/** The ZIMS row of one measurement, or the reason why there is none (never an empty field, T-14). */
export function zimsRow(m: MeasurementFull, map: Mapping, tz: string): ZimsRow | RowProblem {
  const at = m.measuredAt;
  const pName = pickValid(m.parameter.zimsNames, at)?.zimsName;
  if (!pName) return { measurementId: m.id, problem: `nincs ZIMS-név a(z) ${m.parameter.code} paraméterhez` };
  // the snapshot unit of the measurement is the key (K4); a parameter-specific row beats the generic one
  const units = map.unitNames.filter((u) => u.unitId === m.unitId && u.validFrom <= at && (u.validTo === null || u.validTo > at));
  const unit = (units.find((u) => u.parameterId === m.parameterId) ?? units.find((u) => u.parameterId === null))?.zimsUnit;
  if (!unit) return { measurementId: m.id, problem: `nincs ZIMS-egység a(z) ${m.unit.symbol} egységhez` };
  const who = pickValid(map.userZims.get(m.responsibleUserId) ?? [], at)?.zimsName;
  if (!who) return { measurementId: m.id, problem: "a mérést végző dolgozónak nincs ZIMS-neve" };
  return [zimsDate(at, tz), zimsTime(at, tz), pName, zimsValue(canonicalDecimal(m.value), m.parameter.decimals), unit, who];
}

/** True for an instant in the autumn hour that occurs twice: the ZIMS row cannot tell which (R-18). */
export function inRepeatedHour(at: Date, tz: string): boolean {
  const w = wallClock(at, tz);
  const local = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}T${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  return resolveLocalDateTime(local, tz)?.ambiguous ?? false;
}

async function loadMapping(): Promise<Mapping> {
  const [unitNames, userZims] = await Promise.all([prisma.zimsUnitName.findMany(), prisma.userZimsName.findMany()]);
  const byUser = new Map<string, Mapping["userZims"] extends Map<string, infer V> ? V : never>();
  for (const z of userZims) byUser.set(z.userId, [...(byUser.get(z.userId) ?? []), z]);
  return { unitNames, userZims: byUser };
}

async function loadMeasurements(from: string, to: string, poolIds: string[] | null) {
  return prisma.measurement.findMany({
    where: {
      status: "VALID",
      businessDay: { gte: dayToDate(from), lte: dayToDate(to) },
      ...(poolIds ? { poolId: { in: poolIds } } : {}),
    },
    include: {
      unit: true,
      pool: { include: { names: true } },
      parameter: { include: { zimsNames: true, zimsUnitNames: true } },
    },
    orderBy: [{ measuredAt: "asc" }, { createdAt: "asc" }],
  });
}

async function activeProfile() {
  const p = await prisma.zimsExportProfile.findFirst({ where: { active: true }, orderBy: { version: "desc" } });
  if (!p) throw new AppError(409, "NO_PROFILE", "Nincs aktív ZIMS-exportprofil.");
  return p;
}

export const zimsExportSchema = z.object({
  requestId: z.string().min(8).max(100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  poolIds: z.array(z.uuid()).min(1).max(20).nullable(),
  purpose: z.enum(["SUBMISSION", "TRIAL", "PREVIEW"]),
});
export type ZimsExportInput = z.infer<typeof zimsExportSchema>;

async function requireLevel(actor: Actor, admin: boolean) {
  const level = await moduleLevel(prisma, actor.id, actor.role, "EXPORT");
  if (level === "NONE" || (admin && level !== "ADMIN")) {
    throw new AppError(403, admin ? "ADMIN_ONLY" : "NO_ACCESS", admin ? "Ezt csak adminisztrátor jelölheti." : "Exportálásra nincs jogosultságod.");
  }
}

/**
 * Builds the files of one ZIMS export run and stores the run, the files (with their exact
 * content) and one item per measurement with the hash of the row written for it.
 */
export async function createZimsExport(actor: Actor, input: ZimsExportInput, opts: { system?: boolean } = {}) {
  // the monthly package (VIZ-20) is the System user's, without a person's EXPORT right; only a PREVIEW
  if (opts.system) {
    if (actor.id !== SYSTEM_USER_ID || input.purpose !== "PREVIEW") throw new AppError(403, "NO_ACCESS", "Csak a rendszer előnézeti csomagja.");
  } else {
    await requireLevel(actor, false);
  }
  if (!isValidDay(input.from) || !isValidDay(input.to) || input.from > input.to) {
    throw new AppError(422, "BAD_PERIOD", "Az időszak érvénytelen.");
  }
  const prior = await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "ExportRun" } });
  if (prior) return { runId: prior.entityId, replayed: true };

  const profile = await activeProfile();
  const tz = profile.timeZone;
  const [rows, map] = await Promise.all([loadMeasurements(input.from, input.to, input.poolIds), loadMapping()]);
  const problems: RowProblem[] = [];
  const warnings: string[] = [];
  const perPool = new Map<string, { name: string; lines: string[]; items: { measurementId: string; version: number; hash: string }[] }>();
  const endOfPeriod = resolveLocalDateTime(`${input.to}T23:59`, tz)!.instant;
  for (const m of rows) {
    const r = zimsRow(m, map, tz);
    if (!Array.isArray(r)) {
      problems.push(r);
      continue;
    }
    if (inRepeatedHour(m.measuredAt, tz)) {
      warnings.push(`${r[0]} ${r[1]}: a mérés az őszi óraátállítás kétszer előforduló órájába esik; a ZIMS-sor ezt nem jelöli (R-18).`);
    }
    const pool = perPool.get(m.poolId) ?? {
      name: pickValid(m.pool.names, endOfPeriod)?.displayName ?? m.pool.code,
      lines: [],
      items: [],
    };
    pool.lines.push(r.map((f) => csvField(f, profile.fieldSeparator)).join(profile.fieldSeparator));
    pool.items.push({ measurementId: m.id, version: m.version, hash: rowHash(r) });
    perPool.set(m.poolId, pool);
  }
  if (problems.length) {
    throw new AppError(422, "MAPPING_MISSING", "Néhány méréshez hiányzik a ZIMS-megfeleltetés; az export nem készült el.", {
      problems: problems.slice(0, 50),
    });
  }
  if (perPool.size === 0) throw new AppError(422, "NOTHING_TO_EXPORT", "Ebben az időszakban nincs érvényes mérés.");

  return prisma.$transaction(async (tx) => {
    const run = await tx.exportRun.create({
      data: {
        kind: "ZIMS_CSV",
        purpose: input.purpose,
        periodFrom: dayToDate(input.from),
        periodTo: dayToDate(input.to),
        filters: { poolIds: input.poolIds },
        zimsProfileId: profile.id,
        createdById: actor.id,
        submissionState: input.purpose === "SUBMISSION" ? "CREATED" : null,
        warnings,
      },
    });
    const files = [];
    for (const [poolId, p] of perPool) {
      const content = [profile.header, ...p.lines].join(profile.lineEnding) + profile.lineEnding;
      const f = await tx.exportFile.create({
        data: {
          exportRunId: run.id,
          poolId,
          fileName: fileName(p.name, input.from, input.to),
          sha256: createHash("sha256").update(content, "utf8").digest("hex"),
          rowCount: p.lines.length,
          content,
        },
      });
      files.push({ id: f.id, fileName: f.fileName, rowCount: f.rowCount });
      await tx.exportItem.createMany({
        data: p.items.map((i) => ({ exportRunId: run.id, measurementId: i.measurementId, measurementVersion: i.version, rowSha256: i.hash })),
      });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: "EXPORT",
      entityType: "ExportRun",
      entityId: run.id,
      changes: { export: { before: null, after: { kind: "ZIMS_CSV", purpose: input.purpose, from: input.from, to: input.to, files: files.length } } },
      requestId: input.requestId,
    });
    return { runId: run.id, files, warnings, replayed: false };
  });
}

export const submissionSchema = z.object({
  requestId: z.string().min(8).max(100),
  state: z.enum(["SUBMITTED", "REJECTED"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

/** Records that a submission run was uploaded into ZIMS (or refused there). Admin only. */
export async function setSubmissionState(actor: Actor, runId: string, input: z.infer<typeof submissionSchema>, now = new Date()) {
  await requireLevel(actor, true);
  await requireReason(prisma, input.state === "REJECTED", input.reason, "Az elutasításhoz indoklás kell.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityId: runId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const run = await tx.exportRun.findUnique({ where: { id: runId } });
    if (!run || run.purpose !== "SUBMISSION") throw new AppError(404, "NOT_FOUND", "Leadásra készült export nem található.");
    if (run.submissionState !== "CREATED") throw new AppError(409, "ALREADY_DECIDED", "Erről a leadásról már született döntés.");
    await tx.exportRun.update({
      where: { id: runId },
      data: { submissionState: input.state, submittedById: actor.id, submittedAt: now },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "EXPORT",
      entityType: "ExportRun",
      entityId: runId,
      changes: { submissionState: { before: "CREATED", after: input.state } },
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

export type Divergence = {
  measurementId: string;
  kind: "MODIFIED" | "INVALIDATED" | "NOT_SUBMITTED";
  poolName: string;
  day: string;
  submittedRow?: string;
  currentRow?: string;
};

/**
 * "Leadás után eltér" (R-9). For a period: every measurement whose last SUBMITTED row differs from the
 * row it would get today (value, time, person, or a corrected ZIMS name or unit), every submitted
 * measurement that has been invalidated since, and every valid measurement of a submitted
 * day and system that no submitted run contains.
 */
export async function divergence(from: string, to: string): Promise<Divergence[]> {
  const profile = await activeProfile();
  const tz = profile.timeZone;
  const submitted = await prisma.exportRun.findMany({
    where: {
      kind: "ZIMS_CSV",
      submissionState: "SUBMITTED",
      periodFrom: { lte: dayToDate(to) },
      periodTo: { gte: dayToDate(from) },
    },
    include: { items: true, files: { select: { poolId: true } } },
    orderBy: { submittedAt: "asc" },
  });
  if (submitted.length === 0) return [];
  const lastItem = new Map<string, { hash: string }>();
  for (const run of submitted) for (const i of run.items) lastItem.set(i.measurementId, { hash: i.rowSha256 });

  const ids = [...lastItem.keys()];
  const [map, inPeriod, submittedMeasurements] = await Promise.all([
    loadMapping(),
    loadMeasurements(from, to, null),
    prisma.measurement.findMany({
      where: { id: { in: ids } },
      include: { unit: true, pool: { include: { names: true } }, parameter: { include: { zimsNames: true, zimsUnitNames: true } } },
    }),
  ]);
  const out: Divergence[] = [];
  for (const m of submittedMeasurements) {
    const day = businessDayOf(m.measuredAt);
    if (day < from || day > to) continue;
    const poolName = pickValid(m.pool.names, m.measuredAt)?.displayName ?? m.pool.code;
    if (m.status !== "VALID") {
      out.push({ measurementId: m.id, kind: "INVALIDATED", poolName, day });
      continue;
    }
    const r = zimsRow(m, map, tz);
    if (!Array.isArray(r) || rowHash(r) !== lastItem.get(m.id)!.hash) {
      out.push({ measurementId: m.id, kind: "MODIFIED", poolName, day, currentRow: Array.isArray(r) ? r.join(" | ") : r.problem });
    }
  }
  // covered (day, pool) pairs of the submitted runs
  const covered = (m: { businessDay: Date; poolId: string }) =>
    submitted.some(
      (run) =>
        run.periodFrom <= m.businessDay &&
        run.periodTo >= m.businessDay &&
        run.files.some((f) => f.poolId === m.poolId),
    );
  for (const m of inPeriod) {
    if (lastItem.has(m.id) || !covered(m)) continue;
    out.push({
      measurementId: m.id,
      kind: "NOT_SUBMITTED",
      poolName: pickValid(m.pool.names, m.measuredAt)?.displayName ?? m.pool.code,
      day: businessDayOf(m.measuredAt),
    });
  }
  return out;
}

/**
 * VIZ-20 (NY-09 default: no e-mail): the previous month's ZIMS files, prepared once by the System user
 * as a PREVIEW run and offered for download on the export page. A preview is never a submission
 * (R-9): what counts as "in ZIMS" stays the runs an admin marked as submitted. A month without
 * measurements, or with a missing mapping, gets no package; the export page says so.
 */
export function previousMonth(now: Date): { from: string; to: string } {
  const today = businessDayOf(now);
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}

export async function monthlyPackage(now = new Date()): Promise<{ created: boolean; runId?: string; reason?: string }> {
  const { from, to } = previousMonth(now);
  const existing = await prisma.exportRun.findFirst({
    where: { kind: "ZIMS_CSV", purpose: "PREVIEW", createdById: SYSTEM_USER_ID, periodFrom: dayToDate(from), periodTo: dayToDate(to) },
  });
  if (existing) return { created: false, runId: existing.id };
  try {
    const r = await createZimsExport({ id: SYSTEM_USER_ID, role: "SYSTEM" }, { requestId: `havi-zims-${from}`, from, to, poolIds: null, purpose: "PREVIEW" }, { system: true });
    return { created: !r.replayed, runId: r.runId };
  } catch (e) {
    if (e instanceof AppError) return { created: false, reason: e.code };
    throw e;
  }
}

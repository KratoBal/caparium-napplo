import Link from "next/link";
import { notFound } from "next/navigation";
import { CorrectionForm } from "@/components/CorrectionForm";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { canModify } from "@/lib/permissions";
import { formatDecimalHu } from "@/lib/decimal";
import { measurementHistory } from "@/lib/queries";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, dayToDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = {
  value: "Érték",
  measuredAt: "Mérés időpontja",
  businessDay: "Nap",
  responsibleUserId: "Mérést végezte",
  traineePerformed: "Gyakornok végezte",
  dilution: "Hígítás",
  diluentWater: "Hígító víz",
  status: "Állapot",
  invalidationReason: "Érvénytelenítés oka",
  roundId: "Mérési kör",
};
// technical fields stay in the audit, but are not shown to the user
const HIDDEN = new Set(["poolId", "parameterId", "unitId", "referenceRangeId", "version", "roundId"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "igen" : "nem";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  }
  return String(v);
}

export default async function MeasurementHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, level } = await requireModuleRead("WATER");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const h = await measurementHistory(id);
  if (!h) notFound();
  const m = h.measurement;
  const out = m.reference === "LOW" || m.reference === "HIGH";
  // the same rule the server applies on save; here it only decides whether the form is shown
  const journal = await prisma.journalDay.findFirst({
    where: { kind: "WATER", groupId: m.groupId, businessDay: dayToDate(m.businessDay) },
  });
  const decision =
    m.status === "VALID"
      ? canModify(level, {
          day: m.businessDay,
          today: businessDayOf(new Date()),
          closed: journal?.state === "CLOSED",
          isOwn: m.createdById === user.id,
        })
      : null;
  const people = decision?.kind === "ALLOW"
    ? await prisma.user.findMany({
        where: { active: true, role: { in: ["AQUARIST", "ADMIN"] } },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true },
      })
    : [];
  return (
    <Shell title="Mérés előzménye" active="log" user={user}>
      <p>
        <Link href="/naplo">← Vissza a naplóhoz</Link>
      </p>
      <div className="card">
        <h2>
          {m.poolName} · {m.parameterName}
        </h2>
        <p className="hint">
          {m.businessDay} {m.localTime} · {m.groupName}, {m.roundSeq}. mérés · mérte: {m.responsibleMonogram} · rögzítette:{" "}
          {m.createdByName}
        </p>
        <p style={{ fontSize: 28, margin: "16px 0 0" }} className={out ? "value-out" : undefined} data-testid="history-value">
          {formatDecimalHu(m.value, m.decimals)} {m.unitSymbol !== m.parameterName ? m.unitSymbol : ""}
        </p>
        {out && m.range && (
          <p className="hint">
            Eltérés a referenciától ({m.range.min ?? "–"}–{m.range.max ?? "–"} {m.range.unitSymbol})
          </p>
        )}
        <p>
          Állapot: <b data-testid="history-status">{m.status === "VALID" ? "érvényes" : m.status === "INVALIDATED" ? "érvénytelenített" : "függő"}</b>
          {m.invalidationReason ? ` (ok: ${m.invalidationReason})` : ""}
        </p>
      </div>
      {decision?.kind === "ALLOW" && (
        <CorrectionForm
          measurement={{
            id: m.id,
            version: m.version,
            value: m.value,
            measuredAtLocal: m.measuredAtLocal,
            responsibleUserId: m.responsibleUserId,
            traineePerformed: m.traineePerformed,
            dilution: m.dilution,
            diluentWater: m.diluentWater,
            dilutable: m.dilutable,
          }}
          people={people}
          reasonRequired={decision.reasonRequired}
        />
      )}
      {decision?.kind === "DENY" && (
        <p className="hint" data-testid="correction-denied">
          {decision.message}
        </p>
      )}
      <div className="card">
        <h2>Módosítási előzmények</h2>
        <p className="hint">Minden rögzítés, javítás és érvénytelenítés: ki, mikor, mit, előtte és utána.</p>
        {h.entries.map((e) => (
          <div key={e.id} className="history-item" data-testid="history-entry">
            <div className="when">
              {e.localDay} {e.localTime} · {e.userName} ({e.userMonogram})
            </div>
            <b>{e.actionLabel}</b>
            {e.reason && <div>Indoklás: {e.reason}</div>}
            <ul>
              {Object.entries(e.changes)
                .filter(([k]) => !HIDDEN.has(k))
                .map(([k, c]) => (
                  <li key={k}>
                    {FIELD_LABEL[k] ?? k}: {e.action === "CREATE" || e.action === "PENDING_CREATED" ? show(c.after) : `${show(c.before)} → ${show(c.after)}`}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </Shell>
  );
}

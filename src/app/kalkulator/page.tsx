import Link from "next/link";
import { BodyWeightForm, Calculator } from "@/components/CalculatorForms";
import { InvalidateButton } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { listAnimals } from "@/lib/animals";
import { lastBodyWeight, referencesOn } from "@/lib/calculator";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/master";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, dateToDay, localDateTimeOf } from "@/lib/time";

export const dynamic = "force-dynamic";

const num = (v: number | string) => String(v).replace(".", ",");

// KALK-01, KALK-02: a general calculator; its result is saved as the reference of the animal picked next to the
// button (caparium-hibak-2, Balázs 2026-10-20 08:07 UTC). JAV-06, the body weight log: only while switched on.
export default async function CalculatorPage({ searchParams }: { searchParams: Promise<{ allat?: string }> }) {
  const { level, user } = await requireModuleRead("FEEDING");
  const sp = await searchParams;
  const now = new Date();
  const all = await listAnimals(now);
  const animals = all.filter((a) => a.alive);
  const canRecord = level === "RECORD" || level === "ADMIN";
  const today = businessDayOf(now);
  const showWeights = (await getSetting(prisma, "body_weight_log_visible", now)) === "true";
  const picked = animals.find((a) => a.id === sp.allat);
  const weighed = showWeights ? (picked ?? animals[0]) : undefined;
  const [refs, saved, last, weights] = await Promise.all([
    referencesOn(today),
    prisma.calculatorRun.findMany({ where: { savedAsReference: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    weighed ? lastBodyWeight(weighed.id) : null,
    weighed
      ? prisma.bodyWeight.findMany({ where: { animalId: weighed.id }, orderBy: [{ measuredOn: "desc" }, { createdAt: "desc" }], take: 20 })
      : [],
  ]);
  const nameOf = new Map(all.map((a) => [a.id, a.name]));
  return (
    <Shell title="Takarmánykalkulátor" active="calculator" user={user}>
      <div className="card">
        <h2>Kalkulátor</h2>
        <p className="hint">
          FR = F × N / (BW/100). A heti FR lépésköze és az eltérés küszöbe (±20 %) ideiglenes, a közös ellenőrzésen dől el. Az
          eredmény a kiválasztott állat referenciájaként menthető.
        </p>
        {canRecord ? (
          <Calculator
            animals={animals.map((a) => ({ id: a.id, name: a.name, poolName: a.poolName }))}
            references={Object.fromEntries(animals.filter((a) => refs[a.id] !== undefined).map((a) => [a.id, refs[a.id]!]))}
            initialAnimalId={picked?.id ?? ""}
            defaultBwKg={picked && last ? last.weightKg : null}
          />
        ) : (
          <p className="hint">Számolni és menteni rögzítési joggal lehet.</p>
        )}
        {saved.length > 0 && (
          <table className="log-table" data-testid="saved-references">
            <thead><tr><th>Mikor</th><th>Állat</th><th>BW</th><th>FR hét</th><th>N</th><th>Referencia (F)</th></tr></thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id}>
                  <td>{localDateTimeOf(r.createdAt).replace("T", " ")}</td>
                  <td>{nameOf.get(r.animalId) ?? "?"}</td>
                  <td>{num(r.bwKg.toString())} kg</td>
                  <td>{num(r.frWeekPct.toString())} %</td>
                  <td>{r.nWeek}</td>
                  <td>{num(r.fG.toString())} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {weighed && (
        <div className="card">
          <h2>Testtömeg-napló</h2>
          <div className="toolbar">
            {animals.map((a) => (
              <Link key={a.id} className={`tab${a.id === weighed.id ? " active" : ""}`} href={`/kalkulator?allat=${a.id}`}>
                {a.name}
              </Link>
            ))}
          </div>
          <p className="hint">
            {weighed.name}: utoljára mérve {last ? `${num(last.weightKg)} kg, ${last.day}` : "még nincs"}.
          </p>
          {canRecord && <BodyWeightForm animalId={weighed.id} />}
          <table className="log-table" data-testid="body-weights">
            <thead><tr><th>Nap</th><th>Tömeg</th><th>Állapot</th><th></th></tr></thead>
            <tbody>
              {weights.map((w) => (
                <tr key={w.id} className={w.status === "VALID" ? undefined : "invalid"}>
                  <td>{dateToDay(w.measuredOn)}</td>
                  <td>{num(w.weightKg.toString())} kg</td>
                  <td className="keep">{w.status === "VALID" ? "érvényes" : `érvénytelenítve: ${w.invalidationReason ?? ""}`}</td>
                  <td className="keep">{canRecord && w.status === "VALID" && <InvalidateButton url={`/api/body-weights/${w.id}/invalidate`} version={w.version} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

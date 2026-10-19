import Link from "next/link";
import { BodyWeightForm, Calculator } from "@/components/CalculatorForms";
import { InvalidateButton } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { listAnimals } from "@/lib/animals";
import { lastBodyWeight, referencesOn } from "@/lib/calculator";
import { prisma } from "@/lib/db";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, dateToDay } from "@/lib/time";

export const dynamic = "force-dynamic";

const num = (v: number | string) => String(v).replace(".", ",");

// KALK-01, KALK-02, JAV-06: pick an animal; its weights; the calculator; the reference it saves.
export default async function CalculatorPage({ searchParams }: { searchParams: Promise<{ allat?: string }> }) {
  const { level, user } = await requireModuleRead("FEEDING");
  const sp = await searchParams;
  const animals = (await listAnimals(new Date())).filter((a) => a.alive);
  const selected = animals.find((a) => a.id === sp.allat) ?? animals[0];
  const canRecord = level === "RECORD" || level === "ADMIN";
  const today = businessDayOf(new Date());
  const [last, weights, refs, runs] = selected
    ? await Promise.all([
        lastBodyWeight(selected.id),
        prisma.bodyWeight.findMany({ where: { animalId: selected.id }, orderBy: [{ measuredOn: "desc" }, { createdAt: "desc" }], take: 20 }),
        referencesOn(today),
        prisma.calculatorRun.findMany({ where: { animalId: selected.id }, orderBy: { createdAt: "desc" }, take: 5 }),
      ])
    : [null, [], {} as Record<string, number>, []];
  return (
    <Shell title="Takarmánykalkulátor" active="calculator" user={user}>
      <div className="card">
        <h2>Állat</h2>
        <div className="toolbar">
          {animals.map((a) => (
            <Link key={a.id} className={`tab${a.id === selected?.id ? " active" : ""}`} href={`/kalkulator?allat=${a.id}`}>
              {a.name}
            </Link>
          ))}
        </div>
      </div>
      {selected && (
        <>
          <div className="card">
            <h2>{selected.name}: kalkulátor</h2>
            <p className="hint">
              FR = F × N / (BW/100). A BW az utoljára mért testtömeg ({last ? `${num(last.weightKg)} kg, ${last.day}` : "még nincs mérve"}), átírható. A heti FR lépésköze és az eltérés küszöbe (±20 %) ideiglenes, a közös ellenőrzésen dől el.
            </p>
            <p className="pill" data-testid="current-reference">
              Mai referencia: {refs[selected.id] !== undefined ? `${num(refs[selected.id])} g etetésenként` : "nincs"}
            </p>
            {canRecord ? <Calculator animalId={selected.id} lastWeightKg={last?.weightKg ?? null} /> : <p className="hint">Számolni és menteni rögzítési joggal lehet.</p>}
            {runs.length > 0 && (
              <table className="log-table">
                <thead><tr><th>Mikor</th><th>BW</th><th>FR hét</th><th>N</th><th>F</th><th>Referencia</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                      <td>{num(r.bwKg.toString())} kg</td>
                      <td>{num(r.frWeekPct.toString())} %</td>
                      <td>{r.nWeek}</td>
                      <td>{num(r.fG.toString())} g</td>
                      <td>{r.savedAsReference ? "igen" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h2>Testtömeg-napló</h2>
            {canRecord && <BodyWeightForm animalId={selected.id} />}
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
        </>
      )}
    </Shell>
  );
}

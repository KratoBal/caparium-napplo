import Link from "next/link";
import { redirect } from "next/navigation";
import { AnimalActions, AnimalEditForm, InitialAnimalsLoader, InvalidateEvent, NewArrival, SimpleCreate } from "@/components/AnimalForms";
import { PlanForm } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { currentPlans } from "@/lib/feeding-plan";
import { withIcon } from "@/lib/icons";
import { animalEvents, listAnimals, listGroupsWithNames } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { initialAnimalsStatus } from "@/lib/initial-animals";
import { pickValid } from "@/lib/master";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, localDateTimeOf, localTimeOf } from "@/lib/time";

export const dynamic = "force-dynamic";

const TYPE = { ARRIVAL: "Érkezés", TRANSFER: "Áthelyezés", GROUP_CHANGE: "Csoportváltás", DEATH: "Elhullás", RELEASE: "Kiadás" } as const;
const SEX = { MALE: "hím", FEMALE: "nőstény", UNKNOWN: "?" } as const;

// DAT-01, DAT-05, EVE-03: every animal an individual; where it is and which group it belongs to
// follows from its dated events, and the whole history stays (V-14).
export default async function AnimalsPage({ searchParams }: { searchParams: Promise<{ allat?: string }> }) {
  const { user, level } = await requireModuleRead("FEEDING");
  // Lili 2026-10-26 (msg 1564214896453750805): the animal list is seen and managed by admins only for now;
  // death, transfer and release are recorded by them too. The menu hides the entry, this is the guard.
  if (user.role !== "ADMIN") redirect("/nincs-jogosultsag");
  const sp = await searchParams;
  const now = new Date();
  const [animals, groups, pools, species] = await Promise.all([
    listAnimals(now),
    listGroupsWithNames(now),
    prisma.pool.findMany({ where: { active: true }, include: { names: true }, orderBy: { code: "asc" } }),
    prisma.species.findMany({ where: { active: true }, orderBy: { scientificName: "asc" } }),
  ]);
  const poolOpts = pools.map((p) => ({ id: p.id, name: pickValid(p.names, now)?.displayName ?? p.code }));
  const selected = animals.find((a) => a.id === sp.allat);
  const events = selected ? await animalEvents(selected.id) : [];
  // caparium-hibak-5: the edit form needs the animal's species and its valid arrival
  const editable = selected && level === "ADMIN" ? await prisma.animal.findUnique({ where: { id: selected.id }, select: { speciesId: true } }) : null;
  const arrival = events.find((e) => e.type === "ARRIVAL" && e.status === "VALID");
  const plans = await currentPlans();
  const canRecord = level === "RECORD" || level === "ADMIN";
  const isAdmin = user.role === "ADMIN";
  return (
    <Shell title="Állatok" active="animals" user={user}>
      <div className="card">
        <h2>Állatok ({animals.filter((a) => a.alive).length} élő)</h2>
        <p className="hint">A csoportban tartott állat is egyed. A medence és a csoport az események szerint változik, az előzmény megmarad.</p>
        <div className="table-scroll">
          <table className="log-table" data-testid="animals-table">
            <thead>
              <tr><th>Név</th><th>Faj</th><th>Nem</th><th>Medence</th><th>Csoport</th><th>Érkezett</th><th>Állapot</th></tr>
            </thead>
            <tbody>
              {animals.map((a) => (
                <tr key={a.id} className={a.alive ? undefined : "invalid"}>
                  <td className="keep"><Link href={`/allatok?allat=${a.id}`}>{a.name}</Link></td>
                  <td>{a.species}</td>
                  <td>{SEX[a.sex]}</td>
                  <td>{a.poolName ? withIcon(a.poolEmoji, a.poolName) : "–"}</td>
                  <td>{a.groupName ?? "–"}</td>
                  <td>{a.arrived ?? "–"}</td>
                  <td className="keep">
                    {a.alive ? <span className="badge badge-valid">él</span> : <span className="badge badge-invalid">{a.ended ? `${TYPE[a.ended.type]} ${a.ended.day}` : "–"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="card" data-testid="animal-detail">
          <h2>{selected.name}</h2>
          <p className="hint">{selected.species} · {selected.poolName ?? "nincs medencében"} · {selected.groupName ?? "nincs csoportban"}</p>
          <table className="log-table">
            <thead><tr><th>Időpont</th><th>Esemény</th><th>Hova</th><th>Megjegyzés</th><th>Állapot</th><th></th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={e.status === "VALID" ? undefined : "invalid"}>
                  <td>{businessDayOf(e.occurredAt)} {localTimeOf(e.occurredAt)}</td>
                  <td>{TYPE[e.type]}</td>
                  <td>
                    {e.toPool ? pickValid(e.toPool.names, e.occurredAt)?.displayName ?? e.toPool.code : ""}
                    {e.toGroup ? ` ${pickValid(e.toGroup.names, e.occurredAt)?.name ?? ""}` : e.type === "GROUP_CHANGE" ? "nincs csoport" : ""}
                  </td>
                  <td>{e.note ?? ""}</td>
                  <td className="keep">{e.status === "VALID" ? "érvényes" : `érvénytelenítve${e.invalidationReason ? `: ${e.invalidationReason}` : ""}`}</td>
                  <td className="keep">{canRecord && e.status === "VALID" && <InvalidateEvent eventId={e.id} version={e.version} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canRecord && selected.alive && <AnimalActions animalId={selected.id} pools={poolOpts} groups={groups} />}
          {editable && (
            <AnimalEditForm
              // per animal only: a save's refresh must not remount the form (its result message stays readable)
              key={selected.id}
              a={{
                id: selected.id,
                name: selected.name,
                speciesId: editable.speciesId,
                sex: selected.sex,
                arrival: arrival
                  ? { version: arrival.version, local: localDateTimeOf(arrival.occurredAt), poolId: arrival.toPoolId, groupId: arrival.toGroupId, note: arrival.note ?? "" }
                  : null,
              }}
              species={species.map((s) => ({ id: s.id, name: s.hungarianName ? `${s.scientificName} (${s.hungarianName})` : s.scientificName }))}
              pools={poolOpts}
              groups={groups}
            />
          )}
          {canRecord && selected.alive && <PlanForm animalId={selected.id} weekdays={plans[selected.id] ?? []} />}
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>Kezdő állatlista</h2>
          <InitialAnimalsLoader {...(await initialAnimalsStatus())} />
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>Új állat, faj, csoport</h2>
          <p className="hint">Az érkezés hozza létre az állatot. A tesztkörnyezetben csak kitalált adat szerepel.</p>
          <NewArrival species={species.map((s) => ({ id: s.id, name: s.hungarianName ? `${s.scientificName} (${s.hungarianName})` : s.scientificName }))} pools={poolOpts} groups={groups} />
          <SimpleCreate url="/api/admin/species" label="Új faj tudományos neve" field="scientificName" testId="new-species" />
          <SimpleCreate url="/api/admin/animal-groups" label="Új csoport neve" field="name" testId="new-group" />
        </div>
      )}
    </Shell>
  );
}

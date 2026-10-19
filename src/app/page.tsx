import Link from "next/link";
import { Shell } from "@/components/Shell";
import { feedingHelper, waterHelper } from "@/lib/helpers";
import { prisma } from "@/lib/db";
import { moduleLevel, validAt } from "@/lib/master";
import { requireUser } from "@/lib/session";
import { missedMeasurements, MEASUREMENT_DEADLINE, RUN_OUT_DAYS, runningOut } from "@/lib/notices";
import { businessDayOf, dateToDay, dayToDate } from "@/lib/time";

export const dynamic = "force-dynamic";

async function dailyProgress(day: string) {
  const now = new Date();
  const memberships = await prisma.groupMembership.findMany({
    where: { group: { active: true, frequency: "DAILY" }, ...validAt(now) },
    select: { poolId: true },
  });
  const pools = new Set(memberships.map((m) => m.poolId));
  const measured = await prisma.measurement.findMany({
    where: { businessDay: dayToDate(day), status: "VALID", round: { group: { frequency: "DAILY" } } },
    distinct: ["poolId"],
    select: { poolId: true },
  });
  const done = measured.filter((m) => pools.has(m.poolId)).length;
  return { done, total: pools.size };
}

export default async function OverviewPage() {
  const user = await requireUser();
  const today = businessDayOf(new Date());
  // R-17: without access to the water module its numbers are not shown either
  const water = (await moduleLevel(prisma, user.id, user.role, "WATER")) !== "NONE";
  const { done, total } = water ? await dailyProgress(today) : { done: 0, total: 0 };
  const feeding = (await moduleLevel(prisma, user.id, user.role, "FEEDING")) !== "NONE";
  const dosing = (await moduleLevel(prisma, user.id, user.role, "DOSING")) !== "NONE";
  // JAV-07, ADA-07: in-app notices (NY-09 default: no e-mail)
  const missed = water ? await missedMeasurements() : { due: false, pools: [] as string[] };
  const low = dosing ? await runningOut() : [];
  // a reopened day stays open until an admin closes it again: list it so it is not forgotten
  const reopened =
    water && (await moduleLevel(prisma, user.id, user.role, "WATER")) === "ADMIN"
      ? await prisma.journalDay.findMany({
          where: { kind: "WATER", state: "OPEN", reopenings: { some: { reclosedAt: null } } },
          include: { group: true },
          orderBy: { businessDay: "asc" },
        })
      : [];
  return (
    <Shell title="Mai áttekintés" active="overview" user={user} helper={water ? await waterHelper(dosing) : feeding ? await feedingHelper(dosing) : null}>
      <h2 style={{ fontSize: 40 }}>Jó munkát!</h2>
      <p className="hint" style={{ fontSize: 17 }}>A mai feladatok és a naplók állapota egy helyen.</p>
      {reopened.length > 0 && (
        <div className="banner banner-warn" style={{ marginTop: 20 }} data-testid="reopened-days">
          Újranyitva hagyott napok:{" "}
          {reopened.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ", "}
              <Link href={`/${j.group?.frequency === "WEEKLY" ? "heti" : "vizmeres"}?csoport=${j.group?.code}&nap=${dateToDay(j.businessDay)}`}>
                {dateToDay(j.businessDay)} ({j.group?.name})
              </Link>
            </span>
          ))}
          . Ha a javítás kész, zárd le őket.
        </div>
      )}
      {(missed.pools.length > 0 || low.length > 0) && (
        <div className="banner banner-warn" style={{ marginTop: 20 }} data-testid="notices">
          {missed.pools.length > 0 && (
            <div data-testid="notice-missed">
              {MEASUREMENT_DEADLINE} elmúlt, és ma még nincs napi mérés: {missed.pools.join(", ")}. <Link href="/vizmeres">Mérés rögzítése</Link>
            </div>
          )}
          {low.length > 0 && (
            <div data-testid="notice-stock">
              Fogyóban ({RUN_OUT_DAYS} napon belül vagy már nulla alatt):{" "}
              {low.map((c) => `${c.name} (${String(c.level).replace(".", ",")} ${c.unit}${c.daysLeft !== null ? `, kb. ${String(c.daysLeft).replace(".", ",")} nap` : ""})`).join("; ")}.{" "}
              <Link href="/adagolas">Készlet</Link>
            </div>
          )}
        </div>
      )}
      <div className="cards">
        {water && (
          <Link className="tile" href="/vizmeres" data-testid="tile-daily">
            <span className="tag">Víz</span>
            <h3>Napi mérések</h3>
            <div className="big">
              {done} / {total} medence
            </div>
            <p className="hint">{total - done > 0 ? `${total - done} medence még vár` : "Minden medence mérve"}</p>
          </Link>
        )}
        {water && (
          <Link className="tile" href="/naplo">
            <span className="tag">Napló</span>
            <h3>Vízmérési napló</h3>
            <div className="big">Keresés és előzmények</div>
            <p className="hint">Dátum és medence szerint</p>
          </Link>
        )}
        {water && (
          <Link className="tile" href="/heti" data-testid="tile-weekly">
            <span className="tag">KH · Ca · Mg</span>
            <h3>Heti vízmérés</h3>
            <div className="big">Titrálás és Hanna-checker</div>
            <p className="hint">Hígítás és RO/SW cellánként</p>
          </Link>
        )}
        {feeding && (
          <Link className="tile" href="/etetes" data-testid="tile-feeding">
            <span className="tag">Etetés</span>
            <h3>Mai etetés</h3>
            <div className="big">Napi lista és tételek</div>
            <p className="hint">Evés, kivétel és kalkulátor a menüben</p>
          </Link>
        )}
        {dosing && (
          <Link className="tile" href="/adagolas" data-testid="tile-dosing">
            <span className="tag">Vegyszer</span>
            <h3>Vegyszerek</h3>
            <div className="big">Adagolás és készlet</div>
            <p className="hint">Medencénként, a készletből levonva</p>
          </Link>
        )}
      </div>
      <div className="quick">
        <h3 style={{ fontSize: 21 }}>A mai nap gyorsindítója</h3>
        <p>Mérés rögzítése és a napló megnyitása.</p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Link className="btn" href="/vizmeres">Új mérés</Link>
          <Link className="btn" href="/naplo">Napló megnyitása</Link>
        </div>
      </div>
    </Shell>
  );
}

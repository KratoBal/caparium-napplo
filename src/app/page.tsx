import Link from "next/link";
import { Shell } from "@/components/Shell";
import { helperStockAccess } from "@/lib/helper-access";
import { feedingHelper, waterHelper } from "@/lib/helpers";
import { prisma } from "@/lib/db";
import { moduleLevel } from "@/lib/master";
import { requireUser } from "@/lib/session";
import { dailyProgress, missedMeasurements, MEASUREMENT_DEADLINE, RUN_OUT_DAYS, runningOut } from "@/lib/notices";
import { businessDayOf, dateToDay, formatDay } from "@/lib/time";

export const dynamic = "force-dynamic";


// `narrow`: a portrait card (3:4) half as wide as the others, so the row stays symmetric around it (Lili 2026-10-30, msg 1565711099435819098)
type HomeCard = { id: string; href: string; caption: string[]; module: "water" | "feeding" | "dosing" | "withdrawal"; narrow?: true };
// the captions and the order of the customer's sample (exchange/caparium/kezdolap-csempek-minta-2026-10-20.jpg)
const HOME_ROWS: HomeCard[][] = [
  [
    { id: "nagymedencek", href: "/vizmeres?csoport=NAPI_NAGY", caption: ["Nagy medencék", "NAPI VÍZMÉRÉS"], module: "water" },
    { id: "kismedencek", href: "/vizmeres?csoport=NAPI_KIS", caption: ["Kis medencék", "NAPI VÍZMÉRÉS"], module: "water" },
    { id: "heti", href: "/heti", caption: ["HETI VÍZMÉRÉS"], module: "water" },
  ],
  [
    { id: "adagolas", href: "/adagolas", caption: ["Nyomelem és megkötő adagolás"], module: "dosing" },
    // Lili 2026-10-30: between the two landscape cards, a narrower portrait one with the fridge picture (hely-jelolve.png)
    { id: "takarmanyhuto", href: "/takarmanyhuto", caption: ["Takarmányhűtő"], module: "withdrawal", narrow: true },
    { id: "kalkulator", href: "/kalkulator", caption: ["Takarmány", "kalkulátor"], module: "feeding" },
  ],
  [
    { id: "kivetel", href: "/kivetel", caption: ["Takarmány kivételi napló"], module: "feeding" },
    { id: "egyedi", href: "/etetes", caption: ["Egyedi takarmánynapló"], module: "feeding" },
    { id: "evesi", href: "/evesi-naplo", caption: ["Evési napló"], module: "feeding" },
  ],
];

export default async function OverviewPage() {
  const user = await requireUser();
  const today = businessDayOf(new Date());
  // R-17: without access to the water module its numbers are not shown either
  const water = (await moduleLevel(prisma, user.id, user.role, "WATER")) !== "NONE";
  const { done, total } = water ? await dailyProgress(today) : { done: 0, total: 0 };
  const feeding = (await moduleLevel(prisma, user.id, user.role, "FEEDING")) !== "NONE";
  const dosing = (await moduleLevel(prisma, user.id, user.role, "DOSING")) !== "NONE";
  const withdrawal = (await moduleLevel(prisma, user.id, user.role, "WITHDRAWAL")) !== "NONE";
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
    <Shell active="overview" user={user} helper={water ? await waterHelper(await helperStockAccess(user)) : feeding ? await feedingHelper(await helperStockAccess(user)) : null}>
      <h2 style={{ fontSize: 40 }}>Jó munkát!</h2>
      <p className="hint" style={{ fontSize: 17 }}>A mai feladatok és a naplók állapota egy helyen.</p>
      {/* the daily count the old tile carried */}
      {water && (
        <p className="hint" data-testid="daily-progress">
          Napi mérés ma: {done} / {total} medence{total - done > 0 ? `, ${total - done} még vár` : ", mind mérve"}.
        </p>
      )}
      {reopened.length > 0 && (
        <div className="banner banner-warn" style={{ marginTop: 20 }} data-testid="reopened-days">
          Újranyitva hagyott napok:{" "}
          {reopened.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ", "}
              <Link href={`/${j.group?.frequency === "WEEKLY" ? "heti" : "vizmeres"}?csoport=${j.group?.code}&nap=${dateToDay(j.businessDay)}`}>
                {formatDay(dateToDay(j.businessDay))} ({j.group?.name})
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
      {/* caparium-hibak-5 (Balázs 2026-10-20 11:37 UTC, the customer's layout): illustrated cards, 3-2-3, the picture
          above, the caption below, each to its module; a card shows only with access to its module, as the tiles did */}
      <nav className="home-cards" aria-label="Modulok">
        {HOME_ROWS.map((row, i) => {
          const visible = row.filter((c) => ({ water, feeding, dosing, withdrawal })[c.module]);
          return visible.length ? (
            <div className="home-row" key={i}>
              {visible.map((c) => (
                <Link key={c.href} className={c.narrow ? "home-card home-card-narrow" : "home-card"} href={c.href} data-testid={`home-${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static webp, already sized for the web */}
                  <img src={`/kezdolap/${c.id}.webp`} alt="" width={c.narrow ? 720 : 960} height={c.narrow ? 960 : 640} loading={i === 0 ? "eager" : "lazy"} />
                  <span className="home-caption">
                    {c.caption.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                </Link>
              ))}
            </div>
          ) : null;
        })}
      </nav>
      {/* Lili 2026-10-26 (Caparium channel msg 1564412957499330631): "A mai nap gyorsindítója" is gone, the picture cards jump straight to
          each page. Its two links were not exclusive: "Új mérés" (/vizmeres) is the two daily water cards and the "Napi vízmérés" menu entry,
          "Napló megnyitása" (/naplo) is the "Vízmérési napló" menu entry. */}
    </Shell>
  );
}

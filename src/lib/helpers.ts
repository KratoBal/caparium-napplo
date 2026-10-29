// The two helpers (AST-01..AST-03, stage 4). Not a conversational AI: fixed quick questions about the
// page's own data (AST-02, D-23: no free text), answered from the same queries the pages use. NY-10
// default: simple icons, no AI-generated figures. AST-03: they speak up when a chemical runs out, and
// Antennarius when the day's measurement is still missing after the deadline (Lili 2026-10-27 13:25 UTC,
// card 8b22c3c2): that is the URGENT set, shown even when the figure is switched off. The greeting is not.

import { eatingDayView } from "./eating";
import { EAT_LABEL, GIVEN } from "./eating-labels";
import { feedingDayView } from "./feeding";
import { MEASUREMENT_DEADLINE, missedMeasurements, runningOut } from "./notices";
import { getGrid, listGroups } from "./queries";
import { businessDayOf, localTimeOf } from "./time";

export type HelperData = {
  who: "water" | "feeding";
  questions: { q: string; a: string }[];
  /** "Mit kapott ma …?": one answer per animal, picked from a list (still no free text) */
  perAnimal?: { name: string; a: string }[];
  /** the figure's hello in its bubble, once per session; never urgent, so it goes with the figure */
  greeting: string;
  /** AST-03: something urgent to say without being asked; shown even with the figure switched off */
  alert?: string;
  /** what the alert is about; it opens by itself once per key and session */
  alertKey?: string;
};

const INTRO = { water: "Antennarius vagyok, a vízmérésben és az adagolásban segítek.", feeding: "Zebracápa vagyok, az etetésben segítek." } as const;

/** The greeting by the local hour: morning until 10, evening from 18. */
export function greetingFor(who: HelperData["who"], now = new Date()): string {
  const t = localTimeOf(now);
  const hello = t < "10:00" ? "Jó reggelt!" : t < "18:00" ? "Szép napot!" : "Jó estét!";
  return `${hello} ${INTRO[who]} Kérdezz a gombokkal, ha valamire kíváncsi vagy.`;
}

/** Several urgent notices in one alert: one sentence each, and one key made of theirs. */
function joinAlerts(parts: Pick<HelperData, "alert" | "alertKey">[]): Pick<HelperData, "alert" | "alertKey"> {
  const some = parts.filter((p) => p.alert);
  if (!some.length) return {};
  return { alert: some.map((p) => p.alert).join(" "), alertKey: some.map((p) => p.alertKey ?? p.alert).join("#") };
}

const num = (v: string | number) => String(v).replace(".", ",");

async function stockAlert(now: Date): Promise<Pick<HelperData, "alert" | "alertKey">> {
  const low = await runningOut(now);
  if (!low.length) return {};
  return {
    alert: `Fogyóban: ${low.map((c) => `${c.name} (${num(c.level)} ${c.unit})`).join(", ")}. Érdemes a raktárból hozni.`,
    // which chemicals, not their levels: a dose that moves a level does not make it a new alert
    alertKey: low.map((c) => c.name).sort().join("|"),
  };
}

/** The day's measurement still missing after the deadline (JAV-07), as an urgent notice of the water helper. */
function missedAlert(missed: Awaited<ReturnType<typeof missedMeasurements>>): Pick<HelperData, "alert" | "alertKey"> {
  if (!missed.due || !missed.pools.length) return {};
  return {
    alert: `${MEASUREMENT_DEADLINE} elmúlt, és ma még nincs napi mérés: ${missed.pools.join(", ")}.`,
    // which pools on which day: a pool measured since takes it off, and a new day is a new notice
    alertKey: `meres:${missed.day}:${missed.pools.join("|")}`,
  };
}

/** Antennarius, the water helper. */
// R-17: the stock alert only for someone who may read the dosing module (`stock`), the rest is the page's own
export async function waterHelper(stock: boolean, now = new Date()): Promise<HelperData> {
  const day = businessDayOf(now);
  const missed = await missedMeasurements(now);
  const grids = (await Promise.all((await listGroups()).filter((g) => g.frequency === "DAILY").map((g) => getGrid(g.id, day)))).filter((g) => g !== null);
  const notMeasured: string[] = [];
  const out: string[] = [];
  for (const g of grids) {
    for (const pool of g.layout.pools) {
      const cells = g.layout.parameters.map((p) => ({ p, c: g.daily[`${pool.id}:${p.id}`] }));
      if (cells.every((x) => !x.c)) notMeasured.push(pool.name);
      for (const { p, c } of cells) {
        if (c && (c.reference === "LOW" || c.reference === "HIGH")) out.push(`${pool.name} ${p.name} ${num(c.value)} (${c.reference === "LOW" ? "alacsony" : "magas"})`);
      }
    }
  }
  const unique = [...new Set(notMeasured)];
  return {
    who: "water",
    questions: [
      { q: "Mi van még hátra ma?", a: unique.length ? `Még nincs mérés: ${unique.join(", ")}.` : "Ma minden napi medence mérve van." },
      { q: "Melyik érték lóg ki ma?", a: out.length ? out.join("; ") + "." : "Ma egyik mért érték sem lóg ki a referenciából." },
      { q: "Késésben vagyunk?", a: missed.due ? (missed.pools.length ? `Elmúlt a határidő, és még vár: ${missed.pools.join(", ")}.` : "Nem: minden megvan.") : "Még nem járt le a mai határidő." },
    ],
    greeting: greetingFor("water", now),
    ...joinAlerts([missedAlert(missed), stock ? await stockAlert(now) : {}]),
  };
}

/** Zebracápa, the feeding helper. */
export async function feedingHelper(stock: boolean, now = new Date()): Promise<HelperData> {
  const day = businessDayOf(now);
  const [feed, eat] = await Promise.all([feedingDayView(day), eatingDayView(day)]);
  const names = new Map(feed.animals.map((a) => [a.id, a.name]));
  const selected = feed.animals.filter((a) => a.selected).map((a) => a.name);
  const notAte = eat.rows
    .filter((r) => r.status && (r.status.state === "NOT_EATEN" || r.status.state === "PARTIAL"))
    .map((r) => `${names.get(r.animalId) ?? "?"} (${EAT_LABEL[r.status!.state]})`);
  const perAnimal = feed.animals.map((a) => {
    const items = feed.items.filter((i) => i.animalId === a.id || i.participants.includes(a.id));
    const status = eat.rows.find((r) => r.animalId === a.id)?.status;
    const got = items.map((i) => `${i.otherName ? `${i.feed}: ${i.otherName}` : i.feed} ${i.quantities.map((q) => `${num(q.value)} ${q.unit}`).join(" + ") || GIVEN}${i.animalId ? "" : " (a csoportjával)"}`);
    const said = status ? ` Evés: ${EAT_LABEL[status.state]}.` : "";
    return { name: a.name, a: got.length ? `Ma kapott: ${got.join("; ")}.${said}` : `Ma még nem kapott semmit.${said}` };
  });
  return {
    who: "feeding",
    questions: [
      { q: "Ki van ma a listán?", a: selected.length ? selected.join(", ") + "." : "Ma még senki nincs a listán." },
      { q: "Ki nem evett ma rendesen?", a: notAte.length ? notAte.join(", ") + "." : "Mindenki, akit rögzítettek, megette." },
      { q: "Kész a mai lista?", a: feed.listState === "FINALIZED" ? "Igen, a lista kész." : "Még nincs kész: akit a kész listán nem választanak ki, a nap végén koplalónapot kap." },
    ],
    perAnimal,
    greeting: greetingFor("feeding", now),
    ...(stock ? await stockAlert(now) : {}),
  };
}

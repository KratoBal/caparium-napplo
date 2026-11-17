// The two helpers (AST-01..AST-03, stage 4). Not a conversational AI: fixed quick questions about the
// page's own data (AST-02, D-23: no free text), answered from the same queries the pages use. NY-10
// default: simple icons, no AI-generated figures. AST-03: they speak up when a chemical runs out, and
// Antennarius when the day's measurement is still missing after the deadline (Lili 2026-10-27 13:25 UTC,
// card 8b22c3c2): that is the URGENT set, shown even when the figure is switched off. The greeting (in the component,
// "Üdv a fedélzeten <név>!", Lili 2026-10-29) is not.

import { eatingDayView } from "./eating";
import { EAT_LABEL, GIVEN } from "./eating-labels";
import { feedStock, stockStatus } from "./feed-intake";
import { feedingDayView } from "./feeding";
import { rowForDisplay } from "./mass-display";
import { missedMeasurements, runningOut } from "./notices";
import { getGrid, listGroups } from "./queries";
import { translate, type TrVars } from "./i18n/translate";
import { businessDayOf } from "./time";

export type HelperData = {
  who: "water" | "feeding";
  questions: { q: string; a: string }[];
  /** "Mit kapott ma …?": one answer per animal, picked from a list (still no free text) */
  perAnimal?: { name: string; a: string }[];
  /** AST-03: something urgent to say without being asked; shown even with the figure switched off */
  alert?: string;
  /** what the alert is about; it opens by itself once per key and session */
  alertKey?: string;
  /** which picture the figure takes with the alert (Lili 2026-10-29, item 10): the measurement first, as in the text */
  alertKind?: "measurement" | "stock" | "feed";
};

/**
 * Who sees the stock alerts: the chemicals' (R-17, the dosing module) and the feed's (the Takarmányhűtő, the withdrawal
 * module). A plain boolean is the chemicals' alone, as before the freezer stock existed.
 */
export type StockAccess = boolean | { chemicals: boolean; feed: boolean };
const accessOf = (a: StockAccess) => (typeof a === "boolean" ? { chemicals: a, feed: false } : a);

/** Several urgent notices in one alert: one sentence each, and one key made of theirs. */
function joinAlerts(parts: Pick<HelperData, "alert" | "alertKey" | "alertKind">[]): Pick<HelperData, "alert" | "alertKey" | "alertKind"> {
  const some = parts.filter((p) => p.alert);
  if (!some.length) return {};
  return { alert: some.map((p) => p.alert).join(" "), alertKey: some.map((p) => p.alertKey ?? p.alert).join("#"), alertKind: some[0].alertKind };
}

const num = (v: string | number) => String(v).replace(".", ",");

/** The page's translator (pageTr); Hungarian without it, as in a test outside a request. */
type Tr = (text: string, vars?: TrVars) => string;
const HU: Tr = (t, v) => translate("hu", t, v);

async function stockAlert(now: Date, tr: Tr): Promise<Pick<HelperData, "alert" | "alertKey" | "alertKind">> {
  const low = await runningOut(now);
  if (!low.length) return {};
  return {
    // Lili 2026-10-29 (item 10): "Vészesen fogy a(z) <vegyszer>!"; the level stays beside the name, so the notice on
    // show still takes the new level after a dose
    alert: tr("Vészesen fogy a(z) {list}!", { list: low.map((c) => `${c.name} (${num(c.level)} ${c.unit})`).join(", ") }),
    alertKind: "stock",
    // which chemicals, not their levels: a dose that moves a level does not make it a new alert
    alertKey: low.map((c) => c.name).sort().join("|"),
  };
}

/**
 * "Vészesen fogy a(z) <takarmány>!" (Lili 2026-10-29, item 10 and package item 9): a feed of the Takarmányhűtő at or below
 * zero, or at most a few days left by the average withdrawal (the chemicals' rule, stockStatus). Only a feed with an intake
 * has a stock, so the first days after the freezer starts raise nothing for the feeds nobody received yet.
 */
async function feedAlert(now: Date, tr: Tr): Promise<Pick<HelperData, "alert" | "alertKey" | "alertKind">> {
  const low = (await feedStock(now)).filter((r) => stockStatus(r).low);
  if (!low.length) return {};
  const shown = (r: (typeof low)[number]) => {
    const s = rowForDisplay(r.unit, [r.level]);
    return `${r.feed} (${s.values[0]} ${s.unit})`;
  };
  return {
    alert: tr("Vészesen fogy a(z) {list}!", { list: low.map(shown).join(", ") }),
    alertKind: "feed",
    // which feeds, not their levels: a withdrawal that moves a level does not make it a new alert
    alertKey: `takarmany:${low.map((r) => r.key).sort().join("|")}`,
  };
}

/** The day's measurement still missing after the deadline (JAV-07), as an urgent notice of the water helper. */
function missedAlert(missed: Awaited<ReturnType<typeof missedMeasurements>>, tr: Tr): Pick<HelperData, "alert" | "alertKey" | "alertKind"> {
  if (!missed.due || !missed.pools.length) return {};
  return {
    // Lili 2026-10-29 (item 10): "Még nem vagyunk kész mára! <feladatok>": the tasks are the pools still unmeasured
    alert: tr("Még nem vagyunk kész mára! {pools}.", { pools: missed.pools.join(", ") }),
    alertKind: "measurement",
    // the day, not the pools: a pool measured since changes the text, not the key, so the alert does not speak
    // again while the missing ones are being recorded (barracuda on #109; the stock alert's rule, review of #20 b)
    alertKey: `meres:${missed.day}`,
  };
}

/** Antennarius, the water helper. */
// R-17: the stock alert only for someone who may read the dosing module (`stock`), the rest is the page's own
export async function waterHelper(access: StockAccess, now = new Date(), tr: Tr = HU): Promise<HelperData> {
  const stock = accessOf(access);
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
        if (c && (c.reference === "LOW" || c.reference === "HIGH")) out.push(`${pool.name} ${p.name} ${num(c.value)} (${tr(c.reference === "LOW" ? "alacsony" : "magas")})`);
      }
    }
  }
  const unique = [...new Set(notMeasured)];
  return {
    who: "water",
    questions: [
      { q: tr("Mi van még hátra ma?"), a: unique.length ? tr("Még nincs mérés: {pools}.", { pools: unique.join(", ") }) : tr("Ma minden napi medence mérve van.") },
      { q: tr("Melyik érték lóg ki ma?"), a: out.length ? out.join("; ") + "." : tr("Ma egyik mért érték sem lóg ki a referenciából.") },
      {
        q: tr("Késésben vagyunk?"),
        a: missed.due ? (missed.pools.length ? tr("Elmúlt a határidő, és még vár: {pools}.", { pools: missed.pools.join(", ") }) : tr("Nem: minden megvan.")) : tr("Még nem járt le a mai határidő."),
      },
    ],
    ...joinAlerts([missedAlert(missed, tr), stock.chemicals ? await stockAlert(now, tr) : {}, stock.feed ? await feedAlert(now, tr) : {}]),
  };
}

/** Zebracápa, the feeding helper. */
export async function feedingHelper(access: StockAccess, now = new Date(), tr: Tr = HU): Promise<HelperData> {
  const stock = accessOf(access);
  const day = businessDayOf(now);
  const [feed, eat] = await Promise.all([feedingDayView(day), eatingDayView(day)]);
  const names = new Map(feed.animals.map((a) => [a.id, a.name]));
  const selected = feed.animals.filter((a) => a.selected).map((a) => a.name);
  const notAte = eat.rows
    .filter((r) => r.status && (r.status.state === "NOT_EATEN" || r.status.state === "PARTIAL"))
    .map((r) => `${names.get(r.animalId) ?? "?"} (${tr(EAT_LABEL[r.status!.state]!)})`);
  const perAnimal = feed.animals.map((a) => {
    const items = feed.items.filter((i) => i.animalId === a.id || i.participants.includes(a.id));
    const status = eat.rows.find((r) => r.animalId === a.id)?.status;
    const got = items.map((i) => `${i.otherName ? `${i.feed}: ${i.otherName}` : i.feed} ${i.quantities.map((q) => `${num(q.value)} ${q.unit}`).join(" + ") || tr(GIVEN)}${i.animalId ? "" : ` (${tr("a csoportjával")})`}`);
    const said = status ? ` ${tr("Evés: {state}.", { state: tr(EAT_LABEL[status.state]!) })}` : "";
    return { name: a.name, a: got.length ? `${tr("Ma kapott: {items}.", { items: got.join("; ") })}${said}` : `${tr("Ma még nem kapott semmit.")}${said}` };
  });
  return {
    who: "feeding",
    questions: [
      { q: tr("Ki van ma a listán?"), a: selected.length ? selected.join(", ") + "." : tr("Ma még senki nincs a listán.") },
      { q: tr("Ki nem evett ma rendesen?"), a: notAte.length ? notAte.join(", ") + "." : tr("Mindenki, akit rögzítettek, megette.") },
      { q: tr("Kész a mai lista?"), a: tr(feed.listState === "FINALIZED" ? "Igen, a lista kész." : "Még nincs kész: akit a kész listán nem választanak ki, a nap végén koplalónapot kap.") },
    ],
    perAnimal,
    ...joinAlerts([stock.chemicals ? await stockAlert(now, tr) : {}, stock.feed ? await feedAlert(now, tr) : {}]),
  };
}

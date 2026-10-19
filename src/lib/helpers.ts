// The two helpers (AST-01..AST-03, stage 4). Not a conversational AI: fixed quick questions about the
// page's own data (AST-02, D-23: no free text), answered from the same queries the pages use. NY-10
// default: simple icons, no AI-generated figures. AST-03: they speak up when a chemical runs out.

import { eatingDayView } from "./eating";
import { EAT_LABEL } from "./eating-labels";
import { feedingDayView } from "./feeding";
import { missedMeasurements, runningOut } from "./notices";
import { getGrid, listGroups } from "./queries";
import { businessDayOf } from "./time";

export type HelperData = {
  who: "water" | "feeding";
  questions: { q: string; a: string }[];
  /** "Mit kapott ma …?": one answer per animal, picked from a list (still no free text) */
  perAnimal?: { name: string; a: string }[];
  /** AST-03: something to say without being asked */
  alert?: string;
};

const num = (v: string | number) => String(v).replace(".", ",");

async function stockAlert(now: Date): Promise<string | undefined> {
  const low = await runningOut(now);
  if (!low.length) return undefined;
  return `Fogyóban: ${low.map((c) => `${c.name} (${num(c.level)} ${c.unit})`).join(", ")}. Érdemes a raktárból hozni.`;
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
    alert: stock ? await stockAlert(now) : undefined,
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
    const got = items.map((i) => `${i.otherName ? `${i.feed}: ${i.otherName}` : i.feed} ${i.quantities.map((q) => `${num(q.value)} ${q.unit}`).join(" + ")}${i.animalId ? "" : " (a csoportjával)"}`);
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
    alert: stock ? await stockAlert(now) : undefined,
  };
}

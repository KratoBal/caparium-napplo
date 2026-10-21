"use client";

// The feeding day as one workspace (EGY-01, EGY-06, EGY-07, EGY-08): the common list, the items, and
// the item form. A click on a recipient's row makes it active and the form follows; the live line adds
// what is typed (not saved yet) to the row's saved total, per base unit, never pieces to grams.
import { Fragment, useCallback, useState } from "react";
import { deviates } from "@/lib/calc-math";
import type { DayAnimal } from "@/lib/feeding";
import { DayFeeds, FinalizeList, GroupSelect, InvalidateButton, ItemForm, SelectBox, type FeedOpt, type FeedTypeOpt, type Recipient } from "./FeedingForms";
import { FeedingSheet } from "./FeedingSheet";

type Item = {
  id: string;
  version: number;
  animalId: string | null;
  groupId: string | null;
  feedId: string;
  feed: string;
  otherName: string | null;
  baseQuantities: { unit: string; value: number }[];
  quantities: { value: string; unit: string }[];
  participants: string[];
  noSelectedMember: boolean;
};

const num = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");
const fmt = (t: Record<string, number> | undefined) => (t ? Object.entries(t).map(([u, v]) => `${num(v)} ${u}`).join(", ") : "");

export function FeedingDay(props: {
  day: string;
  editable: boolean;
  finalized: boolean;
  animals: DayAnimal[];
  groups: { id: string; name: string; members: string[] }[];
  items: Item[];
  totals: Record<string, Record<string, number>>;
  /** EGY-08: the reference valid that day, grams per feeding, by recipient key */
  references?: Record<string, number>;
  recipients: Recipient[];
  feeds: FeedOpt[];
  otherNames?: string[];
  /** 6fe63c9b, step 2: the feed types with their feeds, and the day's choice */
  feedTypes?: FeedTypeOpt[];
  dayFeedIds?: string[];
  /** 6fe63c9b: the feeding sheet's columns */
  sheetFeeds?: FeedOpt[];
}) {
  const { day, editable, animals, groups, items, totals, recipients, feeds } = props;
  const [active, setActive] = useState(recipients[0]?.key ?? "");
  const [draft, setDraft] = useState<Record<string, number>>({});
  const onDraft = useCallback((d: Record<string, number>) => setDraft(d), []);
  const names = new Map(animals.map((a) => [a.id, a.name]));
  const itemsFor = (key: string) => items.filter((i) => (i.animalId ?? `g:${i.groupId}`) === key);
  const isRecipient = (key: string) => recipients.some((r) => r.key === key);
  const rowProps = (key: string) =>
    editable && isRecipient(key)
      ? { className: `clickable${active === key ? " active-row" : ""}`, onClick: () => setActive(key), "aria-selected": active === key }
      : {};
  const saved = totals[active] ?? {};
  const together: Record<string, number> = { ...saved };
  for (const [u, v] of Object.entries(draft)) together[u] = (together[u] ?? 0) + v;
  const activeLabel = recipients.find((r) => r.key === active)?.label;
  // EGY-08: the row's total against its reference; nothing given (fasting, not on the list) is no deviation
  const refCell = (key: string) => {
    const ref = props.references?.[key];
    if (ref === undefined) return null;
    const g = totals[key]?.g;
    const off = g !== undefined && g > 0 && deviates(g, ref);
    return (
      <span className={off ? "badge badge-invalid" : "hint"} data-testid={`reference-${key}`}>
        {" "}ref {num(ref)} g{off ? ": eltér" : ""}
      </span>
    );
  };
  const line = (i: Item) => `${i.otherName ? `${i.feed}: ${i.otherName}` : i.feed} ${i.quantities.map((q) => `${q.value.replace(".", ",")} ${q.unit}`).join(" + ")}`;

  return (
    <>
      <div className="card">
        <h2>Napi lista ({animals.filter((a) => a.selected).length} állat)</h2>
        <p className="hint">Közös lista: bármelyik akvarista módosíthatja. Akit a kész listán nem választottak ki, a nap lezárásakor koplalónapot kap.</p>
        <div className="table-scroll">
          <table className="log-table" data-testid="feeding-list">
            <thead>
              <tr><th>Listán</th><th>Állat</th><th>Medence</th><th>Csoport</th><th>Tételek</th><th>Összesen</th></tr>
            </thead>
            <tbody>
              {animals.map((a, i) => (
                <Fragment key={a.id}>
                {/* 6fe63c9b, step 1: the animals by group, with "select all" and "none" in the group's header */}
                {(i === 0 || animals[i - 1]!.groupId !== a.groupId) && (
                  <tr className="group-head" data-testid={`group-head-${a.groupName ?? "nincs"}`}>
                    <td colSpan={6}>
                      <b>{a.groupName ?? "Csoport nélkül"}</b>{" "}
                      {editable && a.groupId && (
                        <GroupSelect day={day} name={a.groupName ?? "?"} memberIds={groups.find((g) => g.id === a.groupId)?.members ?? []} />
                      )}
                    </td>
                  </tr>
                )}
                <tr {...rowProps(a.id)}>
                  <td className="keep"><SelectBox day={day} animalId={a.id} name={a.name} selected={a.selected} disabled={!editable} /></td>
                  <td>{a.name}</td>
                  <td>{a.poolName ?? "–"}</td>
                  <td>{a.groupName ?? "–"}</td>
                  <td className="keep">
                    {itemsFor(a.id).map((i) => (
                      <div key={i.id}>
                        {line(i)} {editable && <InvalidateButton url={`/api/feeding/items/${i.id}/invalidate`} version={i.version} />}
                      </div>
                    ))}
                  </td>
                  <td>
                    {fmt(totals[a.id])}
                    {refCell(a.id)}
                  </td>
                </tr>
                </Fragment>
              ))}
              {groups.map((g) =>
                itemsFor(`g:${g.id}`).length || isRecipient(`g:${g.id}`) ? (
                  <tr key={g.id} {...rowProps(`g:${g.id}`)}>
                    <td></td>
                    <td colSpan={3}>{g.name} (csoport)</td>
                    <td className="keep">
                      {itemsFor(`g:${g.id}`).map((i) => (
                        <div key={i.id}>
                          {line(i)} · <span className="hint">{i.participants.map((p) => names.get(p) ?? "?").join(", ")}</span>{" "}
                          {i.noSelectedMember && (
                            <span className="badge badge-pending" data-testid="group-item-no-member">
                              nincs kiválasztott tag: az érvénytelenítés külön döntés
                            </span>
                          )}{" "}
                          {editable && <InvalidateButton url={`/api/feeding/items/${i.id}/invalidate`} version={i.version} />}
                        </div>
                      ))}
                    </td>
                    <td>
                      {fmt(totals[`g:${g.id}`])}
                      {refCell(`g:${g.id}`)}
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
        {editable && !props.finalized && (
          <div className="toolbar">
            <FinalizeList day={day} />
          </div>
        )}
      </div>

      {props.feedTypes && (
        <div className="card">
          <h2>A nap takarmányai</h2>
          <p className="hint">A második lépés: mit kapnak ma az állatok. A takarmánylap oszlopai és a tétel takarmány-listája ezek lesznek; ha nincs kiválasztva semmi, minden takarmány választható.</p>
          <DayFeeds day={day} types={props.feedTypes} chosen={props.dayFeedIds ?? []} editable={editable} />
        </div>
      )}
      {/* keyed by the day: DayNav changes ?nap= on the same route, which keeps a client component's state, so a
          draft typed on one day would show (and save) on the next; a new day is a new sheet (barracuda #45) */}
      <FeedingSheet key={day} day={day} editable={editable} recipients={recipients} feeds={props.sheetFeeds ?? []} items={items} active={active} onActive={setActive} />
      {editable && (
        <div className="card">
          <h2>Új tétel</h2>
          <p className="hint">Kattints a listában egy állat vagy csoport sorára: a tétel annak szól. A darab és a tömeg külön mennyiség, sosem adódik össze.</p>
          {activeLabel && (
            <p className="banner banner-ok" data-testid="live-total">
              {activeLabel}: eddig {fmt(saved) || "semmi"}
              {Object.keys(draft).length > 0 && ` · most beírva ${fmt(draft)} · együtt ${fmt(together)}`}
            </p>
          )}
          <ItemForm day={day} recipients={recipients} feeds={feeds} otherNames={props.otherNames} active={active} onActive={setActive} onDraft={onDraft} />
        </div>
      )}
    </>
  );
}

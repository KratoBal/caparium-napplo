"use client";

// The feeding day as one workspace (EGY-01, EGY-06, EGY-07, EGY-08): the common list, the items, and
// the item form. A click on a recipient's row makes it active and the form follows; the live line adds
// what is typed (not saved yet) to the row's saved total, per base unit, never pieces to grams.
import { useCallback, useState } from "react";
import { deviates } from "@/lib/calc-math";
import { chooserPools, sortDayAnimals } from "@/lib/day-animals";
import { GIVEN } from "@/lib/eating-labels";
import type { DayAnimal } from "@/lib/feeding";
import { DayFeeds, EditButton, FinalizeList, GroupSwitch, InvalidateButton, ItemForm, SelectBox, type EditItem, type FeedOpt, type FeedTypeOpt, type Recipient } from "./FeedingForms";
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
  quantities: { value: string; unit: string; unitId: string; dimension: string }[];
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
  const [editing, setEditing] = useState<EditItem | null>(null);
  const names = new Map(animals.map((a) => [a.id, a.name]));
  // the chooser's lines (Lili 2026-10-26, card f67b1a06): one line per POOL, the animals arrive sorted by pool, then by name
  const chooserGroups = chooserPools(sortDayAnimals(animals));
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
  // item 5: the bottom of the choice (the animals, then the feeds) carries the one button and the state
  const finalizeBar = (
    <div className="toolbar">
      <FinalizeList day={day} finalized={props.finalized} editable={editable} />
    </div>
  );
  // item 8 (Lili 2026-10-27 12:42 UTC): "Módosítás" loads the item into the form below; only where the form can show it (the
  // recipient is on today's list, the feed is offered). Both row buttons are the quiet kind (12:46 UTC).
  const rowButtons = (key: string, i: Item) => (
    <span className="row-actions">
      {isRecipient(key) && feeds.some((f) => f.id === i.feedId) && (
        <EditButton label={line(i)} onEdit={() => setEditing({ id: i.id, version: i.version, feedId: i.feedId, otherName: i.otherName, quantities: i.quantities, recipient: key })} />
      )}
      <InvalidateButton url={`/api/feeding/items/${i.id}/invalidate`} version={i.version} row />
    </span>
  );
  const line = (i: Item) => `${i.otherName ? `${i.feed}: ${i.otherName}` : i.feed} ${i.quantities.map((q) => `${q.value.replace(".", ",")} ${q.unit}`).join(" + ") || GIVEN}`;

  return (
    <>
      {/* 6fe63c9b, step 1, in the shape of the feeds chooser (Lili 2026-10-21 11:31 UTC: "az állatok is legyenek
          olyanok, mint a takarmány kiválasztás", without the pool and group details): one line per group, names
          with a tick, "select all" and "none" per group */}
      <div className="card">
        <h2>Ki eszik ma ({animals.filter((a) => a.selected).length} állat)</h2>
        <p className="hint">Közös lista: bármelyik akvarista módosíthatja. Akit a kész listán nem választottak ki, a nap lezárásakor koplalónapot kap.</p>
        <div data-testid="animal-chooser">
          {chooserGroups.map((g) => (
            <div key={g.key} className="pick-block" data-testid={`group-head-${g.name}`}>
              <div className="section-title">
                {g.emoji && <span aria-hidden="true">{g.emoji}</span>}
                {g.name}
                {editable && <GroupSwitch day={day} name={g.name} memberIds={g.animals.map((a) => a.id)} selectedCount={g.animals.filter((a) => a.selected).length} />}
              </div>
              <div className="pick-items">
                {g.animals.map((a) => (
                  <label key={a.id} className="check">
                    <SelectBox day={day} animalId={a.id} name={a.name} selected={a.selected} disabled={!editable} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!props.feedTypes && finalizeBar}
      </div>
      {props.feedTypes && (
        <div className="card">
          <h2>A nap takarmányai</h2>
          <p className="hint">A második lépés: mit kapnak ma az állatok. A takarmánylap oszlopai és a tétel takarmány-listája ezek lesznek; ha nincs kiválasztva semmi, minden takarmány választható.</p>
          {/* the feeds' one button saves the choice and finalizes (Lili 2026-10-27 22:47 UTC); a read-only day shows the state */}
          <DayFeeds day={day} types={props.feedTypes} chosen={props.dayFeedIds ?? []} editable={editable} finalized={props.finalized} />
          {!editable && finalizeBar}
        </div>
      )}
      {/* keyed by the day: DayNav changes ?nap= on the same route, which keeps a client component's state, so a
          draft typed on one day would show (and save) on the next; a new day is a new sheet (barracuda #45) */}
      <FeedingSheet key={day} day={day} editable={editable} recipients={recipients} feeds={props.sheetFeeds ?? []} items={items} active={active} onActive={setActive} />
      {editable && (
        <div className="card">
          <h2>Új tétel</h2>
          <p className="hint">Kattints a takarmánylapon vagy a lent álló Mai tételek listában egy állat vagy csoport sorára: a tétel annak szól. A darab és a tömeg külön mennyiség, sosem adódik össze.</p>
          {activeLabel && (
            <p className="banner banner-ok" data-testid="live-total">
              {activeLabel}: eddig {fmt(saved) || "semmi"}
              {/* while an item is being changed the typed amount replaces it, so it is not added to the saved total */}
              {editing ? " · egy tétel módosítása" : Object.keys(draft).length > 0 && ` · most beírva ${fmt(draft)} · együtt ${fmt(together)}`}
            </p>
          )}
          <ItemForm
            day={day}
            recipients={recipients}
            feeds={feeds}
            otherNames={props.otherNames}
            active={active}
            onActive={setActive}
            onDraft={onDraft}
            editing={editing}
            onEditDone={() => setEditing(null)}
          />
        </div>
      )}
      {/* Lili 2026-10-26 (Caparium channel msg 1564403940320346223): "Mai tételek" is LAST, as a summary. The order of the page: Ki eszik
          ma, A nap takarmányai, Takarmánylap, Új tétel, Mai tételek (before: Mai tételek stood between the feeds and the sheet) */}
      <div className="card">
        <h2>Mai tételek</h2>
        <p className="hint">Az aznapi állatok tételei, összege és referenciája. Kattints egy sorra: az új tétel annak szól.</p>
        <div className="table-scroll">
          <table className="log-table" data-testid="feeding-list">
            <thead>
              <tr><th>Állat</th><th>Tételek</th><th>Összesen</th></tr>
            </thead>
            <tbody>
              {animals
                .filter((a) => a.selected || itemsFor(a.id).length > 0)
                .map((a) => (
                <tr key={a.id} {...rowProps(a.id)}>
                  <td>{a.name}</td>
                  <td className="keep">
                    {itemsFor(a.id).map((i) => (
                      <div key={i.id}>
                        {line(i)} {editable && rowButtons(a.id, i)}
                      </div>
                    ))}
                  </td>
                  <td>
                    {fmt(totals[a.id])}
                    {refCell(a.id)}
                  </td>
                </tr>
              ))}
              {groups.map((g) =>
                itemsFor(`g:${g.id}`).length || isRecipient(`g:${g.id}`) ? (
                  <tr key={g.id} {...rowProps(`g:${g.id}`)}>
                    <td>{g.name} (csoport)</td>
                    <td className="keep">
                      {itemsFor(`g:${g.id}`).map((i) => (
                        <div key={i.id}>
                          {line(i)} · <span className="hint">{i.participants.map((p) => names.get(p) ?? "?").join(", ")}</span>{" "}
                          {i.noSelectedMember && (
                            <span className="badge badge-pending" data-testid="group-item-no-member">
                              nincs kiválasztott tag: az érvénytelenítés külön döntés
                            </span>
                          )}{" "}
                          {editable && rowButtons(`g:${g.id}`, i)}
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
      </div>
    </>
  );
}

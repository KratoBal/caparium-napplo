"use client";

// The feeding day as one workspace (EGY-01, EGY-06, EGY-07, EGY-08): the common list, the items, and
// the item form. A click on a recipient's row makes it active and the form follows; the live line adds
// what is typed (not saved yet) to the row's saved total, per base unit, never pieces to grams.
import { useCallback, useState } from "react";
import { deviates } from "@/lib/calc-math";
import type { DayAnimal } from "@/lib/feeding";
import { FinalizeList, GroupSelect, InvalidateButton, ItemForm, SelectBox, type FeedOpt, type Recipient } from "./FeedingForms";

type Item = {
  id: string;
  version: number;
  animalId: string | null;
  groupId: string | null;
  feed: string;
  otherName: string | null;
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
        {editable && groups.length > 0 && (
          <div className="toolbar">
            {groups.map((g) => (
              <GroupSelect key={g.id} day={day} name={g.name} memberIds={g.members} />
            ))}
          </div>
        )}
        <div className="table-scroll">
          <table className="log-table" data-testid="feeding-list">
            <thead>
              <tr><th>Listán</th><th>Állat</th><th>Medence</th><th>Csoport</th><th>Tételek</th><th>Összesen</th></tr>
            </thead>
            <tbody>
              {animals.map((a) => (
                <tr key={a.id} {...rowProps(a.id)}>
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

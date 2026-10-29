"use client";

// NAMED FEEDING LISTS (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1): the dropdown in the feeding page's
// header (ApplyList) and the admin's editor on the timetable page (FeedingListsEditor). The server decides every permission, and
// never lets a list take off an animal that already has a record that day.
import { useEffect, useState } from "react";
import { chooserPools, sortDayAnimals, type ChooserAnimal } from "@/lib/day-animals";
import { Msg, useSend, type FeedTypeOpt } from "./FeedingForms";

export type ListOpt = { id: string; name: string };
export type ListView = ListOpt & { animalIds: string[]; feedIds: string[] };

function newRequestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const keptOf = (res: Record<string, unknown>) => (Array.isArray(res.kept) ? (res.kept as string[]) : []);

function appliedText(res: Record<string, unknown>): string {
  const skipped = Array.isArray(res.skipped) ? (res.skipped as string[]) : [];
  const kept = keptOf(res);
  // an animal with a record that day stays on the list (the 10-21 loss): said every time, also when the switch went off
  const keptText = kept.length ? `A listán maradt, mert ezen a napon már van beírt etetése: ${kept.join(", ")}.` : "";
  const tail = `${skipped.length ? ` Kézi koplalónap miatt kimaradt: ${skipped.join(", ")}.` : ""}${keptText ? ` ${keptText}` : ""}`;
  // Lili 2026-10-27 (item 4): the switch turned off says nothing but who stayed; the unchecked boxes show the rest
  if (res.name === null || res.name === undefined) return keptText;
  const removed = Number(res.removed ?? 0);
  return `${String(res.name)}: ${Number(res.added ?? 0)} állat kijelölve${removed ? `, ${removed} kivéve` : ""}, ${Number(res.feeds ?? 0)} takarmány.${tail}`;
}

/**
 * The header's switch and dropdown (Lili 2026-10-26, msg 1564404481708265704 and 1564405423417593988): the same kind of switch as
 * the pool's in the feeding list. On: a list can be chosen, and choosing one makes the day's selection exactly that list (it does not
 * pile up on the one before: the animals and feeds of the list are ticked, everything else is taken off; by-hand changes
 * afterwards are fine, choosing again returns to the list). Off: the whole selection is taken off. An animal that already has a
 * record that day stays, and the message names it; unticking it by hand is the way to take it off (with the usual confirmation).
 */
export function ApplyList({ day, lists, selectedAnimalIds, dayFeedIds }: { day: string; lists: ListOpt[]; selectedAnimalIds: string[]; dayFeedIds: string[] }) {
  const { msg, busy, run } = useSend();
  const [value, setValue] = useState("");
  const hasSelection = selectedAnimalIds.length > 0 || dayFeedIds.length > 0;
  const [on, setOn] = useState(hasSelection);
  // a selection that appears (a tick by hand, the weekly plan) means the switch is on; only the switch itself turns it off
  useEffect(() => {
    if (hasSelection) setOn(true);
  }, [hasSelection]);
  return (
    <span className="toolbar" style={{ margin: 0 }} data-testid="apply-list">
      <input
        className="switch"
        type="checkbox"
        role="switch"
        checked={on}
        disabled={busy}
        aria-label="Etetési listák"
        title={on ? "Bekapcsolva: lista választható. Kikapcsolva a kijelölés kikerül, kivéve akinek aznap már van beírt etetése." : "Kikapcsolva: kapcsold be a lista választásához."}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          if (next) return;
          let kept = 0;
          const text = (res: Record<string, unknown>) => ((kept = keptOf(res).length), appliedText(res));
          // the animals with a record stay ticked, so the switch stays on beside them
          void run("/api/feeding/lists/apply", { day, listId: null }, text).then((ok) => {
            if (!ok || kept) setOn(true);
          });
        }}
      />
      <select
        className="input"
        aria-label="Névvel ellátott lista"
        value={value}
        disabled={busy || !on}
        onChange={(e) => {
          const listId = e.target.value;
          if (!listId) return;
          setValue(listId);
          void run("/api/feeding/lists/apply", { day, listId }, appliedText).then(() => setValue(""));
        }}
      >
        <option value="">Lista választása…</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <Msg msg={msg} />
    </span>
  );
}

type EditAnimal = ChooserAnimal & { poolEmoji?: string | null };

function ListForm(p: { list?: ListView; animals: EditAnimal[]; types: FeedTypeOpt[] }) {
  const { list } = p;
  const [name, setName] = useState(list?.name ?? "");
  const [animalIds, setAnimalIds] = useState<string[]>(list?.animalIds ?? []);
  const [feedIds, setFeedIds] = useState<string[]>(list?.feedIds ?? []);
  const { msg, busy, run } = useSend();
  const visibleAnimals = new Set(p.animals.map((a) => a.id));
  const visibleFeeds = new Set(p.types.flatMap((t) => t.feeds.map((f) => f.id)));
  const flip = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  // members the page does not show (an animal gone since, a deactivated feed) stay in the list untouched
  const keep = (saved: string[] | undefined, visible: Set<string>) => (saved ?? []).filter((id) => !visible.has(id));
  const body = () => ({
    name: name.trim(),
    animalIds: [...animalIds.filter((id) => visibleAnimals.has(id)), ...keep(list?.animalIds, visibleAnimals)],
    feedIds: [...feedIds.filter((id) => visibleFeeds.has(id)), ...keep(list?.feedIds, visibleFeeds)],
  });
  const ready = name.trim().length >= 2 && animalIds.length + feedIds.length > 0;
  const label = list ? list.name : "új lista";
  return (
    <div data-testid={list ? `list-${list.name}` : "new-list"}>
      <div className="toolbar">
        <input className="input" aria-label={`${label}: neve`} placeholder="a lista neve" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {chooserPools(sortDayAnimals(p.animals)).map((g) => (
        <div key={g.key} className="pick-block">
          <div className="section-title">
            {g.emoji && <span aria-hidden="true">{g.emoji}</span>}
            {g.name}
          </div>
          <div className="pick-items">
            {g.animals.map((a) => (
              <label key={a.id} className="check">
                <input type="checkbox" checked={animalIds.includes(a.id)} aria-label={`${label}: ${a.name}`} onChange={() => setAnimalIds((cur) => flip(cur, a.id))} />
                {a.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      {p.types.map((t) => (
        <div key={t.code} className="pick-block">
          <div className="section-title">
            {t.emoji && <span aria-hidden="true">{t.emoji}</span>}
            {t.name}
          </div>
          <div className="pick-items">
            {t.feeds.map((f) => (
              <label key={f.id} className="check">
                <input type="checkbox" checked={feedIds.includes(f.id)} aria-label={`${label}: ${f.name}`} onChange={() => setFeedIds((cur) => flip(cur, f.id))} />
                {f.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={() =>
            void run(list ? "/api/feeding/lists/update" : "/api/feeding/lists", { requestId: newRequestId(), ...(list ? { listId: list.id } : {}), ...body() }, list ? "Mentve." : "Lista felvéve.").then((ok) => {
              if (ok && !list) {
                setName("");
                setAnimalIds([]);
                setFeedIds([]);
              }
            })
          }
        >
          {list ? "Mentés" : "Lista felvétele"}
        </button>
        {list && (
          <button
            className="btn btn-soft"
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Archiválod a(z) „${list.name}” listát? A legördülőből eltűnik, a neve újra használható.`)) {
                void run("/api/feeding/lists/archive", { requestId: newRequestId(), listId: list.id }, "Archiválva.");
              }
            }}
          >
            Archiválás
          </button>
        )}
        <Msg msg={msg} />
      </div>
    </div>
  );
}

/** The admin's side: the lists as checkboxes of animals (by pool) and feeds (by type); a new list at the end. */
export function FeedingListsEditor({ lists, animals, types }: { lists: ListView[]; animals: EditAnimal[]; types: FeedTypeOpt[] }) {
  return (
    <div className="card" data-testid="feeding-lists">
      <h2>Névvel ellátott listák</h2>
      <p className="hint">
        Egy lista állatokat és takarmányokat gyűjt egy név alá (például „Puhatestű nap”). A takarmánynapló fejlécében legördülőből választható:
        a napi lista pontosan a lista állatai és takarmányai lesz (nem halmozódik az előző listára). Utána kézzel bővíthető és szűkíthető;
        a „Mai Terv” mellette marad. A fejléc kapcsolója kikapcsolva az összes kijelölést kiveszi.
      </p>
      {lists.map((l) => (
        <details key={l.id} className="pick-details">
          <summary>{l.name}</summary>
          <ListForm list={l} animals={animals} types={types} />
        </details>
      ))}
      <h3 style={{ marginTop: 20 }}>Új lista</h3>
      <ListForm animals={animals} types={types} />
    </div>
  );
}

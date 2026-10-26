"use client";

// NAMED FEEDING LISTS (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1): the dropdown in the feeding page's
// header (ApplyList) and the admin's editor on the timetable page (FeedingListsEditor). The list ticks and adds, never takes
// off; the server decides every permission.
import { useState } from "react";
import { chooserPools, sortDayAnimals, type ChooserAnimal } from "@/lib/day-animals";
import { Msg, useSend, type FeedTypeOpt } from "./FeedingForms";

export type ListOpt = { id: string; name: string };
export type ListView = ListOpt & { animalIds: string[]; feedIds: string[] };

function newRequestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function appliedText(res: Record<string, unknown>): string {
  const added = Number(res.added ?? 0);
  const feeds = Number(res.feedsAdded ?? 0);
  const skipped = Array.isArray(res.skipped) ? (res.skipped as string[]) : [];
  const parts = [`${added} állat a listán`, `${feeds} új takarmány`];
  const tail = skipped.length ? ` Kézi koplalónap miatt kimaradt: ${skipped.join(", ")}.` : "";
  return `${String(res.name ?? "A lista")}: ${parts.join(", ")}.${tail}`;
}

/** The header's dropdown: choosing a list ticks its animals and adds its feeds (and only adds). */
export function ApplyList({ day, lists }: { day: string; lists: ListOpt[] }) {
  const { msg, busy, run } = useSend();
  const [value, setValue] = useState("");
  return (
    <span className="toolbar" style={{ margin: 0 }} data-testid="apply-list">
      <select
        className="input"
        aria-label="Névvel ellátott lista"
        value={value}
        disabled={busy}
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
        kipipálja a lista állatait és hozzáadja a takarmányait a napi listához. Utána kézzel bővíthető és szűkíthető; a „Lista a terv szerint”
        mellette marad. A lista csak hozzáad, a napon semmit nem vesz le.
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

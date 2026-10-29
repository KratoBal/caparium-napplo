"use client";

// Lili 2026-10-29: a small, quiet X in an amount field's top right corner empties it in one click, the same as
// deleting the value by hand; shown only while the field holds something. The feeding sheet and the daily and weekly
// water measurements use it (wrap the field in <span className="clearable">). Not in the tab order, not printed.
// The label must not be the field's own label with a word added: a lookup by the field's label would find both.
export function ClearX({ shown, label, onClear }: { shown: boolean; label: string; onClear: () => void }) {
  if (!shown) return null;
  return (
    <button
      type="button"
      className="clear-x no-print"
      tabIndex={-1}
      title="Kiürítés"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
    >
      &times;
    </button>
  );
}

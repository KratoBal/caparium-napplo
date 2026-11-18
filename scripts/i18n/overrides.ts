// Decisions given apart from the sheets (card 01dcddeb), applied OVER the sheets by the import (scripts/i18n/import.ts), each with its
// source. A sheet row that says otherwise does not undo one: without this list the next import would write the old English back into
// en.ts. When a later sheet carries the same decision, its line here can go. A key the code no longer uses is reported, not written.
export const OVERRIDES: Readonly<Record<string, { en: string; source: string }>> = {
  V: { en: "Vit", source: "Lili 2026-11-18 09:57 UTC (acrobot 55615): the vitamin mark on screen; the Excel export keeps V" },
  Gy: { en: "Med", source: "Lili 2026-11-18 09:57 UTC (acrobot 55615): the medicine mark on screen; the Excel export keeps Gy" },
  evett: { en: "Ate", source: "Lili 2026-11-18 09:59 UTC (acrobot 55618): the eating state, on the label and in the drop-down; missing from the first sheet. The Excel export writes the stored state (its colour) and V/Gy, not this text" },
  kedd: { en: "Tuesday", source: "a weekday name missing from the first sheet (the other four are in it)" },
  szerda: { en: "Wednesday", source: "a weekday name missing from the first sheet" },
  szombat: { en: "Saturday", source: "a weekday name missing from the first sheet" },
  "Sűrűség": { en: "Salinity", source: "Lili 2026-11-18 13:08 UTC (msg 1572599428135526483, acrobot 55913): the daily WQ column header" },
};

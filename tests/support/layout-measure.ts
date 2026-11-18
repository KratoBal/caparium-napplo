// The geometry of the English layout check (t-20261118-caparium-elrendezes), as ONE self-contained function: Playwright serialises it into the page
// (page.evaluate), and the calibration runs the very same text against a static page. It returns what it found AND how many of each thing it
// measured, so a spec can demand that something was measured: a check that skips a missing row or button without counting it is green on an
// empty page and proves nothing (barracuda, caparium #261 review).
export type LayoutReport = {
  found: string[];
  measured: { formButtons: number; ticks: number; headChips: number; dayButtons: number; emptyLists: number };
};

export function measureLayout([where, tolerance]: readonly [string, number]): LayoutReport {
  const found: string[] = [];
  const measured = { formButtons: 0, ticks: 0, headChips: 0, dayButtons: 0, emptyLists: 0 };
  const rect = (e: Element) => e.getBoundingClientRect();
  const visible = (e: Element) => e.getClientRects().length > 0;
  const mid = (e: Element) => (rect(e).top + rect(e).bottom) / 2;
  for (const row of Array.from(document.querySelectorAll<HTMLElement>(".toolbar"))) {
    if (!visible(row)) continue;
    const fields = Array.from(row.querySelectorAll(":scope > .field")).filter(visible);
    const buttons = Array.from(row.querySelectorAll(":scope > button.btn")).filter(visible);
    const inputs = fields.flatMap((f) => Array.from(f.querySelectorAll("input.input, select.input"))).filter(visible);
    if (fields.length === 0 || inputs.length === 0) continue;
    const bottom = Math.max(...inputs.map((i) => rect(i).bottom));
    for (const b of buttons) {
      measured.formButtons += 1;
      if (Math.abs(rect(b).bottom - bottom) > tolerance)
        found.push(`${where} button "${(b.textContent ?? "").trim().slice(0, 24)}" bottom ${Math.round(rect(b).bottom)} vs fields ${Math.round(bottom)}`);
    }
    for (const box of Array.from(row.querySelectorAll(":scope > .field > input[type=checkbox]")).filter(visible)) {
      measured.ticks += 1;
      if (Math.abs(mid(box) - mid(inputs[0])) > tolerance)
        found.push(`${where} tick centre ${Math.round(mid(box))} vs inputs ${Math.round(mid(inputs[0]))}`);
    }
  }
  for (const chip of Array.from(document.querySelectorAll(".toolbar-end > .head-chip")).filter(visible)) {
    measured.headChips += 1;
    const inner = chip.firstElementChild ?? chip;
    // the badge of the SAME row
    const dayBadge = chip.parentElement?.querySelector(":scope > .day-controls .badge");
    if (dayBadge && Math.abs(mid(inner) - mid(dayBadge)) > tolerance)
      found.push(`${where} head chip centre ${Math.round(mid(inner))} vs day badge ${Math.round(mid(dayBadge))}`);
  }
  for (const head of Array.from(document.querySelectorAll<HTMLElement>(".toolbar-end")).filter(visible)) {
    const button = head.querySelector(":scope > .day-controls button");
    const date = head.querySelector("input.input");
    if (!button || !date) continue;
    measured.dayButtons += 1;
    if (Math.abs(mid(button) - mid(date)) > tolerance)
      found.push(`${where} day button centre ${Math.round(mid(button))} vs date field ${Math.round(mid(date))}`);
  }
  for (const id of ["withdrawal-list", "intake-list"]) {
    const table = document.querySelector(`[data-testid=${id}]`);
    if (table && table.querySelectorAll("tbody tr").length === 0) {
      measured.emptyLists += 1;
      found.push(`${where} ${id} is a header without rows`);
    }
  }
  return { found, measured };
}

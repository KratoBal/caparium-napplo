// Enter closes a number field and moves on (Lili, acrobot 45552). Pure: fake fields and a fake document, no DOM.
import { describe, expect, it, vi } from "vitest";
import { attachEnterNext, handleEnter, isNumberEntry, type EnterDocument, type EnterEvent } from "@/lib/enter-next";

type Log = string[];

function field(name: string, over: Record<string, unknown> = {}, log: Log = []) {
  return {
    name,
    tagName: "INPUT",
    type: "text",
    inputMode: "decimal",
    getClientRects: () => [1],
    blur: vi.fn(() => log.push(`blur ${name}`)),
    focus: vi.fn(() => log.push(`focus ${name}`)),
    select: vi.fn(() => log.push(`select ${name}`)),
    form: null as { elements: unknown[] } | null,
    closest: undefined as unknown,
    ...over,
  };
}
type F = ReturnType<typeof field>;

/** A page of fields in document order; `inForm` puts them in one fake form. */
function page(fields: F[], inForm = false, onPage: F[] = fields) {
  const scope = { querySelectorAll: () => onPage };
  const form = { elements: fields };
  for (const f of fields) {
    f.closest = () => scope;
    if (inForm) f.form = form;
  }
  const body = { querySelectorAll: () => onPage };
  const doc = { body, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as EnterDocument & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  return { doc, form };
}

function key(target: unknown, over: Partial<EnterEvent> = {}) {
  const prevented = { n: 0 };
  const e: EnterEvent = {
    key: "Enter",
    defaultPrevented: false,
    target,
    preventDefault: () => {
      prevented.n += 1;
    },
    ...over,
  };
  return { e, prevented };
}

describe("Enter in a number field", () => {
  it("closes the value (blur) first, then moves the focus to the next field and selects it", () => {
    const log: Log = [];
    const a = field("a", {}, log);
    const b = field("b", {}, log);
    const { doc } = page([a, b]);
    const { e, prevented } = key(a);
    handleEnter(e, doc);
    expect(log).toEqual(["blur a", "focus b", "select b"]);
    expect(prevented.n).toBe(1);
  });

  it("the numeric keypad's Enter is the same key (code NumpadEnter, key Enter)", () => {
    const a = field("a");
    const b = field("b");
    const { doc } = page([a, b]);
    const { e } = key(a, { code: "NumpadEnter" } as Partial<EnterEvent>);
    handleEnter(e, doc);
    expect(b.focus).toHaveBeenCalledTimes(1);
  });

  it("never submits the form: the default of Enter is prevented, also on the last field", () => {
    const a = field("a");
    const b = field("b");
    const { doc } = page([a, b], true);
    const first = key(a);
    handleEnter(first.e, doc);
    const last = key(b);
    handleEnter(last.e, doc);
    expect(first.prevented.n).toBe(1);
    expect(last.prevented.n).toBe(1);
    // the last field has no next one: it only closes the value
    expect(b.blur).toHaveBeenCalledTimes(1);
    expect(a.focus).not.toHaveBeenCalled();
  });

  it("goes to the next field of ITS form, not of the page", () => {
    const a = field("a");
    const b = field("b");
    const other = field("other");
    // `other` sits between them on the page but not in the form
    const { doc } = page([a, b], true, [a, other, b]);
    handleEnter(key(a).e, doc);
    expect(b.focus).toHaveBeenCalledTimes(1);
    expect(other.focus).not.toHaveBeenCalled();
  });

  it("skips what Tab would skip: hidden, checkbox, disabled, read-only, not drawn, tabindex -1", () => {
    const a = field("a");
    const skipped = [
      field("hidden", { type: "hidden" }),
      field("check", { type: "checkbox" }),
      field("off", { disabled: true }),
      field("ro", { readOnly: true }),
      field("gone", { getClientRects: () => [] }),
      field("tab", { tabIndex: -1 }),
      field("btn", { tagName: "BUTTON" }),
    ];
    const target = field("target");
    const { doc } = page([a, ...skipped, target]);
    handleEnter(key(a).e, doc);
    for (const s of skipped) expect(s.focus).not.toHaveBeenCalled();
    expect(target.focus).toHaveBeenCalledTimes(1);
  });

  it("moves onto a select (the unit next to a quantity) and a text field, without selecting a select", () => {
    const a = field("a");
    const unit = field("unit", { tagName: "SELECT", inputMode: undefined, type: "select-one" });
    const { doc } = page([a, unit]);
    handleEnter(key(a).e, doc);
    expect(unit.focus).toHaveBeenCalledTimes(1);
    expect(unit.select).not.toHaveBeenCalled();
  });

  it("works for the number type and the numeric input mode, not for a plain text field", () => {
    expect(isNumberEntry(field("n", { type: "number", inputMode: undefined }))).toBe(true);
    expect(isNumberEntry(field("n", { inputMode: "numeric" }))).toBe(true);
    expect(isNumberEntry(field("n", { inputMode: "decimal" }))).toBe(true);
    expect(isNumberEntry(field("n", { inputMode: "" }))).toBe(false);
    expect(isNumberEntry(field("n", { inputMode: undefined }))).toBe(false);
    expect(isNumberEntry(field("n", { tagName: "TEXTAREA" }))).toBe(false);
  });

  it("leaves a plain text field alone: no prevent, no blur, no move", () => {
    const a = field("a", { inputMode: undefined });
    const b = field("b");
    const { doc } = page([a, b]);
    const { e, prevented } = key(a);
    handleEnter(e, doc);
    expect(prevented.n).toBe(0);
    expect(a.blur).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("leaves a field with its own Enter alone: the feed exception's save and the place field's move already answered", () => {
    const a = field("a");
    const b = field("b");
    const { doc } = page([a, b]);
    const { e, prevented } = key(a, { defaultPrevented: true });
    handleEnter(e, doc);
    expect(prevented.n).toBe(0);
    expect(a.blur).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("ignores other keys and Enter with a modifier", () => {
    const a = field("a");
    const b = field("b");
    const { doc } = page([a, b]);
    for (const over of [{ key: "Tab" }, { key: "a" }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const { e, prevented } = key(a, over);
      handleEnter(e, doc);
      expect(prevented.n).toBe(0);
    }
    expect(a.blur).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("a held key or an input-method confirmation moves nothing, but still does not submit", () => {
    for (const over of [{ repeat: true }, { isComposing: true }]) {
      const a = field("a");
      const b = field("b");
      const { doc } = page([a, b], true);
      const { e, prevented } = key(a, over);
      handleEnter(e, doc);
      expect(prevented.n).toBe(1);
      expect(a.blur).not.toHaveBeenCalled();
      expect(b.focus).not.toHaveBeenCalled();
    }
  });
});

describe("attachEnterNext", () => {
  it("listens for keydown in the bubble phase (after a field's own handler) and detaches the same listener", () => {
    const { doc } = page([field("a")]);
    const detach = attachEnterNext(doc);
    expect(doc.addEventListener).toHaveBeenCalledTimes(1);
    const [type, listener, ...rest] = doc.addEventListener.mock.calls[0]!;
    expect(type).toBe("keydown");
    // no third argument: not the capture phase, so a field's own handler (React's, at the root) has already run
    expect(rest).toEqual([]);
    detach();
    expect(doc.removeEventListener).toHaveBeenCalledWith("keydown", listener);
  });
});

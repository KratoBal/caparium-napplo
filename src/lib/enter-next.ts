// ENTER CLOSES A NUMBER FIELD, ONE COPY (Lili, Caparium thread, acrobot 45552, 2026-11-10): where a number is typed, Enter
// is the same as clicking out of the field (the value is closed: the cell stays a draft, nothing is saved), and the focus
// moves to the next field, like Tab. It NEVER saves, closes the day or submits a form.
// Pure of React so the unit tests (node, no DOM) can drive it with a fake document and fake fields, like leave-warning.ts.

/** The slice of an element the rules read. */
export type FieldLike = {
  tagName: string;
  type?: string;
  inputMode?: string;
  disabled?: boolean;
  readOnly?: boolean;
  tabIndex?: number;
  /** empty when the element is not drawn (display none, a closed panel): it cannot take the focus */
  getClientRects?(): ArrayLike<unknown>;
};

/** Inputs of these types are not a place to type: Enter on them (or moving onto them) is not this rule's business. */
const NOT_TYPED = new Set(["hidden", "checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"]);

/** A field where a number is typed: a decimal or numeric input mode, or the number type. */
export function isNumberEntry(el: FieldLike | null | undefined): boolean {
  if (!el || el.tagName?.toUpperCase() !== "INPUT") return false;
  if (el.disabled || el.readOnly) return false;
  const mode = (el.inputMode ?? "").toLowerCase();
  return el.type === "number" || mode === "decimal" || mode === "numeric";
}

/** A field the focus may move to: what Tab would stop at and a person types into or picks from. */
export function isFocusTarget(el: FieldLike): boolean {
  const tag = el.tagName?.toUpperCase();
  if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return false;
  if (el.disabled || el.readOnly) return false;
  if (tag === "INPUT" && NOT_TYPED.has((el.type ?? "text").toLowerCase())) return false;
  if (el.tabIndex !== undefined && el.tabIndex < 0) return false;
  if (el.getClientRects && el.getClientRects().length === 0) return false;
  return true;
}

/** The next field after `current` in document order, or null when it is the last one. */
export function nextField<T extends FieldLike>(fields: readonly T[], current: T): T | null {
  const at = fields.indexOf(current);
  if (at < 0) return null;
  for (let i = at + 1; i < fields.length; i += 1) if (isFocusTarget(fields[i]!)) return fields[i]!;
  return null;
}

/** The key event slice the rule reads. */
export type EnterEvent = {
  key: string;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  target: unknown;
  preventDefault(): void;
};

/** The element slice the handler acts on. */
export type EnterTarget = FieldLike & {
  form?: { elements: ArrayLike<FieldLike> } | null;
  blur(): void;
  closest?(selector: string): { querySelectorAll(selector: string): ArrayLike<FieldLike> } | null;
};

/** The slice of `document` the rule uses. */
export type EnterDocument = {
  addEventListener(type: "keydown", listener: (e: EnterEvent) => void): void;
  removeEventListener(type: "keydown", listener: (e: EnterEvent) => void): void;
  body: { querySelectorAll(selector: string): ArrayLike<FieldLike> };
};

const FIELDS = "input, select, textarea";

/** The numeric keypad's Enter also reports the key `Enter` (its `code` is `NumpadEnter`), so one check covers both. */
export function handleEnter(e: EnterEvent, doc: EnterDocument): void {
  // a field with its own Enter (the feed exception's save, the place field's move) has already answered and said so
  if (e.defaultPrevented || e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const target = e.target as EnterTarget | null;
  if (!isNumberEntry(target)) return;
  // the default of Enter in a form is to submit it: never, here
  e.preventDefault();
  // a held key or an input-method confirmation closes nothing and moves nothing: only the one press does
  if (e.repeat || e.isComposing) return;
  const field = target as EnterTarget;
  field.blur();
  const scope = field.closest?.("main") ?? doc.body;
  const fields = Array.from((field.form?.elements ?? scope.querySelectorAll(FIELDS)) as ArrayLike<FieldLike>).filter((el) => {
    const tag = el.tagName?.toUpperCase();
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  });
  const next = nextField(fields, field) as (FieldLike & { focus?(): void; select?(): void }) | null;
  if (!next) return;
  next.focus?.();
  // like Tab: the typed value of the next field is selected, so the next number replaces it
  if (next.tagName.toUpperCase() === "INPUT") next.select?.();
}

/** Attaches the rule to the document once. It runs in the bubble phase, after a field's own handler, which is how an own Enter wins. */
export function attachEnterNext(doc: EnterDocument): () => void {
  const listener = (e: EnterEvent) => handleEnter(e, doc);
  doc.addEventListener("keydown", listener);
  return () => doc.removeEventListener("keydown", listener);
}

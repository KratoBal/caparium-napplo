// The "leaving with unsaved values" question, shared by the measurement page, the feeding sheet and the eating log
// (barracuda on #51). Pure: a fake window and document, no DOM.
import { describe, expect, it, vi } from "vitest";
import { attachLeaveWarning, type LeaveDocument, type LeaveWindow } from "@/lib/leave-warning";

const MESSAGE = "Van még nem mentett érték. Továbblépsz mentés nélkül?";

function setup(count: { n: number }, answer = true, onWarn?: () => void) {
  const handlers = { beforeunload: null as null | ((e: BeforeUnloadEvent) => void), click: null as null | ((e: MouseEvent) => void) };
  const calls = { added: [] as string[], removed: [] as string[], captures: [] as boolean[] };
  const confirm = vi.fn(() => answer);
  const win: LeaveWindow = {
    addEventListener: (type, listener) => {
      calls.added.push(type);
      handlers.beforeunload = listener;
    },
    removeEventListener: (type, listener) => {
      calls.removed.push(type);
      if (handlers.beforeunload === listener) handlers.beforeunload = null;
    },
    confirm,
  };
  const doc: LeaveDocument = {
    addEventListener: (type, listener, capture) => {
      calls.added.push(type);
      calls.captures.push(capture);
      handlers.click = listener;
    },
    removeEventListener: (type, listener, capture) => {
      calls.removed.push(type);
      calls.captures.push(capture);
      if (handlers.click === listener) handlers.click = null;
    },
  };
  const detach = attachLeaveWarning(() => count.n, MESSAGE, win, doc, onWarn);
  return { handlers, calls, confirm, detach };
}

/** A click on a link (or on something inside one), as the capture-phase handler sees it. */
function linkClick(over: Partial<{ button: number; defaultPrevented: boolean; target: string | null; hasLink: boolean }> = {}) {
  const { button = 0, defaultPrevented = false, target = null, hasLink = true } = over;
  const e = {
    button,
    defaultPrevented,
    target: { closest: () => (hasLink ? { target } : null) },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
}

describe("attachLeaveWarning", () => {
  it("attaches the page-unload listener and a capture-phase click listener, and removes both", () => {
    const { calls, detach } = setup({ n: 0 });
    expect(calls.added.sort()).toEqual(["beforeunload", "click"]);
    expect(calls.captures).toEqual([true]);
    detach();
    expect(calls.removed.sort()).toEqual(["beforeunload", "click"]);
    expect(calls.captures).toEqual([true, true]);
  });

  it("asks on the page unload only while something is unsaved", () => {
    const count = { n: 0 };
    const { handlers } = setup(count);
    const quiet = { preventDefault: vi.fn(), returnValue: "x" } as unknown as BeforeUnloadEvent;
    handlers.beforeunload!(quiet);
    expect(quiet.preventDefault).not.toHaveBeenCalled();
    count.n = 2;
    const asked = { preventDefault: vi.fn(), returnValue: "x" } as unknown as BeforeUnloadEvent;
    handlers.beforeunload!(asked);
    expect(asked.preventDefault).toHaveBeenCalledTimes(1);
    expect(asked.returnValue).toBe("");
  });

  it("reads the LATEST count at every event, not the one at attach time", () => {
    const count = { n: 0 };
    const { handlers, confirm } = setup(count, false);
    handlers.click!(linkClick());
    expect(confirm).not.toHaveBeenCalled();
    count.n = 1;
    handlers.click!(linkClick());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("an in-app link click: the question carries the message; a no stops the navigation, a yes lets it go", () => {
    const count = { n: 3 };
    const no = setup(count, false);
    const stopped = linkClick();
    no.handlers.click!(stopped);
    expect(no.confirm).toHaveBeenCalledWith(MESSAGE);
    expect(stopped.preventDefault).toHaveBeenCalledTimes(1);
    expect(stopped.stopPropagation).toHaveBeenCalledTimes(1);

    const yes = setup(count, true);
    const allowed = linkClick();
    yes.handlers.click!(allowed);
    expect(yes.confirm).toHaveBeenCalledTimes(1);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(allowed.stopPropagation).not.toHaveBeenCalled();
  });

  it("does not ask for what does not leave the page: no link, a new-tab link, a non-primary button, an already handled click", () => {
    const count = { n: 5 };
    const { handlers, confirm } = setup(count, false);
    handlers.click!(linkClick({ hasLink: false }));
    handlers.click!(linkClick({ target: "_blank" }));
    handlers.click!(linkClick({ button: 1 }));
    handlers.click!(linkClick({ defaultPrevented: true }));
    expect(confirm).not.toHaveBeenCalled();
  });

  // card 0d617f0c: the save reminder speaks the moment the page is about to be left with unsaved values
  it("calls onWarn before the question, on a link and on the unload, and only while something is unsaved", () => {
    const count = { n: 0 };
    const order: string[] = [];
    const onWarn = vi.fn(() => order.push("warn"));
    const { handlers, confirm } = setup(count, true, onWarn);
    confirm.mockImplementation(() => (order.push("confirm"), true));
    handlers.click!(linkClick());
    handlers.beforeunload!({ preventDefault: vi.fn(), returnValue: "x" } as unknown as BeforeUnloadEvent);
    expect(onWarn).not.toHaveBeenCalled();
    count.n = 1;
    handlers.click!(linkClick());
    expect(order).toEqual(["warn", "confirm"]);
    handlers.beforeunload!({ preventDefault: vi.fn(), returnValue: "x" } as unknown as BeforeUnloadEvent);
    expect(onWarn).toHaveBeenCalledTimes(2);
  });
});

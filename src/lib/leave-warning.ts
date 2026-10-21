// THE "LEAVING WITH UNSAVED VALUES" QUESTION, ONE COPY (barracuda on #51, acrobot 34756). The measurement page (#38),
// the feeding sheet (#45) and the eating log (#51) each carried the same two listeners; this is that code, moved.
// Pure of React so the unit tests (node, no DOM) can drive it with a fake window and document.

/** The slice of `window` the warning uses. */
export type LeaveWindow = {
  addEventListener(type: "beforeunload", listener: (e: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (e: BeforeUnloadEvent) => void): void;
  confirm(message: string): boolean;
};

/** The slice of `document` the warning uses. */
export type LeaveDocument = {
  addEventListener(type: "click", listener: (e: MouseEvent) => void, capture: boolean): void;
  removeEventListener(type: "click", listener: (e: MouseEvent) => void, capture: boolean): void;
};

/**
 * Asks before the page (reload, close, an external address) or an in-app link is left while `unsaved()` is above
 * zero. In-app links do not fire `beforeunload`, so their click is caught first, in the capture phase; a link that
 * opens in a new tab leaves the page alone and is not asked. The browser's back button is neither a click nor an
 * unload in the App Router, so it is not asked. Returns the function that removes both listeners.
 */
export function attachLeaveWarning(unsaved: () => number, message: string, win: LeaveWindow, doc: LeaveDocument): () => void {
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (unsaved() === 0) return;
    e.preventDefault();
    e.returnValue = "";
  };
  const click = (e: MouseEvent) => {
    if (unsaved() === 0 || e.defaultPrevented || e.button !== 0) return;
    const link = (e.target as Element | null)?.closest?.("a[href]");
    if (!link || (link as HTMLAnchorElement).target === "_blank") return;
    if (!win.confirm(message)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  win.addEventListener("beforeunload", beforeUnload);
  doc.addEventListener("click", click, true);
  return () => {
    win.removeEventListener("beforeunload", beforeUnload);
    doc.removeEventListener("click", click, true);
  };
}

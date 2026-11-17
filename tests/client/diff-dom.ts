/**
 * Reading and driving a diff drawn by @pierre/diffs, which renders into a
 * shadow root that Testing Library's queries do not enter. Pointer events are
 * composed so the library's document listeners hear them, as a browser's do.
 */
import { act, waitFor } from "@testing-library/react";

/** The diff's shadow root, once it has drawn its lines. */
export async function diffRoot(within: ParentNode = document): Promise<ShadowRoot> {
  let root: ShadowRoot | null | undefined;
  await waitFor(() => {
    root = within.querySelector("diffs-container")?.shadowRoot;
    if (!root?.querySelector("[data-gutter] [data-column-number]")) throw new Error("not drawn");
  });
  return root!;
}

/** The diff's code as text, one line per row. */
export function diffText(root: ShadowRoot): string[] {
  return [...root.querySelectorAll("[data-content] > [data-line]")].map((l) => l.textContent ?? "");
}

/** A line's number in the gutter: new-file numbers, or old ones for removed lines. */
export function lineNumber(root: ShadowRoot, no: number, side: "new" | "old" = "new"): Element {
  const found = [...root.querySelectorAll(`[data-gutter] > [data-column-number="${no}"]`)].find(
    (el) => (el.getAttribute("data-line-type") === "change-deletion") === (side === "old"),
  );
  if (!found) throw new Error(`no ${side} line ${no} in the gutter`);
  return found;
}

const pointer = (type: string, target: Element, init: PointerEventInit = {}) =>
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        ...init,
      }),
    );
  });

/** A line in the gutter, found again at each step (the diff redraws as you select). */
export type LineRef = () => Element;

/** Press on a line number, slide over others, and let go on the last. */
export async function drag(path: LineRef[], init: PointerEventInit = {}) {
  await pointer("pointerdown", path[0]!(), init);
  for (const el of path.slice(1)) await pointer("pointermove", el(), init);
  await pointer("pointerup", path[path.length - 1]!(), init);
}

/** Click a line number (shift-click with `{ shiftKey: true }`). */
export const clickLine = (el: LineRef, init: PointerEventInit = {}) => drag([el], init);

/** A line number of the diff in `root`, as a `LineRef`. */
export const line =
  (root: ShadowRoot, no: number, side: "new" | "old" = "new"): LineRef =>
  () =>
    lineNumber(root, no, side);

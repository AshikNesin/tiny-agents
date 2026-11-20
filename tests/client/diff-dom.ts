import { act, waitFor } from "@testing-library/react";

export async function diffRoot(within: ParentNode = document): Promise<ShadowRoot> {
  let root: ShadowRoot | null | undefined;
  await waitFor(() => {
    root = within.querySelector("diffs-container")?.shadowRoot;
    if (!root?.querySelector("[data-gutter] [data-column-number]")) throw new Error("not drawn");
  });
  return root!;
}

export function diffText(root: ShadowRoot): string[] {
  return [...root.querySelectorAll("[data-content] > [data-line]")].map((l) => l.textContent ?? "");
}

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

export type LineRef = () => Element;

export async function drag(path: LineRef[], init: PointerEventInit = {}) {
  await pointer("pointerdown", path[0]!(), init);
  for (const el of path.slice(1)) await pointer("pointermove", el(), init);
  await pointer("pointerup", path[path.length - 1]!(), init);
}

export const clickLine = (el: LineRef, init: PointerEventInit = {}) => drag([el], init);

export const line =
  (root: ShadowRoot, no: number, side: "new" | "old" = "new"): LineRef =>
  () =>
    lineNumber(root, no, side);

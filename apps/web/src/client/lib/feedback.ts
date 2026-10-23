/**
 * FeedbackBee bridge. The embed (index.html) owns the feedback panel; the
 * app restyles it as a centered modal (app.css) and adds what a modal needs
 * that the embed lacks: opening from the sidebar menu (its floating launcher
 * is hidden in the app) and closing on an outside click.
 */
import { toast } from "sonner";

const panel = () => document.querySelector<HTMLElement>(".fbx-panel");

/**
 * Opens the panel by clicking the embed's (possibly hidden) launcher.
 * `keyboard` mirrors how the user got here: the embed focuses the note for
 * keyboard activation, and on touch leaves focus alone for a pointer one.
 */
export function openFeedback({ keyboard = false }: { keyboard?: boolean } = {}) {
  const launcher = document.querySelector<HTMLButtonElement>(".fbx-launch");
  if (!launcher) {
    toast.error("Feedback isn't available right now");
    return;
  }
  // The embed reads `detail === 0` as keyboard activation (focus the note);
  // a pointer-style click (detail 1) on touch must not pop the on-screen
  // keyboard over the page.
  launcher.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: keyboard ? 0 : 1 }));
}

/**
 * Nothing typed or attached yet. Like the app's dialogs, an outside click
 * only dismisses an empty form; a draft is never thrown away by a stray
 * click (Escape and the close button still discard it on purpose).
 */
function isPristine(root: HTMLElement): boolean {
  const note = root.querySelector<HTMLTextAreaElement>("#fbx-note");
  const mail = root.querySelector<HTMLInputElement>("#fbx-mail");
  const attached = root.querySelector(".fbx-preview, .fbx-rec");
  return !note?.value.trim() && !mail?.value.trim() && !attached;
}

/**
 * Close the open panel when a press lands outside every FeedbackBee element
 * (the panel, its capture/review layers, the recording bar: all carry the
 * `fbx` class). While the panel is stepped away for a screenshot or a
 * recording, presses belong to that flow and are ignored.
 */
export function installFeedbackDismiss(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const root = panel();
    if (!root?.classList.contains("fbx-open") || root.classList.contains("fbx-away")) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".fbx")) return;
    if (!isPristine(root)) return;
    root
      .querySelector<HTMLButtonElement>(".fbx-close")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  return () => document.removeEventListener("pointerdown", onPointerDown, true);
}

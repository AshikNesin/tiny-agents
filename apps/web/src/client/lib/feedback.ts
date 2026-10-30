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

/** Names for the embed's icon-only feedback-type radios, which ship without one. */
const KIND_LABELS: Record<string, string> = {
  "fbx-kind-issue": "Report an issue",
  "fbx-kind-feature_request": "Request a feature",
  "fbx-kind-other": "Something else",
};

/** Give the embed's unlabeled controls accessible names whenever it renders them. */
export function labelFeedbackControls(root: ParentNode = document): void {
  for (const [id, label] of Object.entries(KIND_LABELS)) {
    const button = root.querySelector<HTMLElement>(`#${id}`);
    if (button && !button.getAttribute("aria-label")) button.setAttribute("aria-label", label);
  }
}

export function installFeedbackLabels(): () => void {
  labelFeedbackControls();
  // Streaming chat mutates the DOM constantly: label at most once a frame.
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      labelFeedbackControls();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

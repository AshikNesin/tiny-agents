/**
 * FeedbackBee bridge. The embed (index.html) runs headless: no floating
 * launcher, and its panel opens as its own centered modal. "Send feedback"
 * in the sidebar's account menu opens it through the embed's API.
 */
import { toast } from "sonner";

interface FeedbackBeeApi {
  version?: string;
  open: (options?: Record<string, unknown>) => Promise<unknown>;
}

declare global {
  interface Window {
    FeedbackBee?: FeedbackBeeApi;
  }
}

export function openFeedback() {
  const feedbackBee = window.FeedbackBee;
  // `version` is set once the embed has loaded; without it there is no panel.
  if (!feedbackBee?.version) {
    toast.error("Feedback isn't available right now");
    return;
  }
  feedbackBee.open().catch(() => toast.error("Feedback isn't available right now"));
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

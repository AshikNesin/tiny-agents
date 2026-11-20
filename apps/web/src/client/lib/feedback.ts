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
  if (!feedbackBee?.version) {
    toast.error("Feedback isn't available right now");
    return;
  }
  feedbackBee.open().catch(() => toast.error("Feedback isn't available right now"));
}

const KIND_LABELS: Record<string, string> = {
  "fbx-kind-issue": "Report an issue",
  "fbx-kind-feature_request": "Request a feature",
  "fbx-kind-other": "Something else",
};

export function labelFeedbackControls(root: ParentNode = document): void {
  for (const [id, label] of Object.entries(KIND_LABELS)) {
    const button = root.querySelector<HTMLElement>(`#${id}`);
    if (button && !button.getAttribute("aria-label")) button.setAttribute("aria-label", label);
  }
}

export function installFeedbackLabels(): () => void {
  labelFeedbackControls();
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

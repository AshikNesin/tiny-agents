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

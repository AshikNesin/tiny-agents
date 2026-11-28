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
    toast.error(FEEDBACK_UNAVAILABLE);
    return;
  }
  feedbackBee.open().catch(sayFeedbackUnavailable);
}

const FEEDBACK_UNAVAILABLE = "Feedback isn't available right now";

function sayFeedbackUnavailable(error: unknown): void {
  console.error("The feedback widget failed to open", error);
  toast.error(FEEDBACK_UNAVAILABLE);
}

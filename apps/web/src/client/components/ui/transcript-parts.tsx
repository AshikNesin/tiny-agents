import { ThinkingIndicator } from "../fluid/thinking-indicator";

export const USER_PILL =
  "bg-bubble-user text-bubble-user-foreground min-w-0 max-w-full rounded-2xl px-3.5 py-2 text-[15px] leading-[22.5px] wrap-break-word text-pretty";

export const OTHER_PILL =
  "bg-bubble min-w-0 max-w-full rounded-2xl px-3.5 py-2 text-[15px] leading-[22.5px] wrap-break-word text-pretty";

const WORKING_WORDS = ["Thinking", "Working", "Planning", "Refining"] as const;
const REPLYING_WORDS = ["Replying"] as const;

export function TypingIndicator({ label = "thinking" }: { label?: string }) {
  return (
    <ThinkingIndicator
      aria-label={`${label}…`}
      label={`${label}…`}
      words={label === "replying" ? REPLYING_WORDS : WORKING_WORDS}
      data-testid="typing-indicator"
      className="h-9 px-1 py-0"
    />
  );
}

/**
 * Pieces every transcript draws the same way: the bots' chats and the Code
 * page's threads.
 */
import { ThinkingIndicator } from "../fluid/thinking-indicator";

/** The owner's bubble: Fluid ChatMessage's soft accent tint (tokens in app.css). */
export const USER_PILL =
  "bg-bubble-user text-bubble-user-foreground min-w-0 max-w-full rounded-2xl px-3.5 py-2 text-[15px] leading-[22.5px] wrap-break-word text-pretty";

/** Someone else's message in a shared chat: the reply bubble's surface, on the left. */
export const OTHER_PILL =
  "bg-bubble min-w-0 max-w-full rounded-2xl px-3.5 py-2 text-[15px] leading-[22.5px] wrap-break-word text-pretty";

const WORKING_WORDS = ["Thinking", "Working", "Planning", "Refining"] as const;
const REPLYING_WORDS = ["Replying"] as const;

/**
 * The bot is working but has nothing to show yet (waiting on the first token,
 * or between tool rounds): Fluid Functionalism's ThinkingIndicator, a glyph
 * morphing circle ⇄ infinity beside a shimmering status word.
 */
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

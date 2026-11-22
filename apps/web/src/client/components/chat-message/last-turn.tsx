import { createContext, useContext } from "react";
import { Pencil, RotateCcw } from "lucide-react";

export interface LastTurnActions {
  at: string;
  edit(): void;
  retry(): void;
}

export const LastTurnContext = createContext<LastTurnActions | null>(null);

const ACTION =
  "text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-full";

export function LastTurnButtons({ messageId }: { messageId: string }) {
  const turn = useContext(LastTurnContext);
  if (!turn || turn.at !== messageId) return null;
  return (
    <>
      <button
        type="button"
        className={ACTION}
        aria-label="Edit this message"
        title="Edit (e)"
        onClick={turn.edit}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        className={ACTION}
        aria-label="Run this again"
        title="Run again (t)"
        onClick={turn.retry}
      >
        <RotateCcw className="size-3.5" />
      </button>
    </>
  );
}

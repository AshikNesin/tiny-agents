import { useEffect, useState } from "react";
import { codeApi } from "../../lib/code/api";
import { useResource } from "../../queries/resource";

export interface LastTurn {
  user: string;
  agent: string;
}

const ASK_AFTER_MS = 700;
const MIN_TYPED = 3;
const MAX_TYPED = 200;

function continues(suggestion: string | null, text: string): suggestion is string {
  return (
    suggestion !== null &&
    text.length < suggestion.length &&
    suggestion.toLowerCase().startsWith(text.toLowerCase())
  );
}

export function useNextMessage(
  threadId: string | undefined,
  turn: LastTurn | null,
  text: string,
): { ghost: string; full: string | null } {
  const [asked, setAsked] = useState<{ agent: string; typed: string } | null>(null);
  const [best, setBest] = useState<{ agent: string; text: string } | null>(null);
  const agent = turn?.agent ?? null;
  const current = best && best.agent === agent ? best.text : null;

  useEffect(() => {
    if (agent === null) return;
    const typed = text.trimStart();
    if (typed.includes("\n") || typed.length > MAX_TYPED || continues(current, text)) return;
    if (typed.length === 0) {
      setAsked((was) => (was?.agent === agent && was.typed === "" ? was : { agent, typed: "" }));
      return;
    }
    if (typed.length < MIN_TYPED) return;
    const timer = setTimeout(() => setAsked({ agent, typed }), ASK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [agent, text, current]);

  const live = Boolean(threadId && turn && asked && asked.agent === agent);
  const answer = useResource(
    ["code", "next-message", threadId, agent, asked?.typed ?? null],
    () =>
      codeApi.suggest(threadId!, { ...turn!, ...(asked!.typed ? { typed: asked!.typed } : {}) }),
    "No suggestion.",
    { enabled: live },
  );
  const answered =
    answer.status === "ready" ? answer.data : answer.status === "failed" ? answer.last : undefined;
  const suggestion = live ? (answered?.suggestion ?? null) : null;
  useEffect(() => {
    if (suggestion && agent !== null) setBest({ agent, text: suggestion });
  }, [suggestion, agent]);

  if (text.includes("\n") || !continues(current, text)) return { ghost: "", full: null };
  return { ghost: current.slice(text.length), full: current };
}

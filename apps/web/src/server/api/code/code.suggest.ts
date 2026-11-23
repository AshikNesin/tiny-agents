import { createHash } from "node:crypto";
import { app } from "../../app-root";

const SUGGEST_TIMEOUT_MS = 5_000;
const AGENT_CHARS = 900;
const USER_CHARS = 300;
const TYPED_CHARS = 200;
const REPLY_CHARS = 120;
const REMEMBERED = 200;

const SYSTEM = [
  "You predict the next short message a developer sends to their coding agent.",
  "Reply with that message only: one line, at most 12 words, no quotes, no explanation.",
  "Prefer the obvious next step the agent offered or that the work needs,",
  "such as get it merged to main, run the tests, or fix the failing check.",
  "If the developer already started typing, reply with their whole message, starting with",
  "exactly what they typed.",
].join("\n");

export interface SuggestInput {
  user: string;
  agent: string;
  typed?: string;
}

const tail = (text: string, chars: number) =>
  text.length > chars ? `…${text.slice(-chars)}` : text;

function oneLine(raw: string): string | null {
  const first = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return null;
  const text = first
    .replace(/^(message|reply|next)\s*:\s*/i, "")
    .replace(/^["'“”`]+|["'“”`]+$/g, "")
    .trim()
    .slice(0, REPLY_CHARS);
  return text.length >= 2 ? text : null;
}

function remember(key: string, value: string | null) {
  const cache = app().codeSuggestions;
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > REMEMBERED) cache.delete(cache.keys().next().value!);
}

export async function suggestNext(threadId: string, input: SuggestInput): Promise<string | null> {
  const namer = app().codeBranchNamer;
  if (!namer) return null;
  const typed = (input.typed ?? "").trimStart().slice(0, TYPED_CHARS);
  const agent = tail(input.agent.trim(), AGENT_CHARS);
  const user = tail(input.user.trim(), USER_CHARS);
  const key = createHash("sha256").update([threadId, user, agent, typed].join("\0")).digest("hex");
  const cache = app().codeSuggestions;
  if (cache.has(key)) return cache.get(key) ?? null;
  const answer = await namer.sideCaller.complete({
    role: "chat_title",
    system: SYSTEM,
    user: [
      `Developer: ${user}`,
      `Agent: ${agent}`,
      ...(typed ? [`Developer is typing: ${typed}`] : []),
    ].join("\n"),
    timeoutMs: SUGGEST_TIMEOUT_MS,
    label: "Code composer suggestion",
  });
  if (answer === undefined) return null;
  const line = oneLine(answer);
  const suggestion =
    line &&
    (!typed || (line.toLowerCase().startsWith(typed.toLowerCase()) && line.length > typed.length))
      ? typed + line.slice(typed.length)
      : null;
  remember(key, suggestion);
  return suggestion;
}

/**
 * Which bots' chats are open right now: one count per bot of live follows of
 * its chat (`followBotChat`, bots.stream.ts, behind `/bots/:id/stream`).
 * Notifications about a run ending skip a bot whose chat the owner is
 * watching.
 */
import { app } from "../../app-root";

/** Count one open chat stream for `botId` (`app().botViewers`); returns the (idempotent) release. */
export function watchBot(botId: string): () => void {
  const viewers = app().botViewers;
  viewers.set(botId, (viewers.get(botId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (viewers.get(botId) ?? 1) - 1;
    if (left > 0) viewers.set(botId, left);
    else viewers.delete(botId);
  };
}

export function isBotWatched(botId: string): boolean {
  return (app().botViewers.get(botId) ?? 0) > 0;
}

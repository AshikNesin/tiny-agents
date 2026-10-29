/**
 * Which bots' chats are open right now: one count per bot of live
 * `/bots/:id/stream` connections. Notifications about a run ending skip a bot
 * whose chat the owner is watching.
 */
const viewers = new Map<string, number>();

/** Count one open chat stream for `botId`; returns the (idempotent) release. */
export function watchBot(botId: string): () => void {
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
  return (viewers.get(botId) ?? 0) > 0;
}

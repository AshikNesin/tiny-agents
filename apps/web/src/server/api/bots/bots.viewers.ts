import { app } from "../../app-root";

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

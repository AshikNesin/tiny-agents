/**
 * A fake `lib/sse` for component tests: it records every stream the app
 * opens, so a test plays the server's side of a bot's chat stream.
 *
 *   vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);
 *   render(<ChatPane … />);
 *   botStream("host").send({ type: "snapshot", state: { … } });
 */
import { act } from "@testing-library/react";
import type { BotStreamEvent } from "../../../apps/web/src/client/lib/chat-types";

interface OpenStream {
  onEvent(event: unknown): void;
  onOpen?(): void;
  onDrop?(): void;
}

const open = new Map<string, OpenStream>();
/** Every path opened, in order (reconnects included). */
export const openedPaths: string[] = [];

export const sseModule = {
  subscribeSse(
    path: string,
    onEvent: (event: unknown) => void,
    opts: { onOpen?: () => void; onDrop?: () => void } = {},
  ) {
    const stream: OpenStream = { onEvent, ...opts };
    open.set(path, stream);
    openedPaths.push(path);
    return {
      close() {
        if (open.get(path) === stream) open.delete(path);
      },
    };
  },
};

/** The server's side of one bot's chat stream. */
export function botStream(botId: string) {
  const path = `/api/v1/bots/${botId}/stream`;
  const current = () => {
    const stream = open.get(path);
    if (!stream) throw new Error(`No open stream for bot ${botId}`);
    return stream;
  };
  return {
    get isOpen() {
      return open.has(path);
    },
    /** The stream (re)opens and carries `events`, in order. */
    send(...events: BotStreamEvent[]) {
      act(() => {
        const stream = current();
        stream.onOpen?.();
        for (const event of events) stream.onEvent(event);
      });
    },
  };
}

/** The server's side of any stream, by the path the app opened. */
export function streamAt(path: string) {
  return {
    get isOpen() {
      return open.has(path);
    },
    send(...events: unknown[]) {
      act(() => {
        const stream = open.get(path);
        if (!stream) throw new Error(`No open stream at ${path}`);
        for (const event of events) stream.onEvent(event);
      });
    },
    drop() {
      act(() => open.get(path)?.onDrop?.());
    },
  };
}

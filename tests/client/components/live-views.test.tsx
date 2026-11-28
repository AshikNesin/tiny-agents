/**
 * @vitest-environment jsdom
 *
 * The chat's live views (`chat-pane/live-views.tsx`): a bot using its
 * browser or computer never opens the view on its own; it only lights the
 * header toggle. The owner's docked or picture-in-picture choice is
 * remembered across chats and reloads.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useLiveViews } from "@/components/chat-pane/live-views";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { ComputerStatus } from "../../../apps/web/src/shared/api/live";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const bot = { id: "b1", name: "Surfer", conversationId: "c1" } as unknown as Bot;

function turn(name: string, status: ChatToolCall["status"]): ChatMessage {
  return {
    id: `${name}-${status}`,
    role: "assistant",
    text: "",
    status: "streaming",
    createdAt: 0,
    toolCalls: [{ id: "t1", name, args: {}, status }],
  };
}

const views = (messages: ChatMessage[]) =>
  renderHook((props: { messages: ChatMessage[] }) => useLiveViews(bot, props.messages), {
    initialProps: { messages },
    wrapper: AppQueryProvider,
  });

beforeEach(() => {
  window.localStorage.clear();
  fakeApi().get("/bots/b1/computer", (): ComputerStatus => ({
    configured: true,
    setupHint: null,
    active: false,
    profile: "shared",
    driver: null,
    width: 1280,
    height: 800,
    takeover: null,
    starting: false,
    phase: null,
    error: null,
  }));
});

describe("useLiveViews", () => {
  it("leaves the browser closed when the bot starts browsing, and lights the toggle", async () => {
    const { result, rerender } = views([]);
    rerender({ messages: [turn("browser_navigate", "running")] });
    await waitFor(() => expect(result.current.hasComputer).toBe(true));
    expect(result.current.showBrowser).toBe(false);
    expect(result.current.liveShown).toBe(false);
    expect(result.current.liveBusy).toBe(true);
    expect(result.current.liveLabel).toBe("Open live view, Surfer is using the browser");
  });

  it("leaves the computer closed when the bot asks for a takeover", async () => {
    const { result } = views([turn("computer_request_takeover", "awaiting_takeover")]);
    await waitFor(() => expect(result.current.hasComputer).toBe(true));
    expect(result.current.showComputer).toBe(false);
    expect(result.current.liveBusy).toBe(true);

    act(() => result.current.toggleLive());
    expect(result.current.showComputer).toBe(true);
  });

  it("starts docked and remembers picture in picture across a remount", () => {
    const first = views([]);
    expect(first.result.current.layout).toBe("docked");
    act(() => first.result.current.setLayout("pip"));
    expect(first.result.current.layout).toBe("pip");
    first.unmount();

    expect(views([]).result.current.layout).toBe("pip");
  });

  it("opens the computer docked from the transcript's Open computer, to drive it", () => {
    const { result } = views([]);
    act(() => result.current.setLayout("pip"));
    act(() => {
      window.dispatchEvent(new Event("tiny-agents:show-computer"));
    });
    expect(result.current.showComputer).toBe(true);
    expect(result.current.layout).toBe("docked");
  });
});

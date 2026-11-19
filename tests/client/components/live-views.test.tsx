/**
 * @vitest-environment jsdom
 *
 * The chat's live views (`chat-pane/live-views.tsx`): a bot using its
 * browser or computer never opens the view on its own; it only lights the
 * header toggle. The owner's docked or picture-in-picture choice is
 * remembered across chats and reloads.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useLiveViews } from "@/components/chat-pane/live-views";
import { botsApi } from "@/lib/bots-api";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";
import type { Bot } from "../../../apps/web/src/shared/api/bots";

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
  });

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(botsApi, "computerStatus").mockResolvedValue({ configured: true } as never);
});
afterEach(() => vi.restoreAllMocks());

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

    // The toggle opens what the bot is using.
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

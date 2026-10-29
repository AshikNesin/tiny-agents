/**
 * @vitest-environment jsdom
 *
 * The Browser panel's auto-open (friction #37 follow-up): it opens the first
 * time the bot drives its browser in a conversation, and an explicit close
 * by the owner keeps it closed for that conversation, across later browser
 * calls, remounts and reloads. A new conversation starts fresh.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  BROWSER_DISMISSED_KEY,
  browserInUse,
  isBrowserDismissed,
  resetBrowserDismissals,
  useBrowserPanel,
} from "@/lib/browser-panel";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";

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

const panel = (conversationId: string, inUse: boolean) =>
  renderHook(
    (props: { conversationId: string; inUse: boolean }) =>
      useBrowserPanel(props.conversationId, props.inUse),
    { initialProps: { conversationId, inUse } },
  );

beforeEach(() => resetBrowserDismissals());

describe("browserInUse", () => {
  it("is true only while a browser tool runs", () => {
    expect(browserInUse([turn("browser_snapshot", "running")])).toBe(true);
    expect(browserInUse([turn("browser_snapshot", "done")])).toBe(false);
    expect(browserInUse([turn("web_fetch", "running")])).toBe(false);
  });
});

describe("useBrowserPanel", () => {
  it("opens itself when the bot starts browsing", () => {
    const { result, rerender } = panel("c1", false);
    expect(result.current.open).toBe(false);
    rerender({ conversationId: "c1", inUse: true });
    expect(result.current.open).toBe(true);
  });

  it("stays closed after the owner closes it, for every later browser call", () => {
    const { result, rerender } = panel("c1", true);
    expect(result.current.open).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);

    // The same run's next call, and the next run's.
    rerender({ conversationId: "c1", inUse: false });
    rerender({ conversationId: "c1", inUse: true });
    expect(result.current.open).toBe(false);
  });

  it("treats closing from the header toggle as a dismissal too", () => {
    const { result, rerender } = panel("c1", true);
    act(() => result.current.toggle());
    rerender({ conversationId: "c1", inUse: false });
    rerender({ conversationId: "c1", inUse: true });
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
  });

  it("remembers the dismissal across a remount and in sessionStorage", () => {
    const first = panel("c1", true);
    act(() => first.result.current.close());
    first.unmount();
    expect(JSON.parse(sessionStorage.getItem(BROWSER_DISMISSED_KEY) ?? "[]")).toEqual(["c1"]);

    const again = panel("c1", true);
    expect(again.result.current.open).toBe(false);
  });

  it("opens again in a new conversation", () => {
    const { result, rerender } = panel("c1", true);
    act(() => result.current.close());
    rerender({ conversationId: "c2", inUse: true });
    expect(result.current.open).toBe(true);
    expect(isBrowserDismissed("c2")).toBe(false);
  });
});

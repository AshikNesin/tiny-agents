import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useLiveChanges } from "@/lib/code/use-live-changes";
import { streamAt } from "../fakes/sse";

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const path = "/api/v1/code/threads/claude-code%3At1/changes?cwd=%2Fr";

describe("useLiveChanges", () => {
  it("follows pushed versions and falls back when it cannot watch", () => {
    const { result } = renderHook(() => useLiveChanges("claude-code:t1", "/r", true));
    expect(result.current).toBeNull();

    streamAt(path).send({ type: "changes", version: 0 }, { type: "changes", version: 3 });
    expect(result.current).toBe(3);

    streamAt(path).send({ type: "unavailable", message: "Cannot reach the sandbox" });
    expect(result.current).toBeNull();

    streamAt(path).send({ type: "changes", version: 4 });
    streamAt(path).drop();
    expect(result.current).toBeNull();
  });

  it("opens no stream while the panel is closed, and closes it when the panel closes", () => {
    const { rerender } = renderHook(({ open }) => useLiveChanges("claude-code:t1", "/r", open), {
      initialProps: { open: false },
    });
    expect(streamAt(path).isOpen).toBe(false);
    rerender({ open: true });
    expect(streamAt(path).isOpen).toBe(true);
    rerender({ open: false });
    expect(streamAt(path).isOpen).toBe(false);
  });
});

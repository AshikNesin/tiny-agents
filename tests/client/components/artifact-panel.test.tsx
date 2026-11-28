/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ToolRow } from "@/components/chat-message/ToolRow";
import { ArtifactPanel } from "@/components/artifacts/ArtifactPanel";
import { NO_TOOL_LABELS } from "@/lib/tool-call-text";
import { useArtifactPanel } from "@/store/artifacts";
import type { ChatToolCall } from "@/lib/chat-types";
import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactVersion,
} from "../../../apps/web/src/shared/api/artifacts";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";
import { FIXED_NOW } from "../../test-clock";

const at = new Date(FIXED_NOW).toISOString();

function detail(kind: ArtifactKind, headSeq: number): ArtifactDetail {
  return {
    id: "art1",
    botId: "b1",
    slug: "landing",
    title: "Landing page",
    kind,
    language: null,
    headSeq,
    createdAt: at,
    updatedAt: at,
    versions: Array.from({ length: headSeq }, (_, i) => ({
      seq: headSeq - i,
      op: headSeq - i === 1 ? ("create" as const) : ("rewrite" as const),
      title: "Landing page",
      author: "bot" as const,
      createdAt: at,
    })),
  };
}

function call(kind: ArtifactKind, seq: number): ChatToolCall {
  return {
    id: "t1",
    name: "create_artifact",
    args: {},
    status: "done",
    artifact: { id: "art1", slug: "landing", title: "Landing page", kind, seq },
  };
}

function renderChat(kind: ArtifactKind, seq: number, owner = true) {
  return render(
    <AppQueryProvider>
      <ToolRow call={call(kind, seq)} labels={NO_TOOL_LABELS} botName="Helper" />
      <ArtifactPanel botId="b1" owner={owner} />
    </AppQueryProvider>,
  );
}

afterEach(() => {
  cleanup();
  useArtifactPanel.setState({ open: null });
});

describe("artifact card and panel", () => {
  it("opens an HTML artifact only inside the sandboxed frame", async () => {
    const api = fakeApi();
    api.get("/bots/:id/artifacts/:artifactId", () => detail("html", 1));
    api.get("/bots/:id/artifacts/:artifactId/versions/:seq", (): ArtifactVersion => ({
      seq: 1,
      op: "create",
      title: "Landing page",
      content: "<h1>Hello from the page</h1><script>parent.document.title='x'</script>",
      createdAt: at,
    }));
    renderChat("html", 1);

    expect(screen.getByTestId("artifact-card").textContent).toContain("Landing page");
    await userEvent.click(screen.getByRole("button", { name: /open/i }));

    const frame = await screen.findByTestId("artifact-frame");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toBe("/api/v1/artifact-frame");
    expect(document.body.textContent).not.toContain("Hello from the page");
  });

  it("shows an old version and lets the owner restore it as the newest", async () => {
    const api = fakeApi();
    let head = 2;
    api.get("/bots/:id/artifacts/:artifactId", () => detail("markdown", head));
    api.get("/bots/:id/artifacts/:artifactId/versions/:seq", ({ params }): ArtifactVersion => ({
      seq: Number(params.seq),
      op: "create",
      title: "Landing page",
      content: Number(params.seq) === 1 ? "First **draft**" : "Second **draft**",
      createdAt: at,
    }));
    api.post("/bots/:id/artifacts/:artifactId/restore", () => {
      head = 3;
      return detail("markdown", 3);
    });
    renderChat("markdown", 1);

    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByText("First")).toBeTruthy();
    expect(screen.getByText(/Viewing version 1 of 2/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Restore as latest" }));
    await waitFor(() =>
      expect(useArtifactPanel.getState().open).toEqual({ artifactId: "art1", seq: 3 }),
    );
    expect(api.sent("POST", "/bots/b1/artifacts/art1/restore")[0]?.body).toEqual({ seq: 1 });
    await waitFor(() => expect(screen.queryByText(/Viewing version/)).toBeNull());
  });

  it("does not offer restore to a guest", async () => {
    const api = fakeApi();
    api.get("/bots/:id/artifacts/:artifactId", () => detail("markdown", 2));
    api.get("/bots/:id/artifacts/:artifactId/versions/:seq", (): ArtifactVersion => ({
      seq: 1,
      op: "create",
      title: "Landing page",
      content: "First draft",
      createdAt: at,
    }));
    renderChat("markdown", 1, false);

    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByText("First draft")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore as latest" })).toBeNull();
  });
});

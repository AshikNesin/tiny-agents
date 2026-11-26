/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChatWorkspace } from "@/pages/chats/ChatsLayout";
import { useBotsStore } from "@/store/bots";
import type { BotListEntry } from "../../../apps/web/src/shared/api/bots";

function bot(id: string, name: string, projectId: string | null): BotListEntry {
  return {
    id,
    conversationId: id,
    name,
    description: "",
    modelId: "m",
    lastMessagePreview: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    lastReadAt: null,
    unread: false,
    replying: false,
    approvals: 0,
    questions: 0,
    pinnedAt: null,
    projectId,
  };
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chats" element={<ChatWorkspace />} />
        <Route path="/chats/:botId" element={<ChatWorkspace />} />
        <Route path="/code/p/:chatProjectId" element={<p>Project chat page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Project chats in Chat", () => {
  it("are left out of the chat bot list", () => {
    useBotsStore.setState({
      bots: [bot("b1", "Helper", null), bot("b2", "web-project", "p1")],
      loading: false,
    });
    renderAt("/chats");
    expect(screen.getByText("Helper")).toBeTruthy();
    expect(screen.queryByText("web-project")).toBeNull();
  });

  it("send their chat link to the project's chat in Code", () => {
    useBotsStore.setState({
      bots: [bot("b1", "Helper", null), bot("b2", "web-project", "p1")],
      loading: false,
    });
    renderAt("/chats/b2");
    expect(screen.getByText("Project chat page")).toBeTruthy();
  });
});

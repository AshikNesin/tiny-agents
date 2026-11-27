/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChatWorkspace } from "@/pages/chats/ChatsLayout";
import { useBotsStore } from "@/store/bots";
import { usePeopleStore } from "@/store/people";
import { AppQueryProvider } from "../query-provider";
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

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chats" element={<ChatWorkspace />} />
        <Route path="/chats/:botId" element={<ChatWorkspace />} />
        <Route path="/chats/:botId/history/:chatId" element={<ChatWorkspace />} />
        <Route path="/code/p/:chatProjectId" element={<p>Project chat page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
    { wrapper: AppQueryProvider },
  );
}

const seed = () =>
  useBotsStore.setState({
    bots: [bot("b1", "Helper", null), bot("b2", "web-project", "p1")],
    loading: false,
  });

describe("Project chats in Chat", () => {
  beforeEach(() => usePeopleStore.setState({ role: "owner" }));

  it("keep their past chats reachable at their history links", () => {
    seed();
    renderAt("/chats/b2/history/c1");
    expect(screen.queryByText("Project chat page")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent("/chats/b2/history/c1");
  });

  it("stay in Chat for a guest the owner shared one with, since guests have no Code", () => {
    usePeopleStore.setState({ role: "guest" });
    seed();
    renderAt("/chats");
    expect(screen.getByText("web-project")).toBeTruthy();
    cleanup();
    renderAt("/chats/b2");
    expect(screen.queryByText("Project chat page")).toBeNull();
  });

  it("are left out of the chat bot list", () => {
    useBotsStore.setState({
      bots: [bot("b1", "Helper", null), bot("b2", "web-project", "p1")],
      loading: false,
    });
    renderAt("/chats");
    expect(screen.getByText("Helper")).toBeTruthy();
    expect(screen.queryByText("web-project")).toBeNull();
  });

  it("open at their chat link in Chat, without leaving for Code", () => {
    useBotsStore.setState({
      bots: [bot("b1", "Helper", null), bot("b2", "web-project", "p1")],
      loading: false,
    });
    renderAt("/chats/b2");
    expect(screen.queryByText("Project chat page")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent("/chats/b2");
  });
});

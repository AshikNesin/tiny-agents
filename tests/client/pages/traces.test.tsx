/**
 * Traces pages (issue #363): the list shows sessions with their model and
 * cost, and a session's page shows its totals and each call, failures in red.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { TraceDetailPage, TracesPage } from "@/pages/traces";
import type {
  TraceSession,
  TraceSessionDetail,
  TraceSessionList,
} from "../../../apps/web/src/shared/api/traces";
import { AppQueryProvider } from "../query-provider";

const session: TraceSession = {
  id: "7",
  kind: "routine",
  title: "Morning brief",
  bot: { id: "b1", name: "Helper" },
  startedAt: Date.now() - 60_000,
  lastAt: Date.now() - 30_000,
  harness: "pi",
  usage: {
    input: 2_000,
    output: 300,
    cacheRead: 8_000,
    cacheWrite: 0,
    costUsd: 0.0123,
    models: ["opus-5.5"],
  },
};

const detail: TraceSessionDetail = {
  session,
  trace: {
    usage: session.usage!,
    turns: [
      {
        at: session.startedAt,
        input: "Summarize the news",
        peer: false,
        steps: [
          {
            type: "llm",
            at: session.startedAt,
            durationMs: 3_200,
            harness: "pi",
            provider: "anthropic",
            model: "opus-5.5",
            stopReason: "toolUse",
            usage: { input: 1_000, output: 100, cacheRead: 4_000, cacheWrite: 0, costUsd: 0.006 },
            toolCalls: ["web_fetch"],
          },
          {
            type: "tool",
            at: session.startedAt + 3_300,
            durationMs: 850,
            name: "web_fetch",
            error: true,
          },
          {
            type: "llm",
            at: session.startedAt + 4_200,
            harness: "pi",
            provider: "anthropic",
            model: "opus-5.5",
            stopReason: "error",
            error: "Provider overloaded",
            toolCalls: [],
          },
        ],
        events: [
          { type: "prompt", at: session.startedAt, text: "Summarize the news", peer: false },
          { type: "thinking", at: session.startedAt, text: "Fetch the front page first." },
          { type: "response", at: session.startedAt, text: "Let me read the **front page**." },
          {
            type: "tool",
            at: session.startedAt,
            name: "web_fetch",
            input: { url: "https://news.example" },
            output: "403 Forbidden",
            error: true,
            durationMs: 850,
          },
          { type: "response", at: session.startedAt + 4_200, text: "Error: Provider overloaded" },
        ],
      },
    ],
  },
};

const list: TraceSessionList = { sessions: [session], next: null };

vi.mock("@/lib/traces-api", () => ({
  tracesApi: {
    summary: async () => ({ since: 0, sessions: 1, costUsd: 0.0123, tokens: 10_300, sideCalls: 2 }),
    sessions: async () => list,
    session: async () => detail,
    sideCalls: async () => ({ calls: [], next: null }),
  },
}));

function renderAt(path: string) {
  return render(
    <GrootUIProvider>
      <AppQueryProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/traces" element={<TracesPage />} />
            <Route path="/traces/:id" element={<TraceDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AppQueryProvider>
    </GrootUIProvider>,
  );
}

describe("Traces", () => {
  it("lists a session with its bot, kind, model and cost", async () => {
    renderAt("/traces");
    const row = await screen.findByTestId("trace-session");
    expect(row).toHaveTextContent("Morning brief");
    expect(row).toHaveTextContent("Helper · Routine · opus-5.5");
    expect(row).toHaveTextContent("$0.01");
    expect(row).toHaveAttribute("href", "/traces/7");
    expect(screen.getByTestId("traces-summary")).toHaveTextContent(
      "Last 7 days · $0.01 · 10.3K tokens · 1 session · 2 side-calls",
    );
  });

  it("shows the whole interaction: prompt, thought, reply and a tool's input and output", async () => {
    renderAt("/traces/7");
    expect(await screen.findByTestId("trace-prompt")).toHaveTextContent("Summarize the news");
    expect(screen.getAllByTestId("trace-response")[0]).toHaveTextContent(
      "Let me read the front page.",
    );
    // Totals: 8k of 10k input tokens were cache reads; two failures.
    expect(screen.getByTestId("trace-totals")).toHaveTextContent(
      "$0.01 · 10K in (80% cached) · 300 out · 2 model calls · 1 tool call · 2 failed",
    );

    const tool = screen.getByTestId("trace-tool");
    expect(tool).toHaveTextContent("web fetch “https://news.example”failed850 ms");
    fireEvent.click(within(tool).getByRole("button"));
    expect(within(tool).getByText('"url": "https://news.example"', { exact: false })).toBeVisible();
    expect(within(tool).getByText("403 Forbidden")).toHaveClass("text-destructive");

    fireEvent.click(within(screen.getByTestId("trace-thinking")).getByRole("button"));
    expect(screen.getByText("Fetch the front page first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open chat" })).toHaveAttribute("href", "/routines");
  });

  it("counts each kind of event and filters the transcript to the checked ones", async () => {
    renderAt("/traces/7");
    await screen.findByTestId("trace-prompt");
    const [filters] = screen.getAllByTestId("trace-filters");
    const row = (name: string) => within(filters!).getByText(name).closest("label")!;
    expect(row("Prompts")).toHaveTextContent("1");
    expect(row("Agent responses")).toHaveTextContent("2");
    expect(row("Thinking")).toHaveTextContent("1");
    expect(row("Tool calls")).toHaveTextContent("1");
    expect(row("Web fetch")).toHaveTextContent("1");
    expect(row("Compaction")).toHaveTextContent("0");

    fireEvent.click(within(row("Web fetch")).getByRole("checkbox"));
    expect(screen.getByTestId("trace-tool")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-prompt")).toBeNull();
    expect(screen.queryByTestId("trace-response")).toBeNull();

    fireEvent.click(within(row("Compaction")).getByRole("checkbox"));
    fireEvent.click(within(row("Web fetch")).getByRole("checkbox"));
    expect(screen.getByText("Nothing matches these filters.")).toBeInTheDocument();
  });
});

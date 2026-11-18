/**
 * Traces pages (issue #363): the list shows sessions with their model and
 * cost, and a session's page shows its totals and each call, failures in red.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
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

  it("shows a session's totals and each call, with failures marked", async () => {
    renderAt("/traces/7");
    const calls = await screen.findAllByTestId("trace-call");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveTextContent("5K in · 4K cached · 100 out");
    expect(calls[0]).toHaveTextContent("3.2 s");
    expect(calls[0]).toHaveTextContent("asked for 1 tool");
    expect(calls[1]).toHaveTextContent("usage not reported");
    expect(within(calls[1]!).getByText("Provider overloaded")).toHaveClass("text-destructive");
    expect(screen.getByTestId("trace-tool")).toHaveTextContent("web_fetchfailed850 ms");
    // 8k of 10k input tokens were cache reads; two failures (the tool and the errored call).
    expect(screen.getByText("80% cached")).toBeInTheDocument();
    expect(screen.getByText("Failed").parentElement).toHaveTextContent("Failed2");
    expect(screen.getByRole("link", { name: "Open chat" })).toHaveAttribute("href", "/routines");
  });
});

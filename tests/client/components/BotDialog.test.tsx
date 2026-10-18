import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { BotDialog } from "@/components/BotDialog";
import type { ModelInfo } from "@/lib/bots-api";

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    // Real wire shape: the route returns { capabilities } and the client
    // unwraps it — mock the unwrapped result here.
    capabilities: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
}));
vi.mock("@/lib/skills-api", () => ({
  skillsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/lib/connections-api", () => ({
  connectionsApi: { list: vi.fn().mockResolvedValue([]) },
}));

const models: ModelInfo[] = [
  {
    id: "test-model",
    name: "Test Model (faux)",
    family: "other",
    reasoning: true,
    contextWindow: 128000,
  },
];

describe("BotDialog", () => {
  it("opens without crashing", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <React.StrictMode>
        <QueryClientProvider client={qc}>
          <BrowserRouter>
            <BotDialog
              open
              onOpenChange={() => {}}
              models={models}
              defaultModelId="test-model"
              bot={null}
              onSaved={() => {}}
            />
          </BrowserRouter>
        </QueryClientProvider>
      </React.StrictMode>,
    );
    expect(screen.getByText("New bot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test Model (faux)" })).toBeTruthy();
    spy.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { BotDialog } from "@/components/BotDialog";
import type { Bot, ModelInfo } from "@/lib/bots-api";

const removeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    // Real wire shape: the route returns { capabilities } and the client
    // unwraps it — mock the unwrapped result here.
    capabilities: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    remove: (...args: unknown[]) => removeMock(...args),
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

  it("deletes an edited bot after an inline confirmation", async () => {
    const bot = {
      id: "b1",
      name: "Ada",
      description: "",
      systemPrompt: "",
      modelId: "test-model",
      toolPermissions: {},
      skillIds: [],
      connectionIds: [],
    } as unknown as Bot;
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <BotDialog
        open
        onOpenChange={onOpenChange}
        models={models}
        bot={bot}
        onSaved={() => {}}
        onDeleted={onDeleted}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete bot" }));
    expect(screen.getByText("Delete Ada? This cannot be undone.")).toBeTruthy();
    expect(removeMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete bot" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(bot));
    expect(removeMock).toHaveBeenCalledWith("b1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no delete while creating", () => {
    render(
      <BotDialog open onOpenChange={() => {}} models={models} bot={null} onSaved={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Delete bot" })).toBeNull();
  });
});

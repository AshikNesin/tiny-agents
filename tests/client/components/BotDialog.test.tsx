import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ApiError } from "@groot/shell/lib/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { BotDialog } from "@/components/BotDialog";
import type { Bot, ModelInfo } from "@/lib/bots-api";

const removeMock = vi.fn().mockResolvedValue(undefined);
const createMock = vi.fn();

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    // Real wire shape: the route returns { capabilities } and the client
    // unwraps it — mock the unwrapped result here.
    capabilities: vi.fn().mockResolvedValue([]),
    create: (...args: unknown[]) => createMock(...args),
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
    vision: false,
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
    // The Profile tab (phones) and the footer (wider screens) each offer it.
    const offers = screen.getAllByRole("button", { name: "Delete bot" });
    expect(offers).toHaveLength(2);
    await user.click(offers[1]);
    expect(screen.getByText("Delete Ada? This cannot be undone.")).toBeTruthy();
    expect(removeMock).not.toHaveBeenCalled();

    // The confirmation's button replaces the footer, after the Profile tab's.
    await user.click(screen.getAllByRole("button", { name: "Delete bot" }).at(-1)!);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(bot));
    expect(removeMock).toHaveBeenCalledWith("b1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the owner's edits when the model catalog arrives after the dialog opened", async () => {
    const { rerender } = render(
      <BotDialog open onOpenChange={() => {}} models={[]} bot={null} onSaved={() => {}} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Ada");
    // Nothing to save on yet: no model is known.
    expect(screen.getByRole("button", { name: /create bot/i })).toBeDisabled();

    // The catalog loads (a dialog opened right after start-up).
    rerender(
      <BotDialog
        open
        onOpenChange={() => {}}
        models={models}
        defaultModelId="test-model"
        bot={null}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Test Model (faux)" })).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /create bot/i })).toBeEnabled();
  });

  it("starts the form over only when it opens again", async () => {
    const { rerender } = render(
      <BotDialog
        open
        onOpenChange={() => {}}
        models={models}
        defaultModelId="test-model"
        bot={null}
        onSaved={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Ada");
    rerender(
      <BotDialog
        open={false}
        onOpenChange={() => {}}
        models={models}
        defaultModelId="test-model"
        bot={null}
        onSaved={() => {}}
      />,
    );
    rerender(
      <BotDialog
        open
        onOpenChange={() => {}}
        models={models}
        defaultModelId="test-model"
        bot={null}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("offers no delete while creating", () => {
    render(
      <BotDialog open onOpenChange={() => {}} models={models} bot={null} onSaved={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Delete bot" })).toBeNull();
  });

  it("shows a taken name under the Name field, in the server's words (issue #80)", async () => {
    const message = 'A bot named "Echo" already exists';
    createMock.mockRejectedValueOnce(
      new ApiError({ status: 409, code: "CONFLICT", message, url: "/bots" }),
    );
    const onOpenChange = vi.fn();
    render(
      <BotDialog
        open
        onOpenChange={onOpenChange}
        models={models}
        defaultModelId="test-model"
        bot={null}
        onSaved={() => {}}
      />,
    );
    const user = userEvent.setup();
    const name = screen.getByLabelText("Name");
    await user.type(name, " echo ");
    await user.click(screen.getByRole("button", { name: /create bot/i }));

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: "echo" }));
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Editing the name clears the error.
    await user.type(name, "2");
    expect(screen.queryByText(message)).toBeNull();
  });
});

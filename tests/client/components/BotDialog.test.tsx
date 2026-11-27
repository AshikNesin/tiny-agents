import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render as renderPlain, screen, waitFor } from "@testing-library/react";
import { AppQueryProvider } from "../query-provider";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { BotDialog } from "@/components/BotDialog";
import type {
  Bot,
  CapabilityList,
  ToolPermissionsData,
} from "../../../apps/web/src/shared/api/bots";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import type { GuestList } from "../../../apps/web/src/shared/api/people";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { ApiFailure, fakeApi } from "../fakes/api";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";

const render = (ui: React.ReactElement) => renderPlain(ui, { wrapper: AppQueryProvider });

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  api.get("/capabilities", (): CapabilityList => ({ capabilities: [] }));
  api.get("/tool-permissions", (): ToolPermissionsData => ({ permissions: {} }));
  api.get("/skills", (): Skill[] => []);
  api.get("/connections", (): Connection[] => []);
  api.get("/people", (): GuestList => ({ guests: [] }));
});

const models: CatalogModel[] = [
  {
    id: "test-model",
    name: "Test Model (faux)",
    providerId: "faux",
    providerName: "Faux",
    providerKind: "faux",
    upstreamId: "test-model",
    type: "chat",
    engine: "pi",
    maxOutputTokens: 16_384,
    enabled: true,
    available: true,
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
    api.delete("/bots/b1", () => undefined);
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
    const offers = screen.getAllByRole("button", { name: "Delete bot" });
    expect(offers).toHaveLength(2);
    await user.click(offers[1]);
    expect(screen.getByText("Delete Ada? This cannot be undone.")).toBeTruthy();
    expect(api.sent("DELETE", "/bots/b1")).toHaveLength(0);

    await user.click(screen.getAllByRole("button", { name: "Delete bot" }).at(-1)!);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(bot));
    expect(api.sent("DELETE", "/bots/b1")).toHaveLength(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the owner's edits when the model catalog arrives after the dialog opened", async () => {
    const { rerender } = render(
      <BotDialog open onOpenChange={() => {}} models={[]} bot={null} onSaved={() => {}} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Ada");
    expect(screen.getByRole("button", { name: /create bot/i })).toBeDisabled();

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
    api.post("/bots", () => {
      throw new ApiFailure(409, message, "CONFLICT");
    });
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
    expect(api.sent("POST", "/bots").map((request) => request.body)).toEqual([
      expect.objectContaining({ name: "echo" }),
    ]);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.type(name, "2");
    expect(screen.queryByText(message)).toBeNull();
  });
});

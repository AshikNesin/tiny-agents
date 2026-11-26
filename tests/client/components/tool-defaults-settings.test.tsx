/**
 * @vitest-environment jsdom
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GrootUIProvider } from "@groot/ui";
import { ToolDefaultsSettings } from "@/components/ToolDefaultsSettings";
import { AppQueryProvider } from "../query-provider";

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  toolPermissions: vi.fn(),
  setToolPermissions: vi.fn(),
}));

vi.mock("@/lib/bots-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/bots-api")>();
  return {
    ...original,
    botsApi: {
      ...original.botsApi,
      capabilities: (...args: unknown[]) => api.capabilities(...args),
      toolPermissions: (...args: unknown[]) => api.toolPermissions(...args),
      setToolPermissions: (...args: unknown[]) => api.setToolPermissions(...args),
    },
  };
});

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const user = userEvent.setup();

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("ToolDefaultsSettings", () => {
  it("shows the permissions every bot starts from and saves a change for all of them", async () => {
    api.capabilities.mockResolvedValue([
      {
        id: "tasks",
        kind: "toolkit",
        name: "Tasks",
        description: "Your tasks",
        tools: [
          { name: "add_task", label: "Added task", description: "Add a task" },
          { name: "delete_task", label: "Deleted task", description: "Delete a task" },
        ],
      },
    ]);
    api.toolPermissions.mockResolvedValue({ permissions: { add_task: "allow" } });
    api.setToolPermissions.mockImplementation(async (permissions: unknown) => ({ permissions }));
    render(
      <AppQueryProvider>
        <GrootUIProvider>
          <ToolDefaultsSettings />
        </GrootUIProvider>
      </AppQueryProvider>,
    );
    await settle();
    const add = await screen.findByRole("radiogroup", { name: "Added task permission" });
    expect(within(add).getByRole("radio", { name: "Allow" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    const remove = screen.getByRole("radiogroup", { name: "Deleted task permission" });
    await user.click(within(remove).getByRole("radio", { name: "Off" }));
    expect(api.setToolPermissions).toHaveBeenCalledWith({ add_task: "allow", delete_task: "off" });
    await settle();
    expect(
      within(screen.getByRole("radiogroup", { name: "Deleted task permission" }))
        .getByRole("radio", { name: "Off" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

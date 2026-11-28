/**
 * @vitest-environment jsdom
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { GrootUIProvider } from "@groot/ui";
import { ToolDefaultsSettings } from "@/components/ToolDefaultsSettings";
import type { CapabilityList, ToolPermissionsData } from "../../../apps/web/src/shared/api/bots";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

let api: ReturnType<typeof fakeApi>;

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const user = userEvent.setup();

beforeEach(() => {
  api = fakeApi();
});

describe("ToolDefaultsSettings", () => {
  it("shows the permissions every bot starts from and saves a change for all of them", async () => {
    const capabilities: CapabilityList = {
      capabilities: [
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
      ],
    };
    const stored: ToolPermissionsData = { permissions: { add_task: "allow" } };
    api.get("/capabilities", () => capabilities);
    api.get("/tool-permissions", () => stored);
    api.put("/tool-permissions", (request) => request.body);
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
    expect(api.sent("PUT", "/tool-permissions").map((request) => request.body)).toEqual([
      { permissions: { add_task: "allow", delete_task: "off" } },
    ]);
    await settle();
    expect(
      within(screen.getByRole("radiogroup", { name: "Deleted task permission" }))
        .getByRole("radio", { name: "Off" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

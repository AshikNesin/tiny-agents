import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { ConnectionToolDetail } from "@/pages/connections/ConnectionToolDetail";
import type {
  ConnectionToolDetail as ToolDetail,
  ToolCallResult,
} from "../../../apps/web/src/shared/api/connections";
import { ApiFailure, fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const TOOL = "/connections/c1/tools/save_file";
let api: ReturnType<typeof fakeApi>;
const calls = () => api.sent("POST", `${TOOL}/call`).map((request) => request.body);

function tool(partial: Partial<ToolDetail> = {}): ToolDetail {
  return {
    name: "mcp__upsy__save_file",
    serverName: "save_file",
    label: "Save a file",
    description: "Saves a file you produced.",
    readOnly: false,
    enabled: true,
    idempotent: false,
    destructive: false,
    openWorld: false,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name" },
        content: { type: "string" },
      },
      required: ["name"],
    },
    connection: { id: "c1", name: "Upsy", slug: "upsy", status: "connected" },
    ...partial,
  };
}

function mount() {
  return render(
    <React.StrictMode>
      <AppQueryProvider>
        <MemoryRouter>
          <GrootUIProvider>
            <ConnectionToolDetail id="c1" tool="save_file" />
          </GrootUIProvider>
        </MemoryRouter>
      </AppQueryProvider>
    </React.StrictMode>,
  );
}

describe("ConnectionToolDetail", () => {
  beforeEach(() => {
    api = fakeApi();
    api.get(TOOL, () => tool());
    api.patch(TOOL, () => tool({ enabled: false }));
    api.post(`${TOOL}/call`, (): ToolCallResult => ({
      result: { content: [{ type: "text", text: '{"saved":true}' }] },
      durationMs: 42,
    }));
  });

  it("shows the tool's schema and turns it off for bots", async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole("heading", { name: "Save a file" })).toBeTruthy();
    expect(screen.getByText("mcp__upsy__save_file")).toBeTruthy();
    expect(screen.getByText("may change data")).toBeTruthy();
    expect(screen.getAllByText("File name")).toHaveLength(2);

    await user.click(screen.getByRole("switch", { name: "Available to bots" }));
    await waitFor(() =>
      expect(api.sent("PATCH", TOOL).map((request) => request.body)).toEqual([{ enabled: false }]),
    );
    expect(await screen.findByText("Off for every bot")).toBeTruthy();
  });

  it("validates, confirms and runs the tool from the playground", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Save a file" });

    await user.click(screen.getByRole("button", { name: "Run tool" }));
    expect(await screen.findByText("Required")).toBeTruthy();
    expect(calls()).toEqual([]);

    await user.type(screen.getByLabelText(/^name/), "notes.md");
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await user.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(calls()).toEqual([{ arguments: { name: "notes.md" } }]));
    expect(await screen.findByText("Success")).toBeTruthy();
    expect(screen.getByText("42 ms")).toBeTruthy();
    expect(screen.getByText(/"saved": true/)).toBeTruthy();
  });

  it("runs a read-only tool without asking and shows call errors", async () => {
    api.get(TOOL, () => tool({ readOnly: true, inputSchema: { type: "object", properties: {} } }));
    api.post(`${TOOL}/call`, () => {
      throw new ApiFailure(502, "Call failed: boom");
    });
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Save a file" });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    expect(await screen.findByText("Call failed: boom")).toBeTruthy();
    expect(calls()).toEqual([{ arguments: {} }]);
  });
});

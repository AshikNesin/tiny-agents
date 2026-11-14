/**
 * The connection tool page: schema, the per-tool switch and the playground,
 * which asks before running a tool that may change data.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { ConnectionToolDetail } from "@/pages/connections/ConnectionToolDetail";
import type { ConnectionToolDetail as ToolDetail } from "../../../apps/web/src/shared/api/connections";

const getToolMock = vi.fn();
const updateToolMock = vi.fn();
const callToolMock = vi.fn();

vi.mock("@/lib/connections-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/connections-api")>();
  return {
    ...original,
    connectionsApi: {
      getTool: (...args: unknown[]) => getToolMock(...args),
      updateTool: (...args: unknown[]) => updateToolMock(...args),
      callTool: (...args: unknown[]) => callToolMock(...args),
    },
  };
});

vi.mock("@/lib/sse", () => ({
  subscribeSse: vi.fn(() => ({ close: () => undefined })),
}));

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
      <MemoryRouter>
        <GrootUIProvider>
          <ConnectionToolDetail id="c1" tool="save_file" />
        </GrootUIProvider>
      </MemoryRouter>
    </React.StrictMode>,
  );
}

describe("ConnectionToolDetail", () => {
  beforeEach(() => {
    getToolMock.mockReset().mockResolvedValue(tool());
    updateToolMock.mockReset().mockResolvedValue(tool({ enabled: false }));
    callToolMock.mockReset().mockResolvedValue({
      result: { content: [{ type: "text", text: '{"saved":true}' }] },
      durationMs: 42,
    });
  });

  it("shows the tool's schema and turns it off for bots", async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole("heading", { name: "Save a file" })).toBeTruthy();
    expect(screen.getByText("mcp__upsy__save_file")).toBeTruthy();
    expect(screen.getByText("may change data")).toBeTruthy();
    // Once in the input schema, once on the playground field.
    expect(screen.getAllByText("File name")).toHaveLength(2);

    await user.click(screen.getByRole("switch", { name: "Available to bots" }));
    await waitFor(() =>
      expect(updateToolMock).toHaveBeenCalledWith("c1", "save_file", { enabled: false }),
    );
    expect(await screen.findByText("Off for every bot")).toBeTruthy();
  });

  it("validates, confirms and runs the tool from the playground", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Save a file" });

    await user.click(screen.getByRole("button", { name: "Run tool" }));
    expect(await screen.findByText("Required")).toBeTruthy();
    expect(callToolMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^name/), "notes.md");
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    // Not read-only: asks before running for real.
    await user.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(callToolMock).toHaveBeenCalledWith("c1", "save_file", { name: "notes.md" }),
    );
    expect(await screen.findByText("Success")).toBeTruthy();
    expect(screen.getByText("42 ms")).toBeTruthy();
    expect(screen.getByText(/"saved": true/)).toBeTruthy();
  });

  it("runs a read-only tool without asking and shows call errors", async () => {
    getToolMock.mockResolvedValue(
      tool({ readOnly: true, inputSchema: { type: "object", properties: {} } }),
    );
    callToolMock.mockRejectedValue(new Error("Call failed: boom"));
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Save a file" });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    expect(await screen.findByText("Call failed: boom")).toBeTruthy();
    expect(callToolMock).toHaveBeenCalledWith("c1", "save_file", {});
  });
});

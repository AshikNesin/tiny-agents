/**
 * @vitest-environment jsdom
 *
 * Settings → Updates (docs/guides/local-updates.md): an unsupervised server
 * explains `pnpm local`; a supervised one shows the update, its commits and
 * the sandbox note, and "Update & restart" asks the supervisor.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { UpdatesSettings } from "@/components/UpdatesSettings";
import type { UpdateStatus, UpdateView } from "../../../apps/web/src/shared/local-updates";

const getMock = vi.fn<() => Promise<UpdateView>>();
const applyMock = vi.fn<() => Promise<UpdateView>>();

vi.mock("@/lib/updates-api", () => ({
  updatesApi: {
    get: () => getMock(),
    check: vi.fn(),
    apply: () => applyMock(),
  },
}));

const STATUS: UpdateStatus = {
  track: "origin/main",
  current: { sha: "1".repeat(40), version: "1.2.1", subject: "old commit", committedAt: 0 },
  latest: { sha: "2".repeat(40), version: "1.3.0", subject: "new commit", committedAt: 1 },
  commits: [{ sha: "2222222", subject: "new commit" }],
  sandboxChanged: true,
  phase: "idle",
  error: null,
  log: [],
  auto: false,
  lastCheckedAt: null,
};

beforeEach(() => {
  getMock.mockReset();
  applyMock.mockReset();
});

describe("UpdatesSettings", () => {
  it("explains pnpm local on a server it does not supervise", async () => {
    getMock.mockResolvedValue({ supervised: false, status: null });
    render(<UpdatesSettings />);
    expect(await screen.findByText(/cannot update itself/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Update & restart/ })).toBeNull();
  });

  it("shows the update and asks the supervisor to apply it", async () => {
    getMock.mockResolvedValue({ supervised: true, status: STATUS });
    applyMock.mockResolvedValue({ supervised: true, status: { ...STATUS, phase: "building" } });
    render(<UpdatesSettings />);

    expect(await screen.findByText("Available")).toBeTruthy();
    expect(screen.getByText("1 commit since the running version.")).toBeTruthy();
    expect(screen.getByText("The sandbox image changed")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Update & restart/ }));
    expect(applyMock).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: /Building…/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows a failed update with its build output", async () => {
    getMock.mockResolvedValue({
      supervised: true,
      status: {
        ...STATUS,
        phase: "failed",
        error: "Build failed",
        log: ["pnpm run build exited 1"],
      },
    });
    render(<UpdatesSettings />);
    expect(await screen.findByText("Build failed")).toBeTruthy();
    expect(screen.getByText("pnpm run build exited 1")).toBeTruthy();
  });
});

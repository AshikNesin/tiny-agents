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
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { UpdatesSettings } from "@/components/UpdatesSettings";
import { fakeApi } from "../fakes/api";
import type { UpdateStatus, UpdateView } from "../../../apps/web/src/shared/local-updates";

let api: ReturnType<typeof fakeApi>;

function serve(view: UpdateView) {
  api.get("/system/update", () => view);
}

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
  api = fakeApi();
});

describe("UpdatesSettings", () => {
  it("explains pnpm local on a server it does not supervise", async () => {
    serve({ supervised: false, status: null });
    render(<UpdatesSettings />);
    expect(await screen.findByText(/cannot update itself/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Update & restart/ })).toBeNull();
  });

  it("shows the update and asks the supervisor to apply it", async () => {
    serve({ supervised: true, status: STATUS });
    api.post("/system/update/apply", (): UpdateView => ({
      supervised: true,
      status: { ...STATUS, phase: "building" },
    }));
    render(<UpdatesSettings />);

    expect(await screen.findByText("Available")).toBeTruthy();
    expect(screen.getByText("1 commit since the running version.")).toBeTruthy();
    expect(screen.getByText("The sandbox image changed")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Update & restart/ }));
    expect(api.sent("POST", "/system/update/apply")).toHaveLength(1);
    expect(await screen.findByRole("button", { name: /Building…/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows a failed update with its build output", async () => {
    serve({
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

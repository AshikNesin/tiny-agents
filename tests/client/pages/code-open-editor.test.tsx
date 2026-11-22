import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { OpenInEditor } from "@/pages/code/OpenInEditor";
import type { HarnessInfo } from "@/lib/code/api";

const harness = (ssh: HarnessInfo["ssh"]): HarnessInfo => ({
  id: "shelley",
  kind: "shelley",
  label: "Shelley",
  status: { state: "connected" },
  capabilities: NO_CAPABILITIES,
  commands: [],
  ssh,
});

const path = "/home/exedev/code/acme--web/worktrees/ta_fix-login";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function stubNavigation() {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, hostname: "tiny-agents.exe.xyz", assign });
  return assign;
}

describe("Open in editor", () => {
  it("opens the worktree over SSH and remembers the editor and host", async () => {
    const assign = stubNavigation();
    const none = harness({ host: null, user: null, port: null, keyFile: null });
    const { unmount } = render(
      <OpenInEditor open onOpenChange={() => {}} harness={none} path={path} />,
    );

    expect(screen.getByLabelText("SSH host")).toHaveValue("tiny-agents.exe.xyz");
    await userEvent.click(screen.getByRole("radio", { name: "Zed" }));
    await userEvent.clear(screen.getByLabelText("SSH host"));
    await userEvent.type(screen.getByLabelText("SSH host"), "exedev@my-vm");
    await userEvent.click(screen.getByRole("button", { name: "Open in Zed" }));
    expect(assign).toHaveBeenCalledWith(
      "zed://ssh/exedev@my-vm/home/exedev/code/acme--web/worktrees/ta_fix-login",
    );
    unmount();

    render(<OpenInEditor open onOpenChange={() => {}} harness={none} path={path} />);
    expect(screen.getByRole("radio", { name: "Zed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("SSH host")).toHaveValue("exedev@my-vm");
  });

  it("shows the SSH config a local Docker sandbox needs", () => {
    stubNavigation();
    const docker = harness({
      host: null,
      user: "exedev",
      port: 2222,
      keyFile: "/w/data/sandbox/id_ed25519",
    });
    render(<OpenInEditor open onOpenChange={() => {}} harness={docker} path={path} />);
    expect(screen.getByLabelText("SSH host")).toHaveValue("tiny-agents-sandbox");
    expect(screen.getByTestId("code-editor-ssh-config")).toHaveTextContent(
      "Host tiny-agents-sandbox HostName tiny-agents.exe.xyz Port 2222",
    );
    expect(screen.getByRole("button", { name: "Open in Cursor" })).toBeEnabled();
  });
});

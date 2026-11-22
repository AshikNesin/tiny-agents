import { describe, expect, it } from "vite-plus/test";
import { editorUrl, sshConfig, suggestedHost } from "@/lib/code/editor";

const path = "/home/exedev/code/acme--web/worktrees/ta_fix-login";

describe("Open in editor", () => {
  it("builds Zed's and Cursor's SSH links for a folder", () => {
    expect(editorUrl("zed", "tiny-agents.exe.xyz", path)).toBe(
      "zed://ssh/tiny-agents.exe.xyz/home/exedev/code/acme--web/worktrees/ta_fix-login",
    );
    expect(editorUrl("cursor", "tiny-agents.exe.xyz", path)).toBe(
      "cursor://vscode-remote/ssh-remote+tiny-agents.exe.xyz/home/exedev/code/acme--web/worktrees/ta_fix-login?windowId=_blank",
    );
    expect(editorUrl("zed", " ssh://exedev@vm/ ", "/srv/my app")).toBe(
      "zed://ssh/exedev@vm/srv/my%20app",
    );
  });

  it("suggests the app's own host, or an SSH config alias for a port or key", () => {
    const none = { host: null, user: null, port: null, keyFile: null };
    expect(suggestedHost(none, "tiny-agents.exe.xyz")).toBe("tiny-agents.exe.xyz");
    expect(sshConfig(none, "tiny-agents.exe.xyz")).toBeNull();
    expect(suggestedHost({ ...none, host: "tiny-agents-vm", user: "exedev" }, "x")).toBe(
      "exedev@tiny-agents-vm",
    );

    const docker = {
      host: null,
      user: "exedev",
      port: 2222,
      keyFile: "/w/data/sandbox/id_ed25519",
    };
    expect(suggestedHost(docker, "localhost")).toBe("tiny-agents-sandbox");
    expect(sshConfig(docker, "localhost")).toBe(
      [
        "Host tiny-agents-sandbox",
        "  HostName localhost",
        "  Port 2222",
        "  User exedev",
        "  IdentityFile /w/data/sandbox/id_ed25519",
      ].join("\n"),
    );
  });
});

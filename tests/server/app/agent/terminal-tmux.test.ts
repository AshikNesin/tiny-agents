import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import {
  MAX_SESSIONS,
  allocateSessionName,
  attachCommand,
  foregroundCommand,
  hasSessionCommand,
  isBusy,
  killCommand,
  listCommand,
  loginShellCommand,
  newSessionCommand,
  parseSessionName,
  parseSessionList,
  sessionNumber,
  versionCommand,
  type SessionName,
  TERMINAL_SETTINGS,
} from "../../../../packages/sandbox/src/terminal/tmux";

const name = (n: number) => `ta-term-${n}` as SessionName;

describe("session names", () => {
  it("parses only ta-term-<digits>", () => {
    expect(parseSessionName("ta-term-1")).toBe("ta-term-1");
    expect(parseSessionName("ta-term-12")).toBe("ta-term-12");
    expect(parseSessionName("ta-term-0")).toBe("ta-term-0");
    expect(parseSessionName("work")).toBeUndefined();
    expect(parseSessionName("ta-term-x")).toBeUndefined();
    expect(parseSessionName("ta-term-")).toBeUndefined();
    expect(parseSessionName("ta-term-1x")).toBeUndefined();
    expect(parseSessionName("")).toBeUndefined();
  });

  it("extracts the number", () => {
    expect(sessionNumber(name(7))).toBe(7);
    expect(sessionNumber(name(12))).toBe(12);
  });
});

describe("command builders", () => {
  it("chains the version check into the listing", () => {
    expect(listCommand()).toBe(
      "LC_ALL=C.UTF-8 tmux -V && LC_ALL=C.UTF-8 tmux -L ta-terminal ls -F " +
        "'#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_current_command}'",
    );
  });

  it("prefixes every tmux invocation with a UTF-8 locale", () => {
    for (const command of [
      attachCommand(name(1)),
      killCommand(name(1)),
      hasSessionCommand(name(1)),
      foregroundCommand(name(1)),
      newSessionCommand(name(1), 120, 34),
    ]) {
      expect(command.startsWith("LC_ALL=C.UTF-8 tmux -L ta-terminal ")).toBe(true);
    }
  });

  it("creates a session and applies the settings in one command", () => {
    expect(newSessionCommand(name(3), 120, 34)).toBe(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal new-session -d -s ta-term-3 -x 120 -y 34" +
        TERMINAL_SETTINGS.map((setting) => ` \\; ${setting}`).join(""),
    );
  });

  it("refuses geometry that is not plain integers before it reaches the shell", () => {
    expect(() => newSessionCommand(name(1), "80; rm -rf /" as never, 24)).toThrow(
      "cols must be a whole number",
    );
    expect(() => newSessionCommand(name(1), 80, "24 && curl evil" as never)).toThrow(
      "rows must be a whole number",
    );
    expect(() => newSessionCommand(name(1), 80.5, 24)).toThrow("cols must be a whole number");
    expect(() => newSessionCommand(name(1), 0, 24)).toThrow("cols must be between 2 and 500");
    expect(() => newSessionCommand(name(1), 80, 9999)).toThrow("rows must be between 2 and 300");
  });

  it("re-applies the settings on attach and never detaches other viewers", () => {
    const command = attachCommand(name(5));
    expect(command).toBe(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal " +
        [...TERMINAL_SETTINGS, "attach-session -t ta-term-5"].join(" \\; "),
    );
    expect(command).not.toMatch(/attach-session -d/);
  });

  it("has the settings copy and colour depend on", () => {
    expect(TERMINAL_SETTINGS).toContain("set -s set-clipboard on");
    const features = TERMINAL_SETTINGS.find((s) => s.includes("terminal-features"));
    expect(features).toMatch(/terminal-features\[\d+\]/);
    expect(features).toMatch(/clipboard/);
    expect(features).toMatch(/RGB/);
    expect(TERMINAL_SETTINGS).toContain("set -g mouse on");
    expect(TERMINAL_SETTINGS).toContain("set -g window-size latest");
  });

  it("kills, checks existence, reads the foreground process", () => {
    expect(killCommand(name(2))).toBe(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal kill-session -t ta-term-2",
    );
    expect(hasSessionCommand(name(2))).toBe(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal has-session -t ta-term-2",
    );
    expect(foregroundCommand(name(2))).toBe(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal display-message -p -t ta-term-2 '#{pane_current_command}'",
    );
  });

  it("reads the login shell from the VM, not a hardcoded list", () => {
    expect(loginShellCommand()).toBe(`sh -c 'basename "$SHELL"'`);
  });

  it("exposes the version probe alone", () => {
    expect(versionCommand()).toBe("LC_ALL=C.UTF-8 tmux -V");
  });
});

describe("parseSessionList", () => {
  it("parses rows with real TAB separators and drops the version header", () => {
    const parsed = parseSessionList(
      "tmux 3.4\nta-term-1\t1792605227\t0\tbash\nta-term-2\t1792605300\t1\tvim\n",
      "",
      0,
    );
    expect(parsed).toEqual({
      kind: "ok",
      sessions: [
        { name: "ta-term-1", createdAt: 1792605227, attached: false, command: "bash" },
        { name: "ta-term-2", createdAt: 1792605300, attached: true, command: "vim" },
      ],
    });
  });

  it("keeps a session whose pane reported no command", () => {
    const parsed = parseSessionList("ta-term-1\t1792605227\t0\t\n", "", 0);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.sessions).toEqual([
      { name: "ta-term-1", createdAt: 1792605227, attached: false, command: null },
    ]);
  });

  it("treats a not-yet-started server (both phrasings) as an empty list", () => {
    expect(parseSessionList("", "no server running on /tmp/tmux-1000/ta-terminal\n", 1)).toEqual({
      kind: "ok",
      sessions: [],
    });
    expect(
      parseSessionList(
        "",
        "error connecting to /tmp/tmux-1000/ta-terminal (No such file or directory)\n",
        1,
      ),
    ).toEqual({ kind: "ok", sessions: [] });
  });

  it("recognizes a missing tmux (exit 127) or a shell that cannot find it", () => {
    expect(parseSessionList("", "tmux: not found\n", 127)).toEqual({ kind: "tmux-missing" });
    expect(parseSessionList("", "sh: 1: tmux: not found\n", 127)).toEqual({ kind: "tmux-missing" });
    expect(parseSessionList("", "bash: tmux: command not found\n", 127)).toEqual({
      kind: "tmux-missing",
    });
    expect(parseSessionList("", "sh: tmux: not found\n", 127)).toEqual({ kind: "tmux-missing" });
    expect(parseSessionList("", "127\nsh: tmux: Not Found\n", 127)).toEqual({
      kind: "tmux-missing",
    });
  });

  it("surfaces other failures with the stderr text", () => {
    expect(parseSessionList("", "lost server\n", 1)).toEqual({
      kind: "error",
      message: "lost server",
    });
    expect(parseSessionList("", "", 2)).toEqual({ kind: "error", message: "tmux ls exited 2" });
  });

  it("ignores foreign session names on the socket", () => {
    const parsed = parseSessionList("other\t1\t0\tbash\nta-term-1\t2\t0\tbash\n", "", 0);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.sessions.map((s) => s.name)).toEqual(["ta-term-1"]);
  });

  it("rejects malformed rows instead of guessing", () => {
    for (const stdout of ["ta-term-1\tNaN\t0\tbash\n", "ta-term-1\t123\n", "\t1\t0\tbash\n"]) {
      const parsed = parseSessionList(stdout, "", 0);
      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      expect(parsed.sessions).toEqual([]);
    }
  });
});

describe("allocateSessionName", () => {
  it("starts at 1 and fills holes with the lowest free number", () => {
    expect(allocateSessionName([])).toBe("ta-term-1");
    expect(allocateSessionName([name(1)])).toBe("ta-term-2");
    expect(allocateSessionName([name(1), name(3)])).toBe("ta-term-2");
    expect(allocateSessionName([name(2), name(3)])).toBe("ta-term-1");
  });

  it("returns undefined at the cap", () => {
    const full = Array.from({ length: MAX_SESSIONS }, (_unused, i) => name(i + 1));
    expect(allocateSessionName(full)).toBeUndefined();
    expect(allocateSessionName(full.slice(1))).toBe("ta-term-1");
  });
});

describe("isBusy", () => {
  it("is idle only when the foreground is the login shell", () => {
    expect(isBusy("bash", "bash")).toBe(false);
    expect(isBusy("vim", "bash")).toBe(true);
    expect(isBusy("sleep", "bash")).toBe(true);
  });

  it("treats an unreadable foreground as idle (the kill reports 404 instead)", () => {
    expect(isBusy(null, "bash")).toBe(false);
  });

  it("treats an unreadable login shell as busy (confirm, the safe side)", () => {
    expect(isBusy("bash", null)).toBe(true);
    expect(isBusy(null, null)).toBe(false);
  });
});

const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTmux)("settings chain against real tmux", () => {
  const socket = `ta-test-${process.pid}`;
  const run = (command: string) =>
    execFileSync("sh", ["-c", command.replace("-L ta-terminal", `-L ${socket}`)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("is accepted by tmux, twice, without duplicating anything", () => {
    try {
      run(newSessionCommand(name(1), 100, 30));
      const settingsOnly = attachCommand(name(1)).replace(/ \\; attach-session -t \S+$/, "");
      run(settingsOnly);
      run(settingsOnly);
      const tmux = `LC_ALL=C.UTF-8 tmux -L ${socket}`;
      expect(run(`${tmux} show -s set-clipboard`).trim()).toBe("set-clipboard on");
      const features = run(`${tmux} show -s terminal-features`)
        .split("\n")
        .filter((line) => line.includes("RGB"));
      expect(features).toHaveLength(1);
      expect(run(`${tmux} show -g window-size`).trim()).toBe("window-size latest");
    } finally {
      try {
        execFileSync("tmux", ["-L", socket, "kill-server"], { stdio: "ignore" });
      } catch {}
    }
  });
});

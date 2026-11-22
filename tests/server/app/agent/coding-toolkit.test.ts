import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal, type Context } from "@earendil-works/chord/context";
import type { Context as PiContext, JsonObject } from "@earendil-works/pi-ai";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import {
  codingResultOf,
  codingSelection,
  createCodingToolkit,
  type CodingPermissionMode,
} from "../../../../packages/agent/src/toolkits/coding";
import type { ChatToolCall } from "../../../../packages/agent/src/types";
import { SandboxTimeoutError } from "../../../../packages/sandbox/src/ssh/connection";
import {
  createSandboxConnection,
  type SandboxConnection,
} from "../../../../packages/sandbox/src/ssh/sandbox-connection";
import { startFakeSandboxServer } from "../../../../packages/sandbox/src/testing-ssh-server";
import { until } from "../../fixtures/until";
import { fakeSandboxConnection } from "./sandbox-connection-fake";

const CWD = "/work";

function inCwd(cwd: string | null = CWD): ToolExecutionApi {
  return { agent: async () => ({ cwd: cwd ?? undefined }) } as unknown as ToolExecutionApi;
}

async function run(
  capability: Capability,
  name: string,
  args: Record<string, unknown>,
  api: ToolExecutionApi = inCwd(),
  context: Context = BACKGROUND_CONTEXT,
) {
  const tool = capability.extension.tools!.find((candidate) => candidate.name === name)!;
  const result = (await tool.execute(args as never, api, context)) as ToolExecutionResult;
  const text = (result.output ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  return { ...result, text };
}

describe("coding toolkit on the sandbox", () => {
  let server: Awaited<ReturnType<typeof startFakeSandboxServer>>;
  let connection: SandboxConnection;
  let pathPrefix = "";

  const onSandbox = (path: string) => join(server.root, path);

  beforeAll(async () => {
    server = await startFakeSandboxServer((command) => {
      if (command.includes("hang-forever")) return { hang: true };
      const local = command.replaceAll("'/work", `'${server.root}/work`);
      const ran = spawnSync("sh", ["-c", local], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${pathPrefix}${process.env.PATH}` },
      });
      return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.status ?? 1 };
    });
    connection = createSandboxConnection({ host: "127.0.0.1", port: server.port });
    mkdirSync(onSandbox("/work/src"), { recursive: true });
    mkdirSync(onSandbox("/elsewhere"), { recursive: true });
  });

  afterEach(() => {
    pathPrefix = "";
  });

  afterAll(() => {
    connection?.close();
    server?.close();
  });

  const toolkit = () => createCodingToolkit({ connection });

  it("reads a file by a path relative to the cwd, and by an absolute one", async () => {
    writeFileSync(onSandbox("/work/src/a.ts"), "export const a = 1;\n");
    writeFileSync(onSandbox("/elsewhere/b.txt"), "outside the cwd\n");

    const relative = await run(toolkit(), "read", { path: "src/a.ts" });
    const absolute = await run(toolkit(), "read", { path: "/elsewhere/b.txt" });

    expect(relative).toMatchObject({ text: "export const a = 1;\n" });
    expect(relative.isError).toBeUndefined();
    expect(absolute.text).toBe("outside the cwd\n");
  });

  it("reads a window of lines, and says where a long file was cut", async () => {
    const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`);
    writeFileSync(onSandbox("/work/long.txt"), `${lines.join("\n")}\n`);

    const window = await run(toolkit(), "read", { path: "long.txt", offset: 10, limit: 3 });
    const whole = await run(toolkit(), "read", { path: "long.txt" });

    expect(window.text).toBe(
      "line 10\nline 11\nline 12\n\n[Lines 10-12 of 3000. Pass offset 13 to read on.]",
    );
    expect(whole.text.startsWith("line 1\nline 2\n")).toBe(true);
    expect(whole.text.endsWith("[Lines 1-2000 of 3000. Pass offset 2001 to read on.]")).toBe(true);
    expect(whole.text).not.toContain("line 2001\n");
  });

  it("reports a missing file, and describes a binary one instead of printing it", async () => {
    writeFileSync(onSandbox("/work/blob.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x81]));

    const missing = await run(toolkit(), "read", { path: "nope.txt" });
    const binary = await run(toolkit(), "read", { path: "blob.bin" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/no such file/i);
    expect(binary.text).toBe("[binary file, 4 bytes]");
  });

  it("writes a file under the cwd, making the folders it needs", async () => {
    const wrote = await run(toolkit(), "write", {
      path: "docs/notes/today.md",
      content: "# Today\n",
    });

    expect(wrote.isError).toBeUndefined();
    expect(wrote.text).toBe("Wrote docs/notes/today.md (8 bytes)");
    expect(readFileSync(onSandbox("/work/docs/notes/today.md"), "utf8")).toBe("# Today\n");
  });

  it("edits a file by exact text and returns the unified diff of the change", async () => {
    writeFileSync(
      onSandbox("/work/src/sum.ts"),
      "export function sum(a: number, b: number) {\n  return a - b;\n}\n",
    );

    const edited = await run(toolkit(), "edit", {
      path: "src/sum.ts",
      old_text: "return a - b;",
      new_text: "return a + b;",
    });

    const diff = [
      "--- a/src/sum.ts",
      "+++ b/src/sum.ts",
      "@@ -1,3 +1,3 @@",
      " export function sum(a: number, b: number) {",
      "-  return a - b;",
      "+  return a + b;",
      " }",
      "",
    ].join("\n");
    expect(edited.isError).toBeUndefined();
    expect(edited.text).toBe(diff);
    expect(codingResultOf(edited.details)).toEqual({ diff: { path: "src/sum.ts", diff } });
    expect(readFileSync(onSandbox("/work/src/sum.ts"), "utf8")).toBe(
      "export function sum(a: number, b: number) {\n  return a + b;\n}\n",
    );
  });

  it("replaces every match only when asked to, and refuses an ambiguous edit", async () => {
    writeFileSync(onSandbox("/work/src/twice.ts"), "let x = 1;\nlet y = 1;\n");

    const ambiguous = await run(toolkit(), "edit", {
      path: "src/twice.ts",
      old_text: "= 1;",
      new_text: "= 2;",
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toBe(
      "old_text matches 2 places in src/twice.ts. Add surrounding lines to pick one, or pass replace_all. Nothing was written.",
    );
    expect(readFileSync(onSandbox("/work/src/twice.ts"), "utf8")).toBe("let x = 1;\nlet y = 1;\n");

    const all = await run(toolkit(), "edit", {
      path: "src/twice.ts",
      old_text: "= 1;",
      new_text: "= 2;",
      replace_all: true,
    });
    expect(all.isError).toBeUndefined();
    expect(readFileSync(onSandbox("/work/src/twice.ts"), "utf8")).toBe("let x = 2;\nlet y = 2;\n");
  });

  it("runs a command in the cwd and reports its output and exit code", async () => {
    writeFileSync(onSandbox("/work/marker.txt"), "here\n");

    const listed = await run(toolkit(), "bash", { command: "cat marker.txt; echo warn >&2" });
    const failed = await run(toolkit(), "bash", { command: "echo nope; exit 3" });

    expect(listed.text).toBe("here\n\nwarn");
    expect(listed.isError).toBeUndefined();
    expect(codingResultOf(listed.details)).toEqual({ exitCode: 0 });
    expect(failed.isError).toBe(true);
    expect(failed.text).toBe("exit 3\nnope");
    expect(codingResultOf(failed.details)).toEqual({ exitCode: 3 });
  });

  it("keeps a command with quotes, a chain and a comment in one piece", async () => {
    const result = await run(toolkit(), "bash", {
      command: "printf '%s\\n' \"it's\" && false; echo after # done",
    });

    expect(result.text).toBe("it's\nafter");
  });

  it("stops waiting for a command when the turn is stopped", async () => {
    const stop = new AbortController();
    const running = run(
      toolkit(),
      "bash",
      { command: "hang-forever" },
      inCwd(),
      withAbortSignal(stop.signal, BACKGROUND_CONTEXT),
    );
    await until(
      () => server.execCalls.some((command) => command.includes("hang-forever")),
      "the command to start",
    );

    stop.abort();

    expect(await running).toMatchObject({
      isError: true,
      text: "Stopped before the command finished.",
    });
  });

  it("finds files by name under the cwd with ripgrep", async () => {
    const bin = onSandbox("/bin-with-rg");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "rg"), "#!/bin/sh\nprintf 'src/from-rg.ts\\nREADME.md\\n'\n");
    chmodSync(join(bin, "rg"), 0o755);
    pathPrefix = `${bin}:`;

    const found = await run(toolkit(), "find", { query: "from-rg" });

    expect(found.text).toBe("src/from-rg.ts");
  });

  it("finds files with find where ripgrep is not installed", async () => {
    mkdirSync(onSandbox("/work/pkg/node_modules/dep"), { recursive: true });
    writeFileSync(onSandbox("/work/pkg/Widget.tsx"), "");
    writeFileSync(onSandbox("/work/pkg/node_modules/dep/widget.js"), "");
    const withoutRipgrep = createCodingToolkit({
      connection: {
        ...connection,
        exec: (command, options) =>
          connection.exec(command.replace("command -v rg", "command -v no-ripgrep-here"), options),
      },
    });

    const found = await run(withoutRipgrep, "find", { query: "widget" });
    const none = await run(withoutRipgrep, "find", { query: "no-such-name" });

    expect(found.text).toBe("pkg/Widget.tsx");
    expect(none.text).toBe('No file name contains "no-such-name".');
    expect(none.isError).toBeUndefined();
  });

  describe("behind the Tool gate", () => {
    const runtimes: AgentRuntime[] = [];
    afterEach(async () => {
      await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
    });

    function callThenReport(tool: string, args: JsonObject) {
      return (context: PiContext) => {
        const last = context.messages.at(-1);
        if (last?.role === "toolResult") return fauxAssistantMessage(fauxText("done"));
        return {
          ...fauxAssistantMessage(fauxToolCall(tool, args)),
          stopReason: "toolUse" as const,
        };
      };
    }

    async function start(mode: CodingPermissionMode, tool: string, args: JsonObject) {
      const runtime = await openTestRuntime({
        storePath: ":memory:",
        capabilities: [toolkit()],
        respondWith: callThenReport(tool, args),
      });
      runtimes.push(runtime);
      const ref = await runtime.createConversation({
        modelId: TEST_MODEL,
        systemPrompt: "",
        cwd: CWD,
        capabilities: codingSelection(mode),
      });
      await runtime.submit(ref, { requestId: "one", text: "go" });
      const call = (status: ChatToolCall["status"]) =>
        until(async () => {
          const state = await runtime.readChat(ref);
          return state.messages
            .flatMap((message) => message.toolCalls ?? [])
            .find((candidate) => candidate.name === tool && candidate.status === status);
        }, `${tool} to be ${status}`);
      return { runtime, ref, call };
    }

    it("asks before write, edit and bash in the default mode, and runs what is approved", async () => {
      writeFileSync(onSandbox("/work/gated.txt"), "before\n");

      const write = await start("default", "write", { path: "gated-new.txt", content: "new\n" });
      const waitingWrite = await write.call("awaiting_approval");
      expect(existsSync(onSandbox("/work/gated-new.txt"))).toBe(false);
      await write.runtime.decideApproval(write.ref, waitingWrite.taskId!, "approved");
      await write.call("done");
      expect(readFileSync(onSandbox("/work/gated-new.txt"), "utf8")).toBe("new\n");

      const edit = await start("default", "edit", {
        path: "gated.txt",
        old_text: "before",
        new_text: "after",
      });
      const waitingEdit = await edit.call("awaiting_approval");
      await edit.runtime.decideApproval(edit.ref, waitingEdit.taskId!, "denied");
      await edit.call("denied");
      expect(readFileSync(onSandbox("/work/gated.txt"), "utf8")).toBe("before\n");

      const bash = await start("default", "bash", { command: "touch gated-by-bash.txt" });
      await bash.call("awaiting_approval");
      expect(existsSync(onSandbox("/work/gated-by-bash.txt"))).toBe(false);
    });

    it("runs read and find without asking in the default mode", async () => {
      writeFileSync(onSandbox("/work/open.txt"), "open\n");

      const read = await start("default", "read", { path: "open.txt" });
      const find = await start("default", "find", { query: "open" });

      expect((await read.call("done")).output).toBe("open\n");
      expect((await find.call("done")).output).toBe("open.txt");
    });

    it("lets edits through in acceptEdits but still asks before bash", async () => {
      const write = await start("acceptEdits", "write", { path: "accepted.txt", content: "ok\n" });
      await write.call("done");
      expect(readFileSync(onSandbox("/work/accepted.txt"), "utf8")).toBe("ok\n");

      const bash = await start("acceptEdits", "bash", { command: "echo hi" });
      await bash.call("awaiting_approval");
    });

    it("runs everything without asking in bypassPermissions, with the exit code and diff on the row", async () => {
      writeFileSync(onSandbox("/work/bypass.txt"), "one\n");

      const bash = await start("bypassPermissions", "bash", { command: "echo hi; exit 4" });
      const edit = await start("bypassPermissions", "edit", {
        path: "bypass.txt",
        old_text: "one",
        new_text: "two",
      });

      expect(await bash.call("error")).toMatchObject({ output: "exit 4\nhi", exitCode: 4 });
      expect(await edit.call("done")).toMatchObject({
        diff: {
          path: "bypass.txt",
          diff: "--- a/bypass.txt\n+++ b/bypass.txt\n@@ -1 +1 @@\n-one\n+two\n",
        },
      });
    });

    it("offers the model no way to change files in plan mode, and tells it to plan", async () => {
      const prompts: string[] = [];
      const runtime = await openTestRuntime({
        storePath: ":memory:",
        capabilities: [toolkit()],
        respondWith: (context) => {
          const system = context.messages.findLast((message) => message.role === "system") as
            | { sections?: Record<string, string>; toolsAdded?: { name: string }[] }
            | undefined;
          const added = (system?.toolsAdded ?? []).map((candidate) => candidate.name);
          prompts.push(`${system?.sections?.coding}\ntools added: ${added.join(",")}`);
          return fauxAssistantMessage(fauxText("Here is the plan."));
        },
      });
      runtimes.push(runtime);
      const config = { modelId: TEST_MODEL, systemPrompt: "", cwd: CWD };
      const ref = await runtime.createConversation({
        ...config,
        capabilities: codingSelection("plan"),
      });
      await runtime.submit(ref, { requestId: "one", text: "plan it" });
      await until(async () => !(await runtime.readChat(ref)).busy && prompts.length === 1, "plan");
      await runtime.configure(ref, { ...config, capabilities: codingSelection("acceptEdits") });
      await runtime.submit(ref, { requestId: "two", text: "do it" });
      await until(async () => !(await runtime.readChat(ref)).busy && prompts.length === 2, "act");

      expect(prompts[0]).toContain("tools added: read,find,ask_owner");
      expect(prompts[0]).toContain("Plan mode: do not change files.");
      expect(prompts[0]).toContain("working in /work");
      expect(prompts[1]).toContain("tools added: read,write,edit,bash,find,ask_owner");
      expect(prompts[1]).toContain("working in /work");
      expect(prompts[1]).not.toContain("Plan mode");
    });
  });
});

describe("coding toolkit (in-memory connection)", () => {
  it("leaves the file alone when the text to replace is not in it", async () => {
    const files = new Map([["/work/a.txt", Buffer.from("alpha\n")]]);
    const connection = fakeSandboxConnection({ files });

    const result = await run(createCodingToolkit({ connection }), "edit", {
      path: "a.txt",
      old_text: "beta",
      new_text: "gamma",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("old_text was not found in a.txt. Nothing was written.");
    expect(connection.writes).toEqual([]);
    expect(files.get("/work/a.txt")?.toString()).toBe("alpha\n");
  });

  it("runs a command as one quoted script after cd into the cwd", async () => {
    const connection = fakeSandboxConnection();

    await run(createCodingToolkit({ connection }), "bash", { command: "pnpm test; echo 'done'" });

    expect(connection.execs).toEqual([
      {
        command: "cd '/work' && eval 'pnpm test; echo '\\''done'\\'''",
        options: { timeoutMs: 120_000, maxBytes: 60_000 },
      },
    ]);
  });

  it("caps what a noisy command sends the model", async () => {
    const connection = fakeSandboxConnection({ exec: () => ({ stdout: "y".repeat(40_000) }) });

    const result = await run(createCodingToolkit({ connection }), "bash", { command: "yes" });

    expect(result.text).toHaveLength(30_000 + "\n… (truncated)".length);
    expect(result.text.endsWith("\n… (truncated)")).toBe(true);
  });

  it("says a command timed out, with the limit it ran under", async () => {
    const connection = fakeSandboxConnection({
      exec: (_command, options) => {
        throw new SandboxTimeoutError(options.timeoutMs!);
      },
    });

    const result = await run(createCodingToolkit({ connection }), "bash", {
      command: "sleep 100",
      timeout_secs: 5,
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Command timed out after 5s.");
  });

  it("refuses to touch the sandbox for a conversation with no working directory", async () => {
    const connection = fakeSandboxConnection();
    const toolkit = createCodingToolkit({ connection });

    const read = await run(toolkit, "read", { path: "a.txt" }, inCwd(null));
    const bash = await run(toolkit, "bash", { command: "ls" }, inCwd(null));

    expect(read).toMatchObject({ isError: true, text: "This thread has no working directory." });
    expect(bash).toMatchObject({ isError: true, text: "This thread has no working directory." });
    expect(connection.execs).toEqual([]);
  });

  it("says the sandbox is missing instead of running on the app's host", async () => {
    const toolkit = createCodingToolkit({});

    const result = await run(toolkit, "bash", { command: "ls" });

    expect(toolkit.setupHint).toBe("Set SANDBOX_HOST to give the coding agent a sandbox.");
    expect(result).toMatchObject({
      isError: true,
      text: "Sandbox is not configured: set SANDBOX_HOST on the server.",
    });
  });

  it("maps each permission mode onto allow, ask and off", () => {
    const modes = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
    expect(modes.map((mode) => codingSelection(mode).permissions)).toEqual([
      {
        read: "allow",
        find: "allow",
        write: "ask",
        edit: "ask",
        bash: "ask",
        message_owner: "off",
      },
      {
        read: "allow",
        find: "allow",
        write: "allow",
        edit: "allow",
        bash: "ask",
        message_owner: "off",
      },
      {
        read: "allow",
        find: "allow",
        write: "off",
        edit: "off",
        bash: "off",
        message_owner: "off",
      },
      {
        read: "allow",
        find: "allow",
        write: "allow",
        edit: "allow",
        bash: "allow",
        message_owner: "off",
      },
    ]);
    expect(codingSelection("default").enabled).toEqual(["coding", "questions"]);
  });
});

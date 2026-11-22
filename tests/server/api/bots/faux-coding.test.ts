import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  closeAgentRuntime,
  openFauxAgentRuntime,
} from "../../../../apps/web/src/server/api/bots/bots.runtime";
import { closeSandboxConnections } from "../../../../apps/web/src/server/api/bots/sandbox-host";
import { TEST_MODEL } from "../../../../packages/agent/src/testing";
import { codingSelection } from "../../../../packages/agent/src/toolkits/coding";
import { startFakeSandboxServer } from "../../../../packages/sandbox/src/testing-ssh-server";
import { until } from "../../fixtures/until";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

let server: Awaited<ReturnType<typeof startFakeSandboxServer>>;

beforeAll(async () => {
  server = await startFakeSandboxServer((command) => {
    const local = command.replaceAll("'/work", `'${server.root}/work`);
    const ran = spawnSync("sh", ["-c", local], { encoding: "utf8" });
    return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.status ?? 1 };
  });
  mkdirSync(join(server.root, "work"));
});

afterAll(() => server?.close());

async function fauxOnSandbox() {
  const runtime = await openFauxAgentRuntime(":memory:", {
    env: { SANDBOX_HOST: "127.0.0.1", SANDBOX_PORT: String(server.port) },
  });
  cleanups.push(async () => {
    await closeAgentRuntime();
    closeSandboxConnections();
  });
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    cwd: "/work",
    capabilities: codingSelection("bypassPermissions"),
  });
  const turn = async (text: string) => {
    await runtime.submit(ref, { requestId: text, text });
    return until(async () => {
      const state = await runtime.readChat(ref);
      return state.busy ? undefined : state;
    }, `the reply to ${text}`);
  };
  return { turn };
}

describe("the faux model's coding commands", () => {
  it("runs /bash through the bash tool on the sandbox and answers with what it printed", async () => {
    const { turn } = await fauxOnSandbox();

    const state = await turn("/bash echo hi");

    const calls = state.messages.flatMap((message) => message.toolCalls ?? []);
    expect(calls).toEqual([
      expect.objectContaining({
        name: "bash",
        args: { command: "echo hi" },
        status: "done",
        output: "hi",
        exitCode: 0,
      }),
    ]);
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", text: "Echo: hi" });
  });

  it("writes, edits, reads and finds a file with the other commands", async () => {
    const { turn } = await fauxOnSandbox();

    await turn("/write notes/a.txt one two");
    await turn("/edit notes/a.txt one => three");
    const read = await turn("/read notes/a.txt");
    const found = await turn("/find a.txt");
    const slept = await turn("/sleep 0");

    expect(read.messages.at(-1)?.text).toBe("Echo: three two");
    expect(found.messages.at(-1)?.text).toBe("Echo: notes/a.txt");
    const calls = slept.messages.flatMap((message) => message.toolCalls ?? []);
    expect(calls.map((call) => [call.name, call.status])).toEqual([
      ["write", "done"],
      ["edit", "done"],
      ["read", "done"],
      ["find", "done"],
      ["bash", "done"],
    ]);
    expect(calls.at(-1)?.args).toEqual({ command: "sleep 0" });
  });
});

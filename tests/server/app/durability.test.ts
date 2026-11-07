import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { ChatState } from "../../../packages/agent/src/index";
import { openTestRuntime } from "../../../packages/agent/src/testing";
import { applyChatEvents, until } from "../fixtures";

const TIMEOUT_MS = 15_000;
/** The fixture's poll with this suite's longer patience (restarts are slow). */
const untilReady = <T>(
  check: () => T | false | undefined | Promise<T | false | undefined>,
  what: string,
  ms = TIMEOUT_MS,
) => until(check, what, ms);

async function waitForChildMessage(
  child: ChildProcess,
  expectedType: string,
  timeoutMs = TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, rejectMessage) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      rejectMessage(
        new Error(`Timed out waiting for child "${expectedType}" message. stderr: ${stderr}`),
      );
    }, timeoutMs);
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      callback();
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const message: unknown = JSON.parse(line);
          if (
            typeof message === "object" &&
            message !== null &&
            "type" in message &&
            message.type === expectedType
          ) {
            finish(() => resolveMessage(message as Record<string, unknown>));
            return;
          }
        } catch {
          // The child only emits JSON protocol messages on stdout.
        }
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => finish(() => rejectMessage(error)));
    child.once("exit", (code, signal) => {
      finish(() =>
        rejectMessage(
          new Error(
            `Child exited before "${expectedType}" (${code === null ? signal : `code ${code}`}). stderr: ${stderr}`,
          ),
        ),
      );
    });
  });
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

describe("AgentRuntime durability", () => {
  it("recovers one submitted input without duplicate visible messages after a SIGKILL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tiny-agents-durability-"));
    const storePath = join(directory, "agent.db");
    const childScript = join(directory, "crash-mid-reply.ts");
    const testHelper = resolve(process.cwd(), "packages/agent/src/testing.ts");
    let child: ChildProcess | undefined;
    let resumed: Awaited<ReturnType<typeof openTestRuntime>> | undefined;

    try {
      await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
      await writeFile(
        childScript,
        [
          `import { openTestRuntime, TEST_MODEL } from ${JSON.stringify(testHelper)};`,
          "",
          "async function main(): Promise<void> {",
          `  const runtime = await openTestRuntime({ storePath: ${JSON.stringify(storePath)}, tokensPerSecond: 1, reply: () => "one two three four five six seven eight nine ten eleven twelve" });`,
          '  const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });',
          '  await runtime.submit(ref, { requestId: "crash-safe-request", text: "durably admit me" });',
          "  while (!runtime.isBusy(ref)) {",
          "    await new Promise((resolve) => setTimeout(resolve, 10));",
          "  }",
          '  process.stdout.write(`${JSON.stringify({ type: "busy", ref })}\\n`);',
          "  setInterval(() => undefined, 1_000);",
          "}",
          "void main().catch((error: unknown) => {",
          "  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\\n`);",
          "  process.exit(1);",
          "});",
          "",
        ].join("\n"),
      );

      child = spawn(process.execPath, ["--import", "tsx", childScript], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const busy = await waitForChildMessage(child, "busy");
      expect(busy.ref).toEqual(expect.any(Number));

      await killChild(child);

      resumed = await openTestRuntime({ storePath, lockWaitMs: 2_000 });
      const ref = busy.ref;
      if (typeof ref !== "number")
        throw new Error("Child reported a non-numeric conversation reference");

      let state: ChatState = { messages: [], busy: false, queued: [] };
      const subscription = await resumed.watchChat(ref, (events) => {
        state = applyChatEvents(state, events);
      });
      try {
        await untilReady(() => {
          const userMessages = state.messages.filter((message) => message.role === "user");
          const assistantMessages = state.messages.filter(
            (message) => message.role === "assistant",
          );
          const settled =
            assistantMessages.some((message) => message.status === "done") ||
            state.messages.some(
              (message) =>
                message.status === "stopped" ||
                (message.role === "user" && message.status === "unanswered"),
            );
          return !state.busy && userMessages.length === 1 && settled;
        }, "the recovered conversation to settle");

        const users = state.messages.filter((message) => message.role === "user");
        const assistants = state.messages.filter((message) => message.role === "assistant");
        expect(users).toEqual([expect.objectContaining({ text: "durably admit me" })]);
        expect(assistants.length).toBeLessThanOrEqual(1);
        expect(
          assistants[0]?.status === "done" ||
            assistants[0]?.status === "stopped" ||
            users[0]?.status === "unanswered",
        ).toBe(true);
      } finally {
        await subscription.stop();
      }
    } finally {
      if (resumed) await resumed.close();
      if (child) await killChild(child);
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

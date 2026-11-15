/**
 * The Code registry of the `code` staging instance: the app's own registry
 * (`code.registry.ts`) plus Claude Code, through the registry's own `extra`
 * seam. hooks.mjs hands this module to `code.boot.ts` in place of the real
 * one; no product file changes.
 *
 * Claude Code here is the real driver (`createClaudeCodeHarness`) talking to
 * the real worker (`createClaudeWorkerServer`, coding mode) in this process
 * on a loopback port, the way `tests/server/code/claude-code/driver.test.ts`
 * runs it. The only stand-in is the Agent SDK: the tests' `FakeSdk` with a
 * brain that plays the CAST thread (../CAST.md, "The Code thread") one step
 * at a time. A step runs when the staging script writes its number to
 * `$STAGE_CODE_DIR/gate`, so each state can be snapshotted mid-turn.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { logger } from "@groot/core/logger";
import {
  DEFAULT_CODING_LIMITS,
  DEFAULT_TIMINGS,
  createClaudeWorkerServer,
  type ClaudeWorkerServer,
  type CodingSdkMessage,
} from "@tiny-agents/claude-worker";
import {
  createClaudeCodeHarness,
  type HarnessHost,
  type HarnessInstance,
} from "@tiny-agents/code/server";
import * as real from "../../../../../apps/web/src/server/api/code/code.registry.ts";
import { threadIndex } from "../../../../../apps/web/src/server/api/code/code.store.ts";
import {
  FakeSdk,
  result,
  text,
  toolResult,
  toolUse,
  type Brain,
  type FakeQuery,
} from "../../../../../tests/server/code/claude-code/fake-sdk.ts";

export * from "../../../../../apps/web/src/server/api/code/code.registry.ts";

const DIR = process.env.STAGE_CODE_DIR!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the staging script has allowed thread step `step` (CAST numbering). */
async function gate(step: number): Promise<void> {
  for (;;) {
    let allowed = 0;
    try {
      allowed = Number(readFileSync(path.join(DIR, "gate"), "utf8").trim()) || 0;
    } catch {
      // No gate file yet: nothing is allowed.
    }
    if (allowed >= step) return;
    // eslint-disable-next-line no-await-in-loop -- a poll
    await sleep(100);
  }
}

// ../CAST.md, "The Code thread", word for word.
const FAIL_OUTPUT = [
  "Exit code 1",
  " FAIL  tests/checkout.test.ts > checkout > shows the cart total",
  "AssertionError: expected '₹0' to be '₹1,499'",
  " Test Files  1 failed (1)",
  "      Tests  1 failed | 5 passed (6)",
].join("\n");
const OLD = [
  "    render(<Checkout />);",
  '    expect(screen.getByTestId("total")).toHaveTextContent("₹1,499");',
].join("\n");
const NEW = [
  "    render(<Checkout />);",
  '    await screen.findByText("Price loaded");',
  '    expect(screen.getByTestId("total")).toHaveTextContent("₹1,499");',
].join("\n");
const PASS_OUTPUT = [" Test Files  9 passed (9)", "      Tests  48 passed (48)"].join("\n");
const ANSWER =
  "Fixed the flaky checkout test. The cart total was read before the price fetch resolved, so the test now awaits it. All 48 tests pass.";

/** The SDK's first message of a process (`sdk.d.ts` 0.3.x, as fake-sdk.ts shapes it). */
function init(query: FakeQuery): CodingSdkMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: query.sessionId,
    uuid: randomUUID(),
    cwd: query.options.cwd,
    model: "claude-opus-4-7",
    permissionMode: query.options.permissionMode,
    tools: ["Bash", "Edit", "Read"],
    slash_commands: ["compact", "review"],
    apiKeySource: "none",
    claude_code_version: "2.3.0",
    mcp_servers: [],
    output_style: "default",
    skills: [],
    plugins: [],
  };
}

/** One tool call: the `tool_use`, a beat while it runs, then its result. */
async function run(
  query: FakeQuery,
  id: string,
  name: string,
  input: unknown,
  output: string,
  isError = false,
) {
  query.emit(toolUse(query, id, name, input));
  await sleep(400);
  query.emit(toolResult(query, id, output, { isError }));
}

/** Claude Code playing the CAST thread: one turn, held at each step's gate. */
const brain: Brain = async (query) => {
  query.emit(init(query));
  let cost = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- one prompt at a time
    const prompt = await query.nextInput();
    if (!prompt) return;
    await gate(2);
    await run(
      query,
      "toolu_stage_bash_1",
      "Bash",
      { command: "pnpm test checkout" },
      FAIL_OUTPUT,
      true,
    );
    await gate(3);
    await run(
      query,
      "toolu_stage_edit_1",
      "Edit",
      { file_path: "tests/checkout.test.ts", old_string: OLD, new_string: NEW },
      "The file tests/checkout.test.ts has been updated successfully.",
    );
    await gate(4);
    await run(query, "toolu_stage_bash_2", "Bash", { command: "pnpm test" }, PASS_OUTPUT);
    await gate(5);
    query.emit(text(query, ANSWER));
    cost += 0.31;
    query.emit(result(query, { totalCost: cost, durationMs: 134_000, text: ANSWER }));
  }
};

function claudeCode(): HarnessInstance {
  const host: HarnessHost = {
    logger: {
      info: (message, fields) => logger.info(fields ?? {}, message),
      warn: (message, fields) => logger.warn(fields ?? {}, message),
      error: (message, fields) => logger.error(fields ?? {}, message),
    },
    index: threadIndex,
    now: () => new Date(),
  };
  const token = randomBytes(32).toString("base64");
  let worker: Promise<ClaudeWorkerServer> | undefined;
  const startWorker = () =>
    createClaudeWorkerServer({
      token,
      // The bot engine is not used here: only coding mode.
      query: async () => undefined as never,
      authStatus: async () => ({
        loggedIn: true,
        authMethod: "claude.ai",
        subscriptionType: "max",
      }),
      env: {},
      timings: DEFAULT_TIMINGS,
      port: 0,
      coding: {
        sdk: new FakeSdk(brain),
        limits: DEFAULT_CODING_LIMITS,
        uploadsDir: path.join(DIR, "claude-uploads"),
        home: path.join(DIR, "home"),
      },
    });
  return createClaudeCodeHarness({
    host,
    resolveWorker: async () => {
      worker ??= startWorker();
      return { url: (await worker).url, token };
    },
  });
}

export function buildHarnesses(options: real.RegistryOptions = {}): HarnessInstance[] {
  return real.buildHarnesses({ ...options, extra: [...(options.extra ?? []), claudeCode()] });
}

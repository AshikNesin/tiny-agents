/**
 * The Tool gate, on both engines: every case runs once on pi (the faux
 * model) and once on the Claude plan engine (a fake worker socket), with
 * the same toolkit and script (`engine-harness.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { secretRedactor } from "../../../../packages/agent/src/redact";
import type { ReviewInput, Reviewer } from "../../../../packages/agent/src/reviewer";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import type { ActivityChange, WaitEvent } from "../../../../packages/agent/src/types";
import {
  awaitingApproval,
  ENGINES,
  VAULT_VALUE,
  mailCapability,
  openEngine,
  until,
  watch,
  type EngineKind,
} from "./engine-harness";

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  secretRedactor.clear();
  vi.unstubAllEnvs();
});

function fakeReviewer(approve: boolean): Reviewer & { inputs: ReviewInput[] } {
  const inputs: ReviewInput[] = [];
  const reviewer = async (input: ReviewInput) => {
    inputs.push(input);
    return { approve, classifier: "fake/classifier", requested: approve ? 0.98 : 0.2, risk: 0.3 };
  };
  return Object.assign(reviewer, { inputs });
}

async function setup(
  kind: EngineKind,
  sent: string[] = [],
  options: { reviewer?: Reviewer; autoReview?: boolean } = {},
) {
  const engine = await openEngine(kind, {
    capabilities: [mailCapability(sent)],
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
  });
  runtimes.push(engine.runtime);
  const ref = await engine.runtime.createConversation({
    modelId: engine.modelId,
    systemPrompt: "You run my inbox.",
    capabilities: {
      enabled: ["mail"],
      permissions: {},
      ...(options.autoReview ? { autoReview: true } : {}),
    },
  });
  const chat = await watch(engine.runtime, ref);
  return { ...engine, ref, chat, sent };
}

describe.each(ENGINES)("Tool gate on %s", (kind) => {
  it("counts a call waiting for approval and reports it through onWait", async () => {
    const { runtime, ref, chat, send, sent } = await setup(kind);
    const waits: WaitEvent[] = [];
    const activity: ActivityChange[] = [];
    runtime.onWait((event) => waits.push(event));
    runtime.onActivity((change) => activity.push(change));

    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    const waiting = await awaitingApproval(chat, "send_email");
    expect(runtime.pendingApprovals(ref)).toBe(1);
    expect(waits).toContainEqual(
      expect.objectContaining({
        kind: "approval",
        change: "added",
        conversation: ref,
        task: waiting.taskId,
        tool: "send_email",
      }),
    );
    expect(activity.filter((change) => change.conversation === ref).at(-1)).toMatchObject({
      approvals: 1,
    });

    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    expect(await until(() => chat.results()[0], "reply")).toBe("Sent to ana@x.dev");
    expect(sent).toEqual(["ana@x.dev"]);
    expect(runtime.pendingApprovals(ref)).toBe(0);
    expect(waits).toContainEqual(
      expect.objectContaining({ kind: "approval", change: "removed", task: waiting.taskId }),
    );
  }, 15_000);

  it("scrubs registered secrets from a tool's result before anyone reads it", async () => {
    secretRedactor.register(VAULT_VALUE);
    const { worker, ref, chat, send } = await setup(kind);
    await send(ref, { requestId: "r1", text: "read_token" });
    const reported = await until(() => chat.results()[0], "reply");
    expect(reported).toBe("token=[vault]");
    expect(chat.toolCall("read_token")?.output).toBe("token=[vault]");
    expect(JSON.stringify(worker.results)).not.toContain(VAULT_VALUE);
  }, 15_000);

  it("lets auto-review run a call it approves, judged on the owner's words only", async () => {
    const reviewer = fakeReviewer(true);
    const { ref, chat, send, sent } = await setup(kind, [], { reviewer, autoReview: true });
    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    expect(await until(() => chat.results()[0], "reply")).toBe("Sent to ana@x.dev");
    expect(sent).toEqual(["ana@x.dev"]);
    expect(chat.toolCall("send_email")).toMatchObject({ status: "done", approval: "auto" });
    expect(reviewer.inputs).toEqual([
      expect.objectContaining({
        tool: "send_email",
        args: { to: "ana@x.dev" },
        instructions: "You run my inbox.",
        ownerMessages: ["send_email ana@x.dev"],
      }),
    ]);
  }, 15_000);

  it("asks with the card a gate plan adds, whatever auto-review says", async () => {
    const reviewer = fakeReviewer(true);
    const { runtime, ref, chat, send, sent } = await setup(kind, [], {
      reviewer,
      autoReview: true,
    });
    await send(ref, { requestId: "r1", text: "pay_invoice 40" });
    const pay = await awaitingApproval(chat, "pay_invoice");
    expect(pay.vault).toMatchObject({ handle: "card-1", label: "Visa" });
    expect(reviewer.inputs).toEqual([]);
    expect(sent).toEqual([]);
    await runtime.decideApproval(ref, pay.taskId!, "approved");
    expect(await until(() => chat.results()[0], "reply")).toBe("Paid");
    expect(chat.toolCall("pay_invoice")).toMatchObject({ status: "done", approval: "approved" });
  }, 15_000);

  it("refuses a call its gate plan refuses, without asking or running it", async () => {
    const { runtime, ref, chat, send, sent } = await setup(kind);
    await send(ref, { requestId: "r1", text: "forward_all" });
    expect(await until(() => chat.results()[0], "reply")).toBe(
      "Forwarding everything is not allowed.",
    );
    expect(sent).toEqual([]);
    expect(runtime.pendingApprovals(ref)).toBe(0);
    expect(chat.toolCall("forward_all")?.status).toBe("error");
  }, 15_000);
});

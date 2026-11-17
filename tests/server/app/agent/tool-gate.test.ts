/**
 * The Tool gate (ADR 0014), on both engines: every case runs once on pi
 * (the faux model) and once on the Claude plan engine (a fake worker
 * socket), with the same toolkit and script (`engine-harness.ts`).
 * Permissions, gate plans, YOLO mode (issue #151), auto-review (issue #65),
 * the Owner wait's bookkeeping and result redaction must not differ.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { until } from "../../fixtures/until";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  watch,
  type EngineKind,
} from "./engine-harness";

const OWNER = 1;

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

interface SetupOptions {
  reviewer?: Reviewer;
  ownerUserId?: () => Promise<number | undefined>;
  autoReview?: boolean;
  unattended?: boolean;
  budgetTokens?: number;
  storePath?: string;
}

async function open(kind: EngineKind, sent: string[], options: SetupOptions = {}) {
  const engine = await openEngine(kind, {
    capabilities: [mailCapability(sent)],
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
    ...(options.ownerUserId ? { ownerUserId: options.ownerUserId } : {}),
    ...(options.storePath ? { storePath: options.storePath } : {}),
  });
  runtimes.push(engine.runtime);
  const config = (autoReview = options.autoReview) => ({
    modelId: engine.modelId,
    systemPrompt: "You run my inbox.",
    capabilities: {
      enabled: ["mail"],
      permissions: {},
      ...(autoReview ? { autoReview: true } : {}),
      ...(options.unattended ? { unattended: true } : {}),
      ...(options.budgetTokens ? { budgetTokens: options.budgetTokens } : {}),
    },
  });
  return { ...engine, config };
}

async function setup(kind: EngineKind, sent: string[] = [], options: SetupOptions = {}) {
  const engine = await open(kind, sent, options);
  const ref = await engine.runtime.createConversation(engine.config());
  const chat = await watch(engine.runtime, ref);
  return { ...engine, ref, chat, sent };
}

describe.each(ENGINES)("Tool gate on %s", (kind) => {
  describe("permissions and the Owner wait", () => {
    it("runs an allowed (read-only) tool without asking", async () => {
      const { runtime, ref, chat, send } = await setup(kind);
      await send(ref, { requestId: "r1", text: "read_inbox" });
      expect(await until(() => chat.results()[0], "reply")).toMatch(/^2 unread/);
      expect(chat.toolCall("read_inbox")).toMatchObject({ status: "done" });
      expect(chat.toolCall("read_inbox")?.approval).toBeUndefined();
      expect(runtime.pendingApprovals(ref)).toBe(0);
    }, 15_000);

    it("counts a call waiting for approval and reports it through onWait", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      const waits: WaitEvent[] = [];
      const activity: ActivityChange[] = [];
      runtime.onWait((event) => waits.push(event));
      runtime.onActivity((change) => activity.push(change));

      await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
      const waiting = await awaitingApproval(chat, "send_email");
      expect(waiting.taskId).toEqual(expect.any(Number));
      expect(sent).toEqual([]);
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
        busy: true,
        approvals: 1,
      });

      await runtime.decideApproval(ref, waiting.taskId!, "approved");
      expect(await until(() => chat.results()[0], "reply")).toBe("Sent to ana@x.dev");
      expect(sent).toEqual(["ana@x.dev"]);
      expect(chat.toolCall("send_email")).toMatchObject({ status: "done", approval: "approved" });
      expect(runtime.pendingApprovals(ref)).toBe(0);
      expect(waits).toContainEqual(
        expect.objectContaining({ kind: "approval", change: "removed", task: waiting.taskId }),
      );
      await expect(runtime.decideApproval(ref, waiting.taskId!, "approved")).rejects.toThrow(
        /not waiting/,
      );
    }, 15_000);

    it("never runs a denied call, and tells the model", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      await send(ref, { requestId: "r1", text: "send_email bo@x.dev" });
      const waiting = await awaitingApproval(chat, "send_email");
      await runtime.decideApproval(ref, waiting.taskId!, "denied");
      expect(await until(() => chat.results()[0], "reply")).toMatch(/owner denied/);
      expect(sent).toEqual([]);
      expect(chat.toolCall("send_email")).toMatchObject({ status: "denied", approval: "denied" });
      expect(runtime.pendingApprovals(ref)).toBe(0);
    }, 15_000);

    it("stops counting a call when the reply is stopped while it waits", async () => {
      const { runtime, ref, chat, send } = await setup(kind);
      await send(ref, { requestId: "r1", text: "send_email cy@x.dev" });
      await awaitingApproval(chat, "send_email");
      expect(runtime.pendingApprovals(ref)).toBe(1);
      await runtime.abort(ref);
      await until(() => runtime.pendingApprovals(ref) === 0, "the wait to end");
    }, 15_000);

    it("refuses an asking call in a conversation nobody watches", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind, [], { unattended: true });
      await send(ref, { requestId: "r1", text: "send_email dy@x.dev" });
      expect(await until(() => chat.results()[0], "reply")).toMatch(/nobody is here/);
      expect(sent).toEqual([]);
      expect(chat.toolCall("send_email")).toMatchObject({ approval: "refused" });
      expect(runtime.pendingApprovals(ref)).toBe(0);
    }, 15_000);

    it("scrubs registered secrets from a tool's result before anyone reads it", async () => {
      secretRedactor.register(VAULT_VALUE);
      const { worker, ref, chat, send } = await setup(kind);
      await send(ref, { requestId: "r1", text: "read_token" });
      expect(await until(() => chat.results()[0], "reply")).toBe("token=[vault]");
      expect(chat.toolCall("read_token")?.output).toBe("token=[vault]");
      expect(JSON.stringify(chat.state())).not.toContain(VAULT_VALUE);
      expect(JSON.stringify(worker.results)).not.toContain(VAULT_VALUE);
    }, 15_000);
  });

  describe("gate plans", () => {
    it("refuses a call its plan refuses, without asking or running it", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      await send(ref, { requestId: "r1", text: "forward_all" });
      expect(await until(() => chat.results()[0], "reply")).toBe(
        "Forwarding everything is not allowed.",
      );
      expect(sent).toEqual([]);
      expect(runtime.pendingApprovals(ref)).toBe(0);
      expect(chat.toolCall("forward_all")?.status).toBe("error");
    }, 15_000);

    it("asks with the vault card its plan adds", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      const waits: WaitEvent[] = [];
      runtime.onWait((event) => waits.push(event));
      await send(ref, { requestId: "r1", text: "pay_invoice 40" });
      const pay = await awaitingApproval(chat, "pay_invoice");
      expect(pay.vault).toMatchObject({ handle: "card-1", label: "Visa" });
      expect(waits).toContainEqual(
        expect.objectContaining({
          change: "added",
          tool: "pay_invoice",
          subject: "Visa on shop.dev",
        }),
      );
      expect(sent).toEqual([]);
      await runtime.decideApproval(ref, pay.taskId!, "approved");
      expect(await until(() => chat.results()[0], "reply")).toBe("Paid");
      expect(chat.toolCall("pay_invoice")).toMatchObject({ status: "done", approval: "approved" });
    }, 15_000);
  });

  describe("auto-review", () => {
    it("runs a call it approves without a card, judged on the owner's words only", async () => {
      const reviewer = fakeReviewer(true);
      const { runtime, ref, chat, send, sent } = await setup(kind, [], {
        reviewer,
        autoReview: true,
      });
      await send(ref, { requestId: "r1", text: "read_inbox" });
      await until(() => chat.results().length === 1, "first reply");
      await send(ref, { requestId: "r2", text: "please send_email ana@x.dev" });
      await until(() => chat.results().length === 2, "second reply");

      expect(sent).toEqual(["ana@x.dev"]);
      expect(chat.toolCall("send_email")).toMatchObject({ status: "done", approval: "auto" });
      expect(runtime.pendingApprovals(ref)).toBe(0);
      // read_inbox is allowed (read-only): only send_email was reviewed.
      expect(reviewer.inputs).toEqual([
        {
          tool: "send_email",
          args: { to: "ana@x.dev" },
          instructions: "You run my inbox.",
          ownerMessages: ["read_inbox", "please send_email ana@x.dev"],
        },
      ]);
      expect(JSON.stringify(reviewer.inputs)).not.toContain("IGNORE PREVIOUS");
    }, 15_000);

    it("shows the card as before when the reviewer does not approve", async () => {
      const reviewer = fakeReviewer(false);
      const { runtime, ref, chat, send, sent } = await setup(kind, [], {
        reviewer,
        autoReview: true,
      });
      await send(ref, { requestId: "r1", text: "send_email cy@x.dev" });
      const waiting = await awaitingApproval(chat, "send_email");
      expect(sent).toEqual([]);
      await runtime.decideApproval(ref, waiting.taskId!, "approved");
      expect(await until(() => chat.results()[0], "reply")).toBe("Sent to cy@x.dev");
      expect(chat.toolCall("send_email")).toMatchObject({ approval: "approved" });
      expect(reviewer.inputs).toHaveLength(1);
    }, 15_000);

    it("stops when the owner turns it off", async () => {
      const reviewer = fakeReviewer(true);
      const { runtime, ref, chat, send, config } = await setup(kind, [], {
        reviewer,
        autoReview: true,
      });
      await runtime.configure(ref, config(false));
      await send(ref, { requestId: "r1", text: "send_email di@x.dev" });
      await awaitingApproval(chat, "send_email");
      expect(reviewer.inputs).toEqual([]);
    }, 15_000);

    it("never auto-approves askOnly tools or vault uses", async () => {
      const reviewer = fakeReviewer(true);
      const { runtime, ref, chat, send, sent } = await setup(kind, [], {
        reviewer,
        autoReview: true,
      });
      await send(ref, { requestId: "r1", text: "save_rule spam" });
      const rule = await awaitingApproval(chat, "save_rule");
      await runtime.decideApproval(ref, rule.taskId!, "denied");
      await until(() => chat.results().length === 1, "first reply");

      await send(ref, { requestId: "r2", text: "pay_invoice 40" });
      const pay = await awaitingApproval(chat, "pay_invoice");
      await runtime.decideApproval(ref, pay.taskId!, "denied");
      await until(() => chat.results().length === 2, "second reply");

      expect(reviewer.inputs).toEqual([]);
      expect(sent).toEqual([]);
    }, 20_000);

    it("leaves turns another bot started to the owner", async () => {
      const reviewer = fakeReviewer(true);
      const { ref, chat, send } = await setup(kind, [], { reviewer, autoReview: true });
      await send(ref, {
        requestId: "r1",
        text: "send_email eve@x.dev",
        peer: { kind: "message", name: "Scout" },
      });
      await awaitingApproval(chat, "send_email");
      expect(reviewer.inputs).toEqual([]);
    }, 15_000);

    it("in a shared chat, leaves a guest's turn to the owner and reads only the owner's words (S6)", async () => {
      const reviewer = fakeReviewer(true);
      const { runtime, ref, chat, send, sent } = await setup(kind, [], {
        reviewer,
        autoReview: true,
        ownerUserId: async () => OWNER,
      });

      await send(ref, {
        requestId: "r1",
        text: "Gus: send_email gus@x.dev",
        author: { id: 7, name: "Gus" },
      });
      const guest = await awaitingApproval(chat, "send_email");
      expect(reviewer.inputs).toEqual([]);
      await runtime.decideApproval(ref, guest.taskId!, "denied");
      await until(() => chat.results().length === 1, "first reply");

      await send(ref, {
        requestId: "r2",
        text: "Ash: send_email ash@x.dev",
        author: { id: OWNER, name: "Ash" },
      });
      await until(() => chat.results().length === 2, "second reply");
      expect(sent).toEqual(["ash@x.dev"]);
      expect(reviewer.inputs.map((input) => input.ownerMessages)).toEqual([
        ["Ash: send_email ash@x.dev"],
      ]);
    }, 20_000);

    it("shows the card when the owner can't be looked up (S6)", async () => {
      const reviewer = fakeReviewer(true);
      const { runtime, ref, chat, send, sent } = await setup(kind, [], {
        reviewer,
        autoReview: true,
        ownerUserId: async () => {
          throw new Error("database is locked");
        },
      });
      await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
      const waiting = await awaitingApproval(chat, "send_email");
      expect(reviewer.inputs).toEqual([]);
      expect(sent).toEqual([]);
      await runtime.decideApproval(ref, waiting.taskId!, "approved");
      expect(await until(() => chat.results()[0], "reply")).toBe("Sent to ana@x.dev");
    }, 20_000);
  });

  describe("YOLO mode", () => {
    it("is off by default: an asking call shows its card", async () => {
      const { runtime, ref, chat, send } = await setup(kind);
      expect(await runtime.yolo(ref)).toBe(false);
      await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
      await awaitingApproval(chat, "send_email");
    }, 15_000);

    it("runs asking calls, askOnly ones too, without a card and marks them yolo", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);
      expect(await runtime.yolo(ref)).toBe(true);

      await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
      expect(await until(() => chat.results()[0], "first reply")).toBe("Sent to ana@x.dev");
      await send(ref, { requestId: "r2", text: "save_rule spam" });
      expect(await until(() => chat.results()[1], "second reply")).toBe("Saved");

      expect(sent).toEqual(["ana@x.dev", "rule:spam"]);
      expect(chat.toolCall("send_email")).toMatchObject({ status: "done", approval: "yolo" });
      expect(chat.toolCall("save_rule")).toMatchObject({ approval: "yolo" });
      expect(runtime.pendingApprovals(ref)).toBe(0);
    }, 15_000);

    it("never runs a vault use without the owner", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);
      await send(ref, { requestId: "r1", text: "pay_invoice 40" });
      const pay = await awaitingApproval(chat, "pay_invoice");
      expect(pay.vault).toMatchObject({ handle: "card-1" });
      expect(sent).toEqual([]);
      await runtime.decideApproval(ref, pay.taskId!, "approved");
      expect(await until(() => chat.results()[0], "reply")).toBe("Paid");
      expect(chat.toolCall("pay_invoice")).toMatchObject({ approval: "approved" });
    }, 15_000);

    it("leaves turns another bot started to the owner", async () => {
      const { runtime, ref, chat, send } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);
      await send(ref, {
        requestId: "r1",
        text: "send_email eve@x.dev",
        peer: { kind: "message", name: "Scout" },
      });
      await awaitingApproval(chat, "send_email");
    }, 15_000);

    it("in a shared chat, trusts only the owner's messages", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);

      await send(ref, {
        requestId: "r1",
        text: "Gus: send_email gus@x.dev",
        author: { id: 7, name: "Gus" },
      });
      const guest = await awaitingApproval(chat, "send_email");
      await runtime.decideApproval(ref, guest.taskId!, "denied");
      await until(() => chat.results().length === 1, "first reply");

      await send(ref, {
        requestId: "r2",
        text: "Ash: send_email ash@x.dev",
        author: { id: OWNER, name: "Ash" },
      });
      await until(() => chat.results().length === 2, "second reply");
      expect(sent).toEqual(["ash@x.dev"]);
    }, 20_000);

    it("approves the cards already waiting when switched on, but not vault cards", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind);
      await send(ref, { requestId: "r1", text: "send_email bo@x.dev" });
      const waiting = await awaitingApproval(chat, "send_email");
      const { approved } = await runtime.setYolo(ref, true, OWNER);
      expect(approved).toEqual([waiting.taskId]);
      expect(await until(() => chat.results()[0], "reply")).toBe("Sent to bo@x.dev");

      await runtime.setYolo(ref, false);
      await send(ref, { requestId: "r2", text: "pay_invoice 9" });
      await awaitingApproval(chat, "pay_invoice");
      expect((await runtime.setYolo(ref, true, OWNER)).approved).toEqual([]);
      expect(runtime.pendingApprovals(ref)).toBe(1);
      expect(sent).toEqual(["bo@x.dev"]);
    }, 20_000);

    it("does not approve waiting cards in a turn the owner did not start", async () => {
      const { runtime, ref, chat, send } = await setup(kind);
      await send(ref, {
        requestId: "r1",
        text: "send_email eve@x.dev",
        peer: { kind: "message", name: "Scout" },
      });
      await awaitingApproval(chat, "send_email");
      expect((await runtime.setYolo(ref, true, OWNER)).approved).toEqual([]);
      expect(runtime.pendingApprovals(ref)).toBe(1);
    }, 15_000);

    it("stops when switched off", async () => {
      const { runtime, ref, chat, send } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);
      await runtime.setYolo(ref, false);
      expect(await runtime.yolo(ref)).toBe(false);
      await send(ref, { requestId: "r1", text: "send_email cy@x.dev" });
      await awaitingApproval(chat, "send_email");
    }, 15_000);

    it("survives reconfiguring: the bot's permissions do not reset it", async () => {
      const { runtime, ref, chat, send, config } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);
      await runtime.configure(ref, config());
      expect(await runtime.yolo(ref)).toBe(true);
      await send(ref, { requestId: "r1", text: "send_email di@x.dev" });
      expect(await until(() => chat.results()[0], "reply")).toBe("Sent to di@x.dev");
    }, 15_000);

    it("belongs to one chat: another conversation stays off", async () => {
      const { runtime, ref, send, config } = await setup(kind);
      await runtime.setYolo(ref, true, OWNER);
      const second = await runtime.createConversation(config());
      const chat = await watch(runtime, second);
      expect(await runtime.yolo(second)).toBe(false);
      await send(second, { requestId: "r1", text: "send_email fy@x.dev" });
      await awaitingApproval(chat, "send_email");
    }, 15_000);

    it("skips auto-review: the classifier is not asked", async () => {
      const reviewer = fakeReviewer(false);
      const { runtime, ref, chat, send } = await setup(kind, [], { reviewer, autoReview: true });
      await runtime.setYolo(ref, true, OWNER);
      await send(ref, { requestId: "r1", text: "send_email gy@x.dev" });
      await until(() => chat.results()[0], "reply");
      expect(chat.toolCall("send_email")).toMatchObject({ approval: "yolo" });
      expect(reviewer.inputs).toEqual([]);
    }, 15_000);

    it("still refuses in a conversation nobody watches", async () => {
      const { runtime, ref, chat, send, sent } = await setup(kind, [], { unattended: true });
      await runtime.setYolo(ref, true, OWNER);
      await send(ref, { requestId: "r1", text: "send_email hy@x.dev" });
      await until(() => chat.results()[0], "reply");
      expect(chat.toolCall("send_email")).toMatchObject({ approval: "refused" });
      expect(sent).toEqual([]);
    }, 15_000);
  });
});

describe("Tool gate token budget (pi)", () => {
  it("refuses every call once the conversation has spent its budget, so the model wraps up", async () => {
    const sent: string[] = [];
    const { ref, chat, send } = await setup("pi", sent, { unattended: true, budgetTokens: 1 });
    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    expect(await until(() => chat.results()[0], "reply")).toMatch(
      /send_email did not run: this routine run has used [\d,]+ tokens, over its budget of 1\./,
    );
    expect(sent).toEqual([]);
    expect(chat.toolCall("send_email")).toMatchObject({ status: "error" });
  }, 15_000);
});

/** pi keeps an Owner wait in a task document, so it outlives the process. */
describe("Tool gate across restarts (pi)", () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function store(): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "tiny-agents-gate-"));
    return join(directory, "agent.db");
  }

  it("keeps YOLO mode on for the chat after a restart", async () => {
    const storePath = await store();
    const sent: string[] = [];
    const first = await setup("pi", sent, { storePath });
    await first.runtime.setYolo(first.ref, true, OWNER);
    await first.runtime.close();

    const second = await open("pi", sent, { storePath });
    expect(await second.runtime.yolo(first.ref)).toBe(true);
    const chat = await watch(second.runtime, first.ref);
    await second.send(first.ref, { requestId: "r1", text: "send_email iy@x.dev" });
    expect(await until(() => chat.results()[0], "reply")).toBe("Sent to iy@x.dev");
  }, 30_000);

  it("keeps auto-review's verdict for a call: no second review after a restart", async () => {
    const storePath = await store();
    const sent: string[] = [];
    const reviewer = fakeReviewer(false);
    const first = await setup("pi", sent, { storePath, reviewer, autoReview: true });
    await first.send(first.ref, { requestId: "r1", text: "send_email fy@x.dev" });
    await awaitingApproval(first.chat, "send_email");
    await first.runtime.close();

    const second = await open("pi", sent, { storePath, reviewer, autoReview: true });
    const chat = await watch(second.runtime, first.ref);
    const waiting = await awaitingApproval(chat, "send_email");
    await until(() => second.runtime.pendingApprovals(first.ref) === 1, "gate re-run");
    await second.runtime.decideApproval(first.ref, waiting.taskId!, "approved");
    expect(await until(() => chat.results()[0], "reply")).toBe("Sent to fy@x.dev");
    expect(reviewer.inputs).toHaveLength(1);
  }, 30_000);
});

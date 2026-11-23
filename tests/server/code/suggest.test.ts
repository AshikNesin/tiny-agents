import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { api, createTestApp } from "../helpers";
import { authToken, resetAppTables } from "../fixtures";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import type { SideCallRequest } from "../../../apps/web/src/server/api/bots/side-call";
import { fakeHarness } from "./fake-harness";

const token = await authToken("code-suggest@example.com");
const app = createTestApp();
const asked: SideCallRequest[] = [];
let reply: string | undefined;

beforeEach(async () => {
  await resetAppTables();
  asked.length = 0;
  reply = "Get it merged to main";
  setCodeHub(createCodeHub({ instances: [fakeHarness("fake")], listDebounceMs: 5 }))!.start();
  installAppForTests({
    codeSuggestions: new Map(),
    codeBranchNamer: {
      sideCaller: {
        complete: async (request) => {
          asked.push(request);
          return reply;
        },
      },
    },
  });
});

afterEach(() => {
  setCodeHub(undefined);
  installAppForTests({ codeBranchNamer: undefined });
});

const suggest = (thread: string, body: unknown) =>
  api<{ suggestion: string | null }>(
    app,
    `/api/v1/code/threads/${encodeURIComponent(thread)}/suggest`,
    { method: "POST", token, json: body },
  );

const turn = {
  user: "Add a right-click menu to the thread list",
  agent: `${"Early detail that should be cut. ".repeat(200)}Pushed. Want me to open the PR and merge it?`,
};

describe("composer suggestions", () => {
  it("suggests the next message from the last turn alone, trimmed to a small prompt", async () => {
    const response = await suggest("fake:t1", turn);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ suggestion: "Get it merged to main" });
    expect(asked).toHaveLength(1);
    const prompt = asked[0]!.user;
    expect(prompt).toContain("Want me to open the PR and merge it?");
    expect(prompt).toContain("Add a right-click menu to the thread list");
    expect(prompt.length).toBeLessThan(1_600);
  });

  it("completes what the user is typing, and drops an answer that does not continue it", async () => {
    reply = "get it merged to main";
    const typed = await suggest("fake:t1", { ...turn, typed: "get it" });
    expect(typed.body.data).toEqual({ suggestion: "get it merged to main" });
    expect(asked[0]!.user).toContain("get it");

    reply = "Ship it";
    const off = await suggest("fake:t1", { ...turn, typed: "please" });
    expect(off.body.data).toEqual({ suggestion: null });
  });

  it("asks the model once for the same turn and text", async () => {
    await suggest("fake:t1", turn);
    await suggest("fake:t1", turn);
    expect(asked).toHaveLength(1);
  });

  it("keeps the reply to one short line", async () => {
    reply = '"Open the PR."\nAnd then also do a whole bunch of other things after that';
    const response = await suggest("fake:t1", turn);
    expect(response.body.data).toEqual({ suggestion: "Open the PR." });
  });

  it("suggests nothing when no model is set up", async () => {
    installAppForTests({ codeBranchNamer: undefined });
    const response = await suggest("fake:t1", turn);
    expect(response.body.data).toEqual({ suggestion: null });
  });
});

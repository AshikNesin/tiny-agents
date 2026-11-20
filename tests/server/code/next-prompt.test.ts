import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { TranscriptItem } from "@tiny-agents/code/contracts";
import { api, createTestApp } from "../helpers";
import { authToken, resetAppTables } from "../fixtures";
import { db, guests } from "../../../apps/web/src/server/db";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import type { SideCallRequest } from "../../../apps/web/src/server/api/bots/side-call";
import { fakeHarness, type FakeHarness } from "./fake-harness";

const token = await authToken("code-next-prompt@example.com");
const app = createTestApp();
let fake: FakeHarness;
let asked: SideCallRequest[];
let reply: string | undefined;

const longChat = "x".repeat(20_000);
const turn: TranscriptItem[] = [
  { kind: "user", id: "u0", text: longChat, attachments: [] },
  { kind: "assistant", id: "a0", text: longChat },
  { kind: "turn", id: "t0" },
  { kind: "user", id: "u1", text: "Add a retry to the upload step", attachments: [] },
  { kind: "assistant", id: "a1", text: "Added the retry. Want me to run the tests?" },
  { kind: "turn", id: "t1" },
];

beforeEach(async () => {
  await resetAppTables();
  fake = fakeHarness();
  setCodeHub(createCodeHub({ instances: [fake], listDebounceMs: 5 }))!.start();
  asked = [];
  reply = '"Yes, run the tests."';
  installAppForTests({
    codeNextPrompts: undefined,
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
  installAppForTests({ codeBranchNamer: undefined, codeNextPrompts: undefined });
});

const ask = (after: string, as = token) =>
  api<{ text: string | null }>(app, `/api/v1/code/threads/fake%3Ac1/next-prompt?after=${after}`, {
    token: as,
  });

describe("Code next prompt", () => {
  it("suggests the next message from the last turn alone, once per turn", async () => {
    fake.items.set("c1", turn);
    const first = await ask("t1");
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ text: "Yes, run the tests." });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.role).toBe("chat_title");
    expect(asked[0]!.user).toContain("Add a retry to the upload step");
    expect(asked[0]!.user).toContain("Want me to run the tests?");
    expect(asked[0]!.user.length).toBeLessThan(2_000);

    expect((await ask("t1")).body.data).toEqual({ text: "Yes, run the tests." });
    expect(asked).toHaveLength(1);
  });

  it("asks again only when a new turn ended", async () => {
    fake.items.set("c1", turn);
    await ask("t1");
    expect((await ask("t2")).body.data).toEqual({ text: null });
    fake.items.set("c1", [
      ...turn,
      { kind: "user", id: "u2", text: "yes", attachments: [] },
      { kind: "assistant", id: "a2", text: "All 40 tests pass." },
      { kind: "turn", id: "t2" },
    ]);
    reply = "Open a PR";
    expect((await ask("t2")).body.data).toEqual({ text: "Open a PR" });
    expect(asked).toHaveLength(2);
  });

  it("offers nothing after a failed turn, a NONE, or to a guest", async () => {
    fake.items.set("c1", [
      { kind: "user", id: "u1", text: "deploy", attachments: [] },
      { kind: "notice", id: "n1", level: "error", text: "Rate limited" },
    ]);
    expect((await ask("n1")).body.data).toEqual({ text: null });
    expect(asked).toHaveLength(0);

    fake.items.set("c1", turn);
    reply = "NONE";
    expect((await ask("t1")).body.data).toEqual({ text: null });

    const guestToken = await authToken("code-next-prompt-guest@example.com", 4545);
    await db.insert(guests).values({ userId: 4545 }).onConflictDoNothing();
    installAppForTests({ codeNextPrompts: undefined });
    reply = "Run the tests";
    const guest = await ask("t1", guestToken);
    expect(guest.body.data?.text ?? null).toBeNull();
    expect(asked).toHaveLength(1);
  });
});

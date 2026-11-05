import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ClaudeCodeEngine } from "../../../../packages/agent/src/engines/claude-code/engine";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function savedFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-persist-"));
  dirs.push(dir);
  const path = join(dir, "store.claude.json");
  const messages = [
    { id: "u-1", role: "user", text: "remember the number 42", status: "done" },
    { id: "a-1", role: "assistant", text: "Got it.", status: "done" },
  ];
  await writeFile(
    path,
    JSON.stringify({
      sessions: {
        "7": {
          model: "claude-sonnet-4-6",
          system: "",
          tools: [],
          permissions: {},
          surface: "claude",
          claudeSessionId: "sess-abc",
          messages,
          nextTask: 1_000_005,
        },
      },
    }),
  );
  return path;
}

const sync = {
  model: "claude-sonnet-4-6",
  system: "",
  tools: [],
  permissions: {},
};

describe("Claude Code transcript after a restart", () => {
  it("keeps the saved history when sync runs before the file loads", async () => {
    const path = await savedFile();
    const engine = new ClaudeCodeEngine({
      persistPath: path,
    });
    engine.sync(7, sync);
    const state = await engine.read(7);
    expect(state.messages.map((message) => message.text)).toEqual([
      "remember the number 42",
      "Got it.",
    ]);
  });

  it("serves the saved history to a watcher", async () => {
    const path = await savedFile();
    const engine = new ClaudeCodeEngine({
      persistPath: path,
    });
    engine.sync(7, sync);
    const subscription = await engine.watch(7, () => undefined);
    expect(subscription.initial.messages).toHaveLength(2);
  });

  it("does not overwrite the saved file on close before it was read", async () => {
    const path = await savedFile();
    const engine = new ClaudeCodeEngine({
      persistPath: path,
    });
    engine.sync(7, sync);
    await engine.close();
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.sessions["7"].messages).toHaveLength(2);
    expect(saved.sessions["7"].claudeSessionId).toBe("sess-abc");
  });
});

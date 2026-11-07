/**
 * A bot's toolkits (bot-toolkits.ts): the selection every bot's conversation
 * runs with, the tool-search rule for large connections, and the check that
 * every id a bot can select is one the runtime installs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createMcpCapability,
  createToolSearchCapability,
  MCP_DEFER_THRESHOLD,
} from "../../../../packages/agent/src/index";
import {
  BOT_TOOLKITS,
  botToolkits,
  connectionCapabilityId,
  connectionTools,
  missingToolkits,
  needsToolSearch,
  parseDisabledTools,
  parseTools,
  TOOL_SEARCH_TOOLKIT,
  VISION_TOOLKIT,
} from "../../../../apps/web/src/server/api/bots/bot-toolkits";
import {
  closeAgentRuntime,
  openAgentRuntime,
} from "../../../../apps/web/src/server/api/bots/bots.runtime";
import { fakeCatalog } from "../../fixtures/runtime";

const catalog = fakeCatalog(); // "known-model" is text-only, "vision-model" sees images

/** A linked connection with `count` cached tools, `off` of them turned off. */
function connection(slug: string, count: number, off = 0) {
  const names = Array.from({ length: count }, (_, i) => `t${i}`);
  return {
    slug,
    toolsCache: JSON.stringify(names.map((name) => ({ name }))),
    disabledTools: JSON.stringify(names.slice(0, off)),
  };
}

describe("botToolkits", () => {
  it("gives every bot every built-in toolkit, plus vision for a model that cannot see images", () => {
    expect(botToolkits({ modelId: "known-model" }, catalog)).toEqual([
      ...BOT_TOOLKITS,
      VISION_TOOLKIT,
    ]);
    expect(botToolkits({ modelId: "vision-model" }, catalog)).toEqual([...BOT_TOOLKITS]);
    // A model the catalog does not know is treated as text-only.
    expect(botToolkits({ modelId: "gone-model" }, catalog)).toContain(VISION_TOOLKIT);
  });

  it("adds each linked connection, and tool search only while one is large", () => {
    const small = connection("small", MCP_DEFER_THRESHOLD);
    const large = connection("large", MCP_DEFER_THRESHOLD + 1);
    expect(botToolkits({ modelId: "vision-model", connections: [small] }, catalog)).toEqual([
      ...BOT_TOOLKITS,
      "mcp:small",
    ]);
    expect(botToolkits({ modelId: "vision-model", connections: [small, large] }, catalog)).toEqual([
      ...BOT_TOOLKITS,
      "mcp:small",
      "mcp:large",
      TOOL_SEARCH_TOOLKIT,
    ]);
  });

  it("counts only the tools that are on", () => {
    const trimmed = connection("big", MCP_DEFER_THRESHOLD + 5, 5);
    expect(botToolkits({ modelId: "vision-model", connections: [trimmed] }, catalog)).not.toContain(
      TOOL_SEARCH_TOOLKIT,
    );
  });
});

describe("a connection's tools", () => {
  it("needs tool search above the defer threshold, not at it", () => {
    expect(needsToolSearch(Array.from({ length: MCP_DEFER_THRESHOLD }))).toBe(false);
    expect(needsToolSearch(Array.from({ length: MCP_DEFER_THRESHOLD + 1 }))).toBe(true);
  });

  it("installs the cached (or live) tools minus those turned off", () => {
    const row = { toolsCache: '[{"name":"a"},{"name":"b"}]', disabledTools: '["a"]' };
    expect(connectionTools(row).map((tool) => tool.name)).toEqual(["b"]);
    expect(
      connectionTools(row, [
        { name: "a", inputSchema: {} },
        { name: "c", inputSchema: {} },
      ]).map((tool) => tool.name),
    ).toEqual(["c"]);
  });

  it("reads unreadable columns as no tools and nothing turned off", () => {
    expect(parseTools("not json")).toEqual([]);
    expect(parseTools('{"name":"a"}')).toEqual([]);
    expect(parseTools('[null,{"name":"a"}]')).toEqual([{ name: "a" }]);
    expect(parseDisabledTools("not json")).toEqual(new Set());
    expect(parseDisabledTools('["a",1]')).toEqual(new Set(["a"]));
  });
});

describe("selected ids match installed ones", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await closeAgentRuntime().catch(() => undefined);
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reports an id the runtime lacks", () => {
    expect(missingToolkits(BOT_TOOLKITS)).toEqual([VISION_TOOLKIT]);
  });

  it("every built-in a bot selects is installed by the server's runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bot-toolkits-"));
    dirs.push(dir);
    // The production boot: builtinCapabilities, the runtime's own, bots and vision.
    const runtime = await openAgentRuntime({
      storePath: join(dir, "agent.db"),
      env: process.env,
      onFatal: () => undefined,
      onReport: () => undefined,
    });
    expect(missingToolkits(runtime.listCapabilities().map((c) => c.id))).toEqual([]);
    await runtime.close();
  }, 20_000);

  it("names connections and tool search as the ConnectionManager installs them", () => {
    expect(createToolSearchCapability().id).toBe(TOOL_SEARCH_TOOLKIT);
    const mcp = createMcpCapability({
      slug: "demo",
      name: "Demo",
      url: "https://mcp.example.com",
      tools: [],
      call: async () => ({ content: [] }),
    });
    expect(mcp.id).toBe(connectionCapabilityId("demo"));
  });
});

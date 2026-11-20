import { afterEach, describe, expect, it } from "vite-plus/test";
import { listClaudeCodeModels } from "../../../../packages/agent/src/engines/claude-code/models";
import {
  claudePlanModels,
  discoverModels,
  DiscoveryError,
  resolveCapabilities,
} from "../../../../packages/models/src/discovery";
import {
  DEFAULT_TIMINGS,
  createClaudeWorkerServer,
  createSdkModelLister,
  type ClaudeCodeModel,
  type ClaudeSdkModule,
  type ModelLister,
} from "../../../../packages/claude-worker/src/index";

const TOKEN = Buffer.alloc(32, 7).toString("base64");
const servers: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const LISTED: ClaudeCodeModel[] = [
  { value: "default", displayName: "Default (recommended)", resolvedModel: "claude-opus-5-5" },
  { value: "opus", displayName: "Opus", resolvedModel: "claude-opus-5-5" },
  { value: "sonnet", displayName: "Sonnet", resolvedModel: "claude-sonnet-5-5" },
  { value: "haiku", displayName: "Haiku", resolvedModel: "claude-haiku-5-5" },
  { value: "claude-nova-6", displayName: "Nova 6" },
];

const noGet = async () => ({ status: 500, body: "" });

describe("naming what Claude Code lists", () => {
  it("lists each model under its resolved id, named from pi-ai's catalog", () => {
    const models = claudePlanModels(LISTED);
    expect(models.map((m) => [m.upstreamId, m.name])).toEqual([
      ["claude-opus-5-5", "Claude Opus 5.5"],
      ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
      ["claude-haiku-5-5", "Claude Haiku 5.5"],
      ["claude-nova-6", "Nova 6"],
    ]);
  });

  it("leaves out `default` and keeps the aliases a model is listed under", () => {
    const opus = claudePlanModels(LISTED).find((m) => m.upstreamId === "claude-opus-5-5")!;
    expect(opus.aliases).toEqual(["opus"]);
    expect(opus).toMatchObject({ known: true, imageInput: true, reasoning: true });
  });

  it("takes Claude Code's name and the plan's defaults for a model pi-ai doesn't know", () => {
    expect(claudePlanModels(LISTED).at(-1)).toMatchObject({
      upstreamId: "claude-nova-6",
      known: false,
      contextWindow: 200_000,
      imageInput: true,
    });
  });

  it("sizes a `[1m]` variant at 1M tokens", () => {
    const [model] = claudePlanModels([
      { value: "sonnet[1m]", displayName: "Sonnet (1M)", resolvedModel: "claude-sonnet-5-5[1m]" },
    ]);
    expect(model).toMatchObject({
      upstreamId: "claude-sonnet-5-5[1m]",
      name: "Claude Sonnet 5.5 (1M context)",
      contextWindow: 1_000_000,
    });
  });

  it("names a model added by id the same way", () => {
    expect(resolveCapabilities("claude-plan", null, "claude-opus-5-5")).toMatchObject({
      name: "Claude Opus 5.5",
      known: true,
    });
    expect(resolveCapabilities("claude-plan", null, "claude-opus-5-5", "Mine").name).toBe("Mine");
  });
});

describe("discovering a Claude plan account", () => {
  it("asks Claude Code instead of returning a fixed list", async () => {
    const found = await discoverModels({
      kind: "claude-plan",
      baseUrl: null,
      get: noGet,
      listClaudePlan: async () => LISTED,
    });
    expect(found.map((m) => m.upstreamId)).toContain("claude-opus-5-5");
  });

  it("fails unreachable with no sandbox to ask, or when Claude Code can't answer", async () => {
    await expect(
      discoverModels({ kind: "claude-plan", baseUrl: null, get: noGet }),
    ).rejects.toThrow(DiscoveryError);
    await expect(
      discoverModels({
        kind: "claude-plan",
        baseUrl: null,
        get: noGet,
        listClaudePlan: () => Promise.reject(new Error("Not signed in")),
      }),
    ).rejects.toMatchObject({
      code: "unreachable",
      message: expect.stringMatching(/Not signed in/),
    });
  });
});

describe("the SDK lister", () => {
  function fakeSdk(models: unknown, calls: { opened: number; closed: number; options?: unknown }) {
    return {
      query: ({ options }: { options: unknown }) => {
        calls.opened++;
        calls.options = options;
        return {
          async *[Symbol.asyncIterator]() {},
          initializationResult: () => Promise.resolve({ models }),
          close: () => void calls.closed++,
        };
      },
      tool: () => undefined,
      createSdkMcpServer: () => undefined,
    } as unknown as ClaudeSdkModule;
  }

  it("reads Claude Code's initialization, then closes the query", async () => {
    const calls = { opened: 0, closed: 0 } as { opened: number; closed: number; options?: unknown };
    const list = createSdkModelLister(fakeSdk([...LISTED, { bogus: true }], calls), {});
    expect(await list()).toEqual(LISTED);
    expect(calls).toMatchObject({
      opened: 1,
      closed: 1,
      options: { tools: [], settingSources: [], mcpServers: {} },
    });
  });

  it("shares one query between concurrent calls", async () => {
    const calls = { opened: 0, closed: 0 };
    const list = createSdkModelLister(fakeSdk(LISTED, calls), {});
    await Promise.all([list(), list()]);
    expect(calls.opened).toBe(1);
  });

  it("gives up when Claude Code never initializes", async () => {
    const sdk = {
      query: () => ({
        async *[Symbol.asyncIterator]() {},
        initializationResult: () => new Promise(() => {}),
        close: () => {},
      }),
    } as unknown as ClaudeSdkModule;
    await expect(createSdkModelLister(sdk, {}, 20)()).rejects.toThrow(/in time/);
  });
});

describe("the worker's `models` request", () => {
  async function worker(options: {
    listModels?: ModelLister;
    loggedIn?: boolean;
  }): Promise<string> {
    const server = await createClaudeWorkerServer({
      token: TOKEN,
      query: async () => undefined,
      authStatus: async () =>
        options.loggedIn === false
          ? { loggedIn: false }
          : { loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" },
      env: {},
      timings: DEFAULT_TIMINGS,
      port: 0,
      ...(options.listModels ? { listModels: options.listModels } : {}),
    });
    servers.push(server);
    return server.url;
  }

  const target = (url: string) => async () => ({ url, token: TOKEN });

  it("answers Claude Code's list over the socket", async () => {
    const url = await worker({ listModels: async () => LISTED });
    expect(await listClaudeCodeModels(target(url))).toEqual(LISTED);
  });

  it("refuses until Claude Code is signed in to a subscription", async () => {
    const url = await worker({ listModels: async () => LISTED, loggedIn: false });
    await expect(listClaudeCodeModels(target(url))).rejects.toMatchObject({ code: "auth" });
  });

  it("answers unavailable from a worker that can't list", async () => {
    const url = await worker({});
    await expect(listClaudeCodeModels(target(url))).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

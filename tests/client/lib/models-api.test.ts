import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { modelsApi } from "@/lib/models-api";
import { StepUpRequiredError, vaultApi } from "@/lib/vault-api";
import type {
  Account,
  DiscoveredModels,
  ModelTestResult,
} from "../../../apps/web/src/shared/api/models";
import { fakeApi } from "../fakes/api";

const account: Account = {
  id: "a1",
  name: "Example",
  kind: "openai-chat",
  baseUrl: "https://api.example.com",
  viaProviderId: null,
  settings: {},
  discovery: "auto",
  allowPrivateNetwork: false,
  enabled: true,
  status: "ok",
  statusDetail: null,
  checkedAt: null,
  version: 1,
  credential: null,
  models: [],
};

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
});

afterEach(() => {
  vaultApi.forgetStepUp();
});

describe("modelsApi and step-up", () => {
  it("probes endpoints and replaces a key without step-up", async () => {
    api.post("/models/discover", (): DiscoveredModels => ({ models: [] }));
    api.post("/models/test", (): ModelTestResult => ({ ok: true, latencyMs: 12 }));
    api.put("/models/providers/:id/connection", () => account);
    await expect(
      modelsApi.discover({ kind: "openai-chat", baseUrl: "https://api.example.com" }),
    ).resolves.toEqual({ models: [] });
    await expect(modelsApi.test({ modelId: "m1" })).resolves.toEqual({ ok: true, latencyMs: 12 });
    await expect(modelsApi.updateConnection("a1", { apiKey: "sk-new" })).resolves.toEqual(account);
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /models/discover",
      "POST /models/test",
      "PUT /models/providers/a1/connection",
    ]);
    const [replaced] = api.sent("PUT", "/models/providers/a1/connection");
    expect(replaced!.body).toEqual({ apiKey: "sk-new" });
    expect(replaced!.headers.has("X-Vault-Step-Up")).toBe(false);
  });

  it("asks for step-up before re-pointing an account, and sends nothing", async () => {
    await expect(
      modelsApi.updateConnection("a1", { baseUrl: "https://evil.example", apiKey: "sk" }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(api.requests).toEqual([]);
  });
});

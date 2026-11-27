import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { apiClient } from "@groot/shell/lib/api";
import { modelsApi } from "@/lib/models-api";
import { StepUpRequiredError, vaultApi } from "@/lib/vault-api";

afterEach(() => {
  vi.restoreAllMocks();
  vaultApi.forgetStepUp();
});

describe("modelsApi and step-up", () => {
  it("probes endpoints and replaces a key without step-up", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ models: [] } as never);
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({ id: "a1" } as never);
    await modelsApi.discover({ kind: "openai-chat", baseUrl: "https://api.example.com" });
    await modelsApi.test({ modelId: "m1" });
    await modelsApi.updateConnection("a1", { apiKey: "sk-new" });
    expect(post.mock.calls.map(([url]) => url)).toEqual(["/models/discover", "/models/test"]);
    expect(request).toHaveBeenCalledWith("put", "/models/providers/a1/connection", {
      body: { apiKey: "sk-new" },
    });
  });

  it("asks for step-up before re-pointing an account, and sends nothing", async () => {
    const request = vi.spyOn(apiClient, "request");
    await expect(
      modelsApi.updateConnection("a1", { baseUrl: "https://evil.example", apiKey: "sk" }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(request).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { apiClient } from "@groot/shell/lib/api";
import { connectionsApi } from "@/lib/connections-api";
import { StepUpRequiredError, vaultApi } from "@/lib/vault-api";

afterEach(() => {
  vi.restoreAllMocks();
  vaultApi.forgetStepUp();
});

describe("connectionsApi and step-up", () => {
  it("asks for step-up before adding, re-pointing or deleting, and sends nothing", async () => {
    const request = vi.spyOn(apiClient, "request");
    const patch = vi.spyOn(apiClient, "patch");
    await expect(
      connectionsApi.create({ name: "X", url: "https://mcp.example.com" }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(
      connectionsApi.update("c1", { url: "https://evil.example" }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(connectionsApi.update("c1", { secret: "s" })).rejects.toBeInstanceOf(
      StepUpRequiredError,
    );
    await expect(connectionsApi.remove("c1")).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(request).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("changes bot links and names without step-up", async () => {
    const patch = vi.spyOn(apiClient, "patch").mockResolvedValue({ id: "c1" } as never);
    await connectionsApi.update("c1", { botIds: ["b1"] });
    await connectionsApi.update("c1", { name: "Renamed" });
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it("sends the step-up token once the owner confirmed", async () => {
    vi.spyOn(apiClient, "post").mockResolvedValue({ token: "tok", expiresAt: Date.now() + 60_000 });
    await vaultApi.confirmWithPassword("pw");
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(undefined as never);
    await connectionsApi.remove("c1");
    expect(request).toHaveBeenCalledWith("delete", "/connections/c1", {
      body: undefined,
      headers: { "X-Vault-Step-Up": "tok" },
      emptyOk: true,
    });
  });
});

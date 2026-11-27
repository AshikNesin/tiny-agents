import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { connectionsApi } from "@/lib/connections-api";
import { StepUpRequiredError, vaultApi } from "@/lib/vault-api";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import type { StepUpToken } from "../../../apps/web/src/shared/api/vault";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";

const connection: Connection = {
  id: "c1",
  name: "X",
  slug: "x",
  url: "https://mcp.example.com",
  transport: "streamable-http",
  authType: "header",
  headerName: null,
  hasSecret: false,
  secretRef: null,
  tools: [],
  allBots: false,
  botIds: [],
  status: "connected",
  createdAt: FIXED_NOW,
};

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
});

afterEach(() => {
  vaultApi.forgetStepUp();
});

describe("connectionsApi and step-up", () => {
  it("asks for step-up before adding, re-pointing or deleting, and sends nothing", async () => {
    await expect(
      connectionsApi.create({ name: "X", url: "https://mcp.example.com" }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(
      connectionsApi.update("c1", { url: "https://evil.example" }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(connectionsApi.update("c1", { secretRef: "other-key" })).rejects.toBeInstanceOf(
      StepUpRequiredError,
    );
    await expect(connectionsApi.remove("c1")).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(api.requests).toEqual([]);
  });

  it("changes bot links, names and keys without step-up", async () => {
    api.patch("/connections/:id", () => connection);
    await expect(connectionsApi.update("c1", { botIds: ["b1"] })).resolves.toEqual(connection);
    await connectionsApi.update("c1", { name: "Renamed" });
    await connectionsApi.update("c1", { headerName: "x-key", secret: "s" });
    expect(api.sent("PATCH", "/connections/c1").map((request) => request.body)).toEqual([
      { botIds: ["b1"] },
      { name: "Renamed" },
      { headerName: "x-key", secret: "s" },
    ]);
  });

  it("sends the step-up token once the owner confirmed", async () => {
    api.post("/vault/step-up", (): StepUpToken => ({
      token: "tok",
      expiresAt: Date.now() + 60_000,
    }));
    api.delete("/connections/:id", (): Deleted => ({ deleted: true }));
    await vaultApi.confirmWithPassword("pw");
    await expect(connectionsApi.remove("c1")).resolves.toEqual({ deleted: true });
    const [removal] = api.sent("DELETE", "/connections/c1");
    expect(removal!.headers.get("X-Vault-Step-Up")).toBe("tok");
    expect(removal!.body).toBeUndefined();
  });
});

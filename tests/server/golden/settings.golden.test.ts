/**
 * Golden flows: Settings and owner tools (models, the vault with step-up,
 * attachments, notification settings) and the Code page on a fake harness.
 * See recorder.ts.
 */
import { afterAll, afterEach, beforeAll, describe } from "vite-plus/test";
import { createTestApp } from "../helpers";
import { uploads, vaultAuditEvents, vaultItems } from "../../../apps/web/src/server/db";
import { issueStepUp } from "../../../apps/web/src/server/api/vault/vault.stepup";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { authToken, closeAppRuntime, openAppRuntime, resetAppTables } from "../fixtures";
import { fakeHarness } from "../code/fake-harness";
import { goldenFlow } from "./recorder";

const app = createTestApp();
let token = "";

beforeAll(async () => {
  token = await authToken("golden-settings@example.com");
  await openAppRuntime();
  await resetAppTables();
});
afterAll(() => closeAppRuntime());

const setup = { app, token: () => token };
/** The owner confirmed it's them: a fresh step-up token on every call that needs one. */
const steppedUp = () => ({ "X-Vault-Step-Up": issueStepUp(1).token });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("golden: settings and owner tools", () => {
  goldenFlow("models", setup, async (r) => {
    await r.http("chat models", "/api/v1/models");
    await r.http("accounts", "/api/v1/models/providers");
    await r.http("roles", "/api/v1/models/roles");
    await r.http("set a role", "/api/v1/models/roles", {
      method: "PUT",
      json: { chat_title: "test-model-2" },
    });
    await r.http("roles after", "/api/v1/models/roles");
    await r.http("add an account without step-up", "/api/v1/models/providers", {
      method: "POST",
      json: { kind: "anthropic", name: "Anthropic", apiKey: "sk-test" },
    });
    await r.http("capabilities", "/api/v1/capabilities");
  });

  goldenFlow("vault", setup, async (r) => {
    await r.http("overview", "/api/v1/vault");
    await r.http("step up with a wrong password", "/api/v1/vault/step-up", {
      method: "POST",
      json: { password: "not it" },
    });
    const item = {
      kind: "login",
      title: "Bank",
      urls: ["https://bank.example.com/login"],
      values: { username: "me@example.com", password: "hunter2" },
      policy: { handle: "bank" },
    };
    await r.http("create without step-up", "/api/v1/vault/items", { method: "POST", json: item });
    await r.http("create", "/api/v1/vault/items", {
      method: "POST",
      json: item,
      headers: steppedUp(),
    });
    await r.http("create the same handle", "/api/v1/vault/items", {
      method: "POST",
      json: item,
      headers: steppedUp(),
    });
    await r.http("overview after", "/api/v1/vault");
    await r.http("detail", "/api/v1/vault/items/bank");
    await r.http("reveal", "/api/v1/vault/items/bank/reveal", {
      method: "POST",
      json: { field: "password" },
      headers: steppedUp(),
    });
    await r.http("change the password", "/api/v1/vault/items/bank", {
      method: "PATCH",
      json: { field: "password", value: "correct horse" },
      headers: steppedUp(),
    });
    await r.http("tighten the policy", "/api/v1/vault/items/bank", {
      method: "PUT",
      json: { policy: { approval: "every_use", allowUnattended: false } },
      headers: steppedUp(),
    });
    await r.http("detail after", "/api/v1/vault/items/bank");
    await r.db("vault rows", [vaultItems, vaultAuditEvents], ["externalId"]);
    await r.http("delete and purge", "/api/v1/vault/items/bank?purge=true", {
      method: "DELETE",
      headers: steppedUp(),
    });
    await r.http("overview at the end", "/api/v1/vault");
  });

  goldenFlow("uploads", setup, async (r) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(PNG)], "dot.png", { type: "image/png" }));
    const response = await app.request("/api/v1/uploads", {
      method: "POST",
      body: form,
      headers: { authorization: `Bearer ${token}` },
    });
    const stored = (await response.json()) as { data: { ref: { uploadId: string } } };
    r.note("upload", { status: response.status, body: stored });
    const id = stored.data.ref.uploadId;
    await r.http("status", `/api/v1/uploads/${id}`);
    const content = await app.request(`/api/v1/uploads/${id}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    r.note("content", {
      status: content.status,
      type: content.headers.get("content-type"),
      disposition: content.headers.get("content-disposition"),
      bytes: (await content.arrayBuffer()).byteLength,
    });
    await r.http("unknown upload", "/api/v1/uploads/000000000000000000000000");
    await r.db("upload row", [uploads]);
    await r.http("delete", `/api/v1/uploads/${id}`, { method: "DELETE" });
    await r.http("status after delete", `/api/v1/uploads/${id}`);
  });

  goldenFlow("notification-settings", setup, async (r) => {
    await r.http("settings", "/api/v1/notifications/settings");
    await r.http("status", "/api/v1/notifications/status");
  });
});

describe("golden: the Code page on a fake harness", () => {
  afterEach(() => setCodeHub(undefined));

  goldenFlow("code", setup, async (r) => {
    const fake = fakeHarness();
    const hub = setCodeHub(createCodeHub({ instances: [fake], listDebounceMs: 0 }))!;
    hub.start();
    await r.http("status", "/api/v1/code/status");
    const created = await r.http("start a thread", "/api/v1/code/threads", {
      method: "POST",
      json: { instanceId: "fake", message: "Fix the tests", cwd: "/repo" },
    });
    await r.http("thread", `/api/v1/code/threads/${created.threadId}`);
    await r.http("send", `/api/v1/code/threads/${created.threadId}/messages`, {
      method: "POST",
      json: { message: "and the lint" },
    });
    await r.http("unknown harness", "/api/v1/code/threads", {
      method: "POST",
      json: { instanceId: "nope", message: "x" },
    });
    await r.http("bad thread id", "/api/v1/code/threads/%2e%2e");
    r.note("the harness saw", { created: fake.created, sent: fake.sent });
  });
});

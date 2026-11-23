import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { hashPassword } from "@groot/core/utils/password.utils";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { db, models, providers, users, vaultItems } from "../../../apps/web/src/server/db";
import { setReadBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import { createLocalBackend } from "../../../apps/web/src/server/api/vault/backends/local";
import { setWriteBackendsForTests } from "../../../apps/web/src/server/api/vault/vault.admin.service";
import {
  clearStatusCache,
  forgetAppCredential,
} from "../../../apps/web/src/server/api/vault/vault.service";
import { clearStepUpsForTests } from "../../../apps/web/src/server/api/vault/vault.stepup";
import {
  bindModelRuntime,
  FAUX_PROVIDER_ID,
} from "../../../apps/web/src/server/api/models/models.config";
import { api, createTestApp } from "../helpers";
import { closeAppRuntime, openAppRuntime } from "../fixtures";

const SENTINEL = "sk-sentinel-Qz81LmWw";
const PASSWORD = "owner-password-models-occ";

let server: Server;
let endpoint: string;
let listed = ["model-a", "model-b"];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${SENTINEL}`) {
      res.writeHead(401).end("{}");
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: listed.map((id) => ({ id })) }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const app = createTestApp();
let token: string;
let step: () => Promise<string>;

beforeAll(async () => {
  const [row] = await db
    .insert(users)
    .values({ email: "models-occ@example.com", password: await hashPassword(PASSWORD), name: "O" })
    .returning();
  token = await generateToken({ userId: row!.id, email: row!.email });
});

beforeEach(async () => {
  const backend = createLocalBackend();
  setReadBackendsForTests(new Map([["local", backend]]));
  setWriteBackendsForTests(new Map([["local", backend]]));
  clearStatusCache();
  clearStepUpsForTests();
  forgetAppCredential();
  listed = ["model-a", "model-b"];
  bindModelRuntime(await openAppRuntime());
  step = async () => {
    const response = await api<{ token: string }>(app, "/api/v1/vault/step-up", {
      method: "POST",
      token,
      json: { password: PASSWORD },
    });
    expect(response.status).toBe(200);
    return response.body.data!.token;
  };
});

afterEach(async () => {
  bindModelRuntime(undefined);
  await closeAppRuntime();
  for (const row of await db.select().from(providers)) {
    if (row.id !== FAUX_PROVIDER_ID) await db.delete(providers).where(eq(providers.id, row.id));
  }
  await db.delete(models);
  await db.delete(vaultItems);
});

async function createAccount(stepUpToken: string) {
  const response = await api<{ id: string; version: number }>(app, "/api/v1/models/providers", {
    method: "POST",
    token,
    stepUp: stepUpToken,
    json: {
      kind: "openai-chat",
      apiKey: SENTINEL,
      baseUrl: endpoint,
      allowPrivateNetwork: true,
      name: "Local",
      models: ["model-a"],
    },
  });
  expect(response.status).toBe(201);
  return response.body.data!;
}

function putConnection(id: string, stepUpToken: string, json: Record<string, unknown>) {
  return api<{ version: number; credential?: { hint: string } }>(
    app,
    `/api/v1/models/providers/${id}/connection`,
    { method: "PUT", token, stepUp: stepUpToken, json },
  );
}

describe("updating a connection concurrently", () => {
  it("orphan: none; one 412 loses and cleans up its fresh key", async () => {
    const stepUpToken = await step();
    const created = await createAccount(stepUpToken);
    const [before] = await db.select().from(providers).where(eq(providers.id, created.id));
    expect(before!.credentialItemId).toBeDefined();

    const [a, b] = await Promise.all([
      putConnection(created.id, stepUpToken, { apiKey: SENTINEL }),
      putConnection(created.id, stepUpToken, { apiKey: SENTINEL }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 412]);
    const [row] = await db.select().from(providers).where(eq(providers.id, created.id));
    const items = await db.select().from(vaultItems);
    expect(items.map((item) => item.id)).toEqual([row!.credentialItemId]);
  });

  it("reports 404 when the account was deleted meanwhile", async () => {
    const stepUpToken = await step();
    const created = await createAccount(stepUpToken);
    const other = await createAccount(stepUpToken);
    await api(app, `/api/v1/models/providers/${created.id}`, {
      method: "DELETE",
      token,
      stepUp: stepUpToken,
    });
    const response = await putConnection(created.id, stepUpToken, {
      apiKey: "sk-late-key-cccccccccccccc",
    });
    expect(response.status).toBe(404);
    expect(other.id).not.toBe(created.id);
  });
});

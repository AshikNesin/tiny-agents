import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { artifacts, botGuests, bots, db, users } from "../../../apps/web/src/server/db";
import { artifactStore } from "../../../apps/web/src/server/api/artifacts/artifacts.store";
import { api, createTestApp } from "../helpers";
import { authToken, resetAppTables, seedBot } from "../fixtures";

const app = createTestApp();
const ownerToken = await authToken("artifacts-owner@example.com", 880_001);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

const asOwner = (path: string, init: { method?: string; json?: unknown } = {}) =>
  api<Data>(app, path, { ...init, token: ownerToken });

async function seedArtifact(content = "# Plan\n\n- one\n- two\n") {
  const bot = await seedBot();
  const ref = await artifactStore.create(bot.conversationId!, {
    idempotencyKey: `key-${bot.id}-1`,
    slug: "trip-plan",
    title: "Trip plan",
    kind: "markdown",
    content,
  });
  return { bot, ref };
}

describe("artifacts", () => {
  const made: number[] = [];

  beforeEach(async () => {
    await resetAppTables();
  });

  afterEach(async () => {
    for (const id of made.splice(0)) await db.delete(users).where(eq(users.id, id));
  });

  it("keeps every change as a new version and refuses one built on an old version", async () => {
    const { bot, ref } = await seedArtifact();
    const conversation = bot.conversationId!;

    const edited = await artifactStore.commit(conversation, {
      idempotencyKey: "key-edit",
      slug: "trip-plan",
      baseSeq: 1,
      op: "edit",
      content: "# Plan\n\n- one\n- three\n",
    });
    expect(edited).toEqual({ artifact: { ...ref, seq: 2 } });

    const stale = await artifactStore.commit(conversation, {
      idempotencyKey: "key-stale",
      slug: "trip-plan",
      baseSeq: 1,
      op: "rewrite",
      content: "lost",
    });
    expect(stale).toEqual({ stale: { ...ref, seq: 2 } });

    expect((await artifactStore.read(conversation, "trip-plan"))?.content).toBe(
      "# Plan\n\n- one\n- three\n",
    );
    expect((await artifactStore.read(conversation, "trip-plan", 1))?.content).toBe(
      "# Plan\n\n- one\n- two\n",
    );
    expect(await artifactStore.list(conversation)).toEqual([{ ...ref, seq: 2 }]);
  });

  it("returns the same version when a replayed tool call commits again", async () => {
    const { bot } = await seedArtifact();
    const change = {
      idempotencyKey: "key-replay",
      slug: "trip-plan",
      baseSeq: 1,
      op: "rewrite" as const,
      content: "v2",
    };
    const first = await artifactStore.commit(bot.conversationId!, change);
    const again = await artifactStore.commit(bot.conversationId!, change);
    expect(again).toEqual(first);
    expect((await artifactStore.read(bot.conversationId!, "trip-plan"))?.seq).toBe(2);
  });

  it("refuses a second artifact with the same slug in one chat", async () => {
    const { bot } = await seedArtifact();
    await expect(
      artifactStore.create(bot.conversationId!, {
        idempotencyKey: "key-dup",
        slug: "trip-plan",
        title: "Again",
        kind: "markdown",
        content: "x",
      }),
    ).rejects.toThrow(/already has an artifact "trip-plan" at version 1/);
  });

  it("serves versions to the owner and restores an old one as a new version", async () => {
    const { bot, ref } = await seedArtifact();
    await artifactStore.commit(bot.conversationId!, {
      idempotencyKey: "key-rw",
      slug: "trip-plan",
      baseSeq: 1,
      op: "rewrite",
      title: "Trip plan v2",
      content: "rewritten",
    });
    const base = `/api/v1/bots/${bot.id}/artifacts/${ref.id}`;

    const detail = await asOwner(base);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      slug: "trip-plan",
      title: "Trip plan v2",
      kind: "markdown",
      headSeq: 2,
    });
    expect(detail.body.data.versions.map((v: Data) => [v.seq, v.op])).toEqual([
      [2, "rewrite"],
      [1, "create"],
    ]);

    const first = await asOwner(`${base}/versions/1`);
    expect(first.body.data).toMatchObject({ seq: 1, content: "# Plan\n\n- one\n- two\n" });

    const restored = await asOwner(`${base}/restore`, { method: "POST", json: { seq: 1 } });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ headSeq: 3, title: "Trip plan" });
    expect(restored.body.data.versions[0]).toMatchObject({
      seq: 3,
      op: "restore",
      author: "owner",
    });
    expect((await asOwner(`${base}/versions/3`)).body.data.content).toBe(
      "# Plan\n\n- one\n- two\n",
    );
  });

  it("does not serve an artifact under another bot", async () => {
    const { ref } = await seedArtifact();
    const other = await seedBot();
    expect((await asOwner(`/api/v1/bots/${other.id}/artifacts/${ref.id}`)).status).toBe(404);
  });

  it("lets a guest read a shared bot's artifact but not restore it", async () => {
    const { bot, ref } = await seedArtifact();
    const email = `artifacts-guest-${Date.now()}@example.com`;
    const created = await asOwner("/api/v1/people", {
      method: "POST",
      json: { name: "Priya", email, password: "secret-pass" },
    });
    expect(created.status).toBe(201);
    const guestId: number = created.body.data.id;
    made.push(guestId);
    const guestToken = await authToken(email, guestId);
    const base = `/api/v1/bots/${bot.id}/artifacts/${ref.id}`;

    expect((await api(app, base, { token: guestToken })).status).toBe(404);

    await db.insert(botGuests).values({ botId: bot.id, userId: guestId });
    expect((await api(app, base, { token: guestToken })).status).toBe(200);
    expect((await api(app, `${base}/versions/1`, { token: guestToken })).status).toBe(200);
    const restore = await api(app, `${base}/restore`, {
      method: "POST",
      json: { seq: 1 },
      token: guestToken,
    });
    expect(restore.status).toBe(403);
  });

  it("drops a bot's artifacts with the bot", async () => {
    const { bot } = await seedArtifact();
    await db.delete(bots).where(eq(bots.id, bot.id));
    expect(await db.select().from(artifacts)).toEqual([]);
  });

  it("serves the frame shell with a sandboxing CSP and no artifact content", async () => {
    const response = await app.request("/api/v1/artifact-frame");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^sandbox allow-scripts;/);
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    const body = await response.text();
    expect(body).toContain('postMessage({ type: "artifact.ready" }, "*")');
  });
});

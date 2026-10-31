/** Skills API (issue #1 M2): the shared library, bot assignment and imports. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { skillStore } from "../../../apps/web/src/server/api/skills/skills.store";
import { parseGitHubUrl } from "../../../apps/web/src/server/api/skills/skills.parse";
import { bots, db, skills } from "../../../apps/web/src/server/db";
import { api, createTestApp } from "../helpers";
import { authToken, seedBot as seedBotRow } from "../fixtures";

const token = await authToken("skills@example.com");
const buildApp = () => createTestApp();

interface SkillBody {
  id: string;
  name: string;
  source: string;
  botIds: string[];
  warnings: string[];
  [key: string]: unknown;
}

const SKILL_MD = `---
name: weekly-report
description: Write the weekly report from my notes
---
# Weekly report

1. Read notes`;

const seedBot = (conversationId = "900") =>
  seedBotRow({ name: "Ops", modelId: "m", conversationId });

describe("Skills API", () => {
  beforeEach(async () => {
    await db.delete(skills);
    await db.delete(bots);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete(skills);
    await db.delete(bots);
  });

  it("previews a pasted SKILL.md and creates it assigned to a bot", async () => {
    const app = buildApp();
    const bot = await seedBot();
    const preview = await api<SkillBody>(app, "/api/v1/skills/preview", {
      method: "POST",
      json: { source: "paste", content: SKILL_MD },
      token,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      name: "weekly-report",
      description: "Write the weekly report from my notes",
      body: "# Weekly report\n\n1. Read notes",
      exists: false,
    });

    const created = await api<SkillBody>(app, "/api/v1/skills", {
      method: "POST",
      json: { ...preview.body.data, botIds: [bot.id] },
      token,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "weekly-report", botIds: [bot.id] });

    // The agent's adapter sees it through the bot's conversation.
    expect(await skillStore.list(900)).toEqual([
      { name: "weekly-report", description: "Write the weekly report from my notes" },
    ]);
    const duplicate = await api(app, "/api/v1/skills", {
      method: "POST",
      json: { name: "weekly-report", description: "dup" },
      token,
    });
    expect(duplicate.status).toBe(409);
  });

  it("rejects SKILL.md without frontmatter or with a bad name", async () => {
    const app = buildApp();
    const noFrontmatter = await api(app, "/api/v1/skills/preview", {
      method: "POST",
      json: { source: "paste", content: "# no frontmatter" },
      token,
    });
    expect(noFrontmatter.status).toBe(400);
    const badName = await api(app, "/api/v1/skills/preview", {
      method: "POST",
      json: { source: "paste", content: "---\nname: Bad Name\ndescription: x\n---\nbody" },
      token,
    });
    expect(badName.status).toBe(400);
  });

  it("imports a skill folder from GitHub with its files", async () => {
    const responses: Record<string, unknown> = {
      "https://api.github.com/repos/acme/skills/contents/pdf?ref=main": [
        {
          type: "file",
          name: "SKILL.md",
          path: "pdf/SKILL.md",
          size: 80,
          download_url: "raw:skill",
        },
        { type: "file", name: "fill.py", path: "pdf/fill.py", size: 10, download_url: "raw:py" },
      ],
      "raw:skill": "---\nname: pdf\ndescription: Work with PDFs\n---\nUse fill.py",
      "raw:py": "print(1)",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = responses[url];
        if (body === undefined) return new Response("missing", { status: 404 });
        return new Response(typeof body === "string" ? body : JSON.stringify(body));
      }),
    );
    const preview = await api<SkillBody>(buildApp(), "/api/v1/skills/preview", {
      method: "POST",
      json: { source: "github", url: "https://github.com/acme/skills/tree/main/pdf" },
      token,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      name: "pdf",
      files: [{ path: "fill.py", content: "print(1)" }],
      sourceUrl: "https://github.com/acme/skills/tree/main/pdf",
    });
    expect(preview.body.data!.warnings[0]).toMatch(/never executed/);
  });

  it("parses the GitHub link shapes skills are shared as", () => {
    expect(parseGitHubUrl("https://github.com/a/b/tree/main/skills/x")).toEqual({
      owner: "a",
      repo: "b",
      ref: "main",
      dir: "skills/x",
    });
    expect(parseGitHubUrl("https://github.com/a/b/blob/v1/x/SKILL.md")).toMatchObject({
      ref: "v1",
      dir: "x",
    });
    expect(parseGitHubUrl("https://github.com/a/b")).toEqual({ owner: "a", repo: "b", dir: "" });
  });

  it("updates, reassigns and deletes skills; bots save their own through the adapter", async () => {
    const app = buildApp();
    const bot = await seedBot("901");
    const created = await api<SkillBody>(app, "/api/v1/skills", {
      method: "POST",
      json: { name: "triage", description: "Triage", body: "1" },
      token,
    });
    expect(created.status).toBe(201);
    const id = created.body.data!.id;
    const patched = await api(app, `/api/v1/skills/${id}`, {
      method: "PATCH",
      json: { body: "2", botIds: [bot.id] },
      token,
    });
    expect(patched.status).toBe(200);
    expect((await skillStore.get(901, "triage"))?.body).toBe("2");

    expect(
      await skillStore.save(901, { name: "inbox-zero", description: "Inbox", body: "x" }),
    ).toEqual({
      created: true,
    });
    const list = await api<SkillBody[]>(app, "/api/v1/skills", { token });
    expect(list.status).toBe(200);
    expect(list.body.data!.map((s) => [s.name, s.source])).toEqual([
      ["inbox-zero", "bot"],
      ["triage", "manual"],
    ]);

    const deleted = await api(app, `/api/v1/skills/${id}`, { method: "DELETE", token });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true });
    expect((await skillStore.list(901)).map((s) => s.name)).toEqual(["inbox-zero"]);
  });

  it("never lets a bot overwrite a skill it is not assigned: a new version of its own, or a new name", async () => {
    const app = buildApp();
    const ops = await seedBot("910");
    await seedBot("911");
    const imported = await api<SkillBody>(app, "/api/v1/skills", {
      method: "POST",
      json: { name: "deploy", description: "Deploy", body: "careful", botIds: [ops.id] },
      token,
    });
    expect(imported.status).toBe(201);

    // The other bot has no "deploy": its save is refused, and the body stays.
    await expect(
      skillStore.save(911, { name: "deploy", description: "Deploy", body: "rm -rf /" }),
    ).rejects.toThrow(/already exists and is not assigned to you/);
    expect((await skillStore.get(910, "deploy"))?.body).toBe("careful");

    // The assigned bot saves a new version of its own.
    expect(
      await skillStore.save(910, { name: "deploy", description: "Deploy", body: "v2" }),
    ).toEqual({ created: false });
    expect((await skillStore.get(910, "deploy"))?.body).toBe("v2");
  });
});

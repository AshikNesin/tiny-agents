import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { skillStore } from "../../../apps/web/src/server/api/skills/skills.store";
import * as skillsService from "../../../apps/web/src/server/api/skills/skills.service";
import { parseGitHubUrl } from "../../../apps/web/src/server/api/skills/skills.parse";
import {
  botGuests,
  botSkills,
  bots,
  db,
  guests,
  skills,
  users,
} from "../../../apps/web/src/server/db";
import { api, createTestApp } from "../helpers";
import { authToken, fakeCatalog, seedBot as seedBotRow, useTestRuntime } from "../fixtures";

const token = await authToken("skills@example.com");
const buildApp = () => createTestApp();

interface SkillBody {
  id: string;
  name: string;
  source: string;
  botIds: string[];
  allBots: boolean;
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
    await db.delete(users).where(eq(users.id, 990_930));
    useTestRuntime(undefined);
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

  it("answers the friendly 409, not a raw SqliteError, when two creates of one name race", async () => {
    const [a, b] = await Promise.allSettled([
      skillsService.create({
        name: "racer",
        description: "racer 1",
        body: "",
        files: [],
        source: "manual",
      }),
      skillsService.create({
        name: "racer",
        description: "racer 2",
        body: "",
        files: [],
        source: "manual",
      }),
    ]);
    expect(a.status).toBe("fulfilled");
    if (b.status !== "rejected") throw new Error("the racing create should have lost");
    expect(b.reason).toMatchObject({ output: { statusCode: 409 } });
    expect(b.reason.message).toMatch(/A skill named "racer" exists/);
    expect(await db.select().from(skills).where(eq(skills.name, "racer"))).toHaveLength(1);

    const app = buildApp();
    const raced = await api(app, "/api/v1/skills", {
      method: "POST",
      json: { name: "racer", description: "late" },
      token,
    });
    expect(raced.status).toBe(409);
    expect(raced.body.error?.message).toMatch(/A skill named "racer" exists/);
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

  it("gives a new skill to every bot, including bots made later and a bot shared with a guest", async () => {
    const app = buildApp();
    const ops = await seedBot("930");
    const shared = await seedBot("931");
    await db.insert(users).values({ id: 990_930, email: "skill-guest@example.com", password: "!" });
    await db.insert(guests).values({ userId: 990_930 });
    await db.insert(botGuests).values({ botId: shared.id, userId: 990_930 });

    const created = await api<SkillBody>(app, "/api/v1/skills", {
      method: "POST",
      json: { name: "deploy", description: "Deploy", body: "careful" },
      token,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ allBots: true });
    expect([...created.body.data!.botIds].sort()).toEqual([ops.id, shared.id].sort());

    const later = await seedBot("932");
    expect((await skillStore.list(932)).map((skill) => skill.name)).toEqual(["deploy"]);
    expect((await skillStore.list(931)).map((skill) => skill.name)).toEqual(["deploy"]);
    const bot = await api<{ skillIds: string[] }>(app, `/api/v1/bots/${later.id}`, { token });
    expect(bot.body.data!.skillIds).toEqual([created.body.data!.id]);
    expect(await db.$count(botSkills)).toBe(0);
  });

  it("turns a shared skill off for one bot, keeping it for every other bot", async () => {
    useTestRuntime({ configure: async () => undefined, catalog: fakeCatalog() } as never);
    const app = buildApp();
    const ops = await seedBot("940");
    const news = await seedBot("941");
    const created = await api<SkillBody>(app, "/api/v1/skills", {
      method: "POST",
      json: { name: "deploy", description: "Deploy", body: "careful" },
      token,
    });
    const id = created.body.data!.id;

    const off = await api<{ skillIds: string[] }>(app, `/api/v1/bots/${news.id}`, {
      method: "PATCH",
      json: { skillIds: [] },
      token,
    });
    expect(off.body.data!.skillIds).toEqual([]);
    expect(await skillStore.list(941)).toEqual([]);
    const third = await seedBot("942");
    const detail = await api<SkillBody>(app, `/api/v1/skills/${id}`, { token });
    expect(detail.body.data).toMatchObject({ allBots: true });
    expect([...detail.body.data!.botIds].sort()).toEqual([ops.id, third.id].sort());

    const narrowed = await api<SkillBody>(app, `/api/v1/skills/${id}`, {
      method: "PATCH",
      json: { allBots: false, botIds: [ops.id] },
      token,
    });
    expect(narrowed.body.data).toMatchObject({ allBots: false, botIds: [ops.id] });
    expect(await skillStore.list(942)).toEqual([]);
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

    await expect(
      skillStore.save(911, { name: "deploy", description: "Deploy", body: "rm -rf /" }),
    ).rejects.toThrow(/already exists and is not assigned to you/);
    expect((await skillStore.get(910, "deploy"))?.body).toBe("careful");

    expect(
      await skillStore.save(910, { name: "deploy", description: "Deploy", body: "v2" }),
    ).toEqual({ created: false });
    expect((await skillStore.get(910, "deploy"))?.body).toBe("v2");
  });

  it("saves one skill when two conversations race on a new name", async () => {
    await seedBot("920");
    await seedBot("921");
    const saves = await Promise.allSettled([
      skillStore.save(920, { name: "shared-note", description: "d1", body: "b1" }),
      skillStore.save(921, { name: "shared-note", description: "d2", body: "b2" }),
    ]);
    expect(saves.filter((r) => r.status === "fulfilled" && r.value.created)).toHaveLength(1);
    const rejected = saves.find((r) => r.status === "rejected");
    if (!rejected) throw new Error("one of the racing saves should have lost");
    expect(String(rejected.reason)).toMatch(/already exists and is not assigned to you/);
    expect(await db.select().from(skills).where(eq(skills.name, "shared-note"))).toHaveLength(1);
  });
});

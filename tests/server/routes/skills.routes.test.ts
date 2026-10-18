/** Skills API (issue #1 M2): the shared library, bot assignment and imports. */
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { skillStore } from "../../../apps/web/src/server/api/skills/skills.store";
import { parseGitHubUrl } from "../../../apps/web/src/server/api/skills/skills.parse";

const authorization = {
  Authorization: `Bearer ${generateToken({ userId: 1, email: "skills@example.com" })}`,
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
}

const SKILL_MD = `---
name: weekly-report
description: Write the weekly report from my notes
---
# Weekly report

1. Read notes`;

async function seedBot(conversationId = "900") {
  return prisma.bot.create({
    data: { name: "Ops", modelId: "m", avatarColor: "#14b8a6", conversationId },
  });
}

describe("Skills API", () => {
  beforeEach(async () => {
    await prisma.skill.deleteMany();
    await prisma.bot.deleteMany();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.skill.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("previews a pasted SKILL.md and creates it assigned to a bot", async () => {
    const app = buildApp();
    const bot = await seedBot();
    const preview = await request(app)
      .post("/api/v1/skills/preview")
      .set(authorization)
      .send({ source: "paste", content: SKILL_MD })
      .expect(200);
    expect(preview.body.data).toMatchObject({
      name: "weekly-report",
      description: "Write the weekly report from my notes",
      body: "# Weekly report\n\n1. Read notes",
      exists: false,
    });

    const created = await request(app)
      .post("/api/v1/skills")
      .set(authorization)
      .send({ ...preview.body.data, botIds: [bot.id] })
      .expect(201);
    expect(created.body.data).toMatchObject({ name: "weekly-report", botIds: [bot.id] });

    // The agent's adapter sees it through the bot's conversation.
    expect(await skillStore.list(900)).toEqual([
      { name: "weekly-report", description: "Write the weekly report from my notes" },
    ]);
    await request(app)
      .post("/api/v1/skills")
      .set(authorization)
      .send({ name: "weekly-report", description: "dup" })
      .expect(409);
  });

  it("rejects SKILL.md without frontmatter or with a bad name", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/v1/skills/preview")
      .set(authorization)
      .send({ source: "paste", content: "# no frontmatter" })
      .expect(400);
    await request(app)
      .post("/api/v1/skills/preview")
      .set(authorization)
      .send({ source: "paste", content: "---\nname: Bad Name\ndescription: x\n---\nbody" })
      .expect(400);
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
    const preview = await request(buildApp())
      .post("/api/v1/skills/preview")
      .set(authorization)
      .send({ source: "github", url: "https://github.com/acme/skills/tree/main/pdf" })
      .expect(200);
    expect(preview.body.data).toMatchObject({
      name: "pdf",
      files: [{ path: "fill.py", content: "print(1)" }],
      sourceUrl: "https://github.com/acme/skills/tree/main/pdf",
    });
    expect(preview.body.data.warnings[0]).toMatch(/never executed/);
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
    const created = await request(app)
      .post("/api/v1/skills")
      .set(authorization)
      .send({ name: "triage", description: "Triage", body: "1" })
      .expect(201);
    await request(app)
      .patch(`/api/v1/skills/${created.body.data.id}`)
      .set(authorization)
      .send({ body: "2", botIds: [bot.id] })
      .expect(200);
    expect((await skillStore.get(901, "triage"))?.body).toBe("2");

    expect(
      await skillStore.save(901, { name: "inbox-zero", description: "Inbox", body: "x" }),
    ).toEqual({
      created: true,
    });
    const list = await request(app).get("/api/v1/skills").set(authorization).expect(200);
    expect(list.body.data.map((s: { name: string; source: string }) => [s.name, s.source])).toEqual(
      [
        ["inbox-zero", "bot"],
        ["triage", "manual"],
      ],
    );

    await request(app)
      .delete(`/api/v1/skills/${created.body.data.id}`)
      .set(authorization)
      .expect(200);
    expect((await skillStore.list(901)).map((s) => s.name)).toEqual(["inbox-zero"]);
  });
});
